// 'use strict'
const ccxt = require('ccxt')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
const {saveJsonToCSV} = require('./utils')
require('ansicolor').nice
const moment = require('moment')
const {MinorError, MajorError} = require('./utils/errors')
const utils = require('./utils')
const Worker = require('./Worker')
const uuid = require('uuid/v4')

const {
  retryQueryTaskIfAnyError,
  getTopVolume,
  fetchNewPointAndAttach,
  calcMovingAverge,
  logSymbolsBasedOnVolPeriod,
  checkMemory,
  calcContinuousKlineIncrease
} = utils

const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')

module.exports = class Manager {
  constructor (exchange, credentials, params) {
    this.exchange = exchange
    this.exchangeId = exchange.id
    this.ohlcvMAsList = [] // 记录所有symbols的k线和MA
    this.workerList = [] // 记录所有active的worker
    this.eventList = [] // 记录买币和卖币events
    this.symbolPool = [] // 统计所有白名单黑名单后，最终会从这个pool里挑选币
    this.simulationResultBalance = undefined // 在模拟中记录的最终BTC balance结果
    this.updateParams(params) // 更新所有params里包含的参数
  }

  updateParams (params) {
    const {
      numberOfPoints,
      padding,
      windows,
      useVolAsCriteria = true,
      whiteList = [],
      blackList = [],
      longVolSymbolNo = 10, // 用长期vol选多少个候选币
      shortVolSymbolNo = 2, // 用短期vol选多少个候选币
      longVolWindow = 24 * 60 / 5,
      shortVolWindow = 4 * 60 / 5,
      logTopVol = false,
      logTopVolWindow = 15 / 5,
      logTopVolSymbolNumber = 10,
      logTopVolThreshold,
      volWindow = 48, // volume均线的window
      buyLimitInBTC = 1, // 最多每个worker花多少BTC买币
      dynamicProfitList,
      useLockProfit = false,
      contiKlineObserveWindow = 4 * 60 / 5, // 连续增长k线看多少点
      logInterval = 5 * 60 * 1000,
      isSimulation = false
    } = params

    this.numberOfPoints = numberOfPoints
    this.padding = padding
    this.windows = windows
    this.volWindow = volWindow
    this.whiteList = whiteList
    this.blackList = blackList
    this.buyLimitInBTC = buyLimitInBTC
    this.dynamicProfitList = dynamicProfitList
    this.useLockProfit = useLockProfit
    this.contiKlineObserveWindow = contiKlineObserveWindow
    this.logInterval = logInterval
    this.isSimulation = isSimulation
    // Vol相关
    this.useVolAsCriteria = useVolAsCriteria
    this.longVolSymbolNo = longVolSymbolNo
    this.shortVolSymbolNo = shortVolSymbolNo
    this.longVolWindow = longVolWindow
    this.shortVolWindow = shortVolWindow
    this.logTopVol = logTopVol
    this.logTopVolWindow = logTopVolWindow
    this.logTopVolSymbolNumber = logTopVolSymbolNumber
    this.logTopVolThreshold = logTopVolThreshold
  }

  _hotReloadParams () {
    try {
      let cachedModule = require.cache[require.resolve('./config')]
      if (cachedModule) {
        delete require.cache[require.resolve('./config')].parent.children // Clear require cache
        delete require.cache[require.resolve('./config')]
      }
      let config
      while (true) { // 用while读config，保证读取出的config是有效的
        try {
          config = require('./config')
          break
        } catch (error) {
          console.log('Reading config file Error')
        }
      }
      this.updateParams(config)
    }
    catch (error) {
      console.log(error)
    }
  }

  /**
   * 给 worker 调用来update worker 状态的callback
   * @param {*} id
   * @param {*} args
   */
  updateWorkerList (id, args) {
    console.log('id, args', id, args)
    let worker = _.find(this.workerList, {id})

    console.log('this.workerList', this.workerList)

    if (worker.done) {
      let workerIdx = _.findIndex(this.workerList, {id})
      this.workerList.splice(workerIdx, 1)
    }
  }

  appendEventList (event) {
    this.eventList.push(event)
  }

  async loadBalance () {
    let newBTCBalance = (await retryQueryTaskIfAnyError(this.exchange, 'fetchBalance', [{'recvWindow': 60 * 10 * 1000}]))['free']['BTC']
    return newBTCBalance
  }

  async fetchData () {
    /**
     * 模拟环境中读取数据
     */
    if (this.isSimulation) {
      let BTCBalance = this.exchange.nextStep()
      if (BTCBalance !== undefined) {
        this.simulationResultBalance = BTCBalance
        return
      }
      this.ohlcvMAsList = calcMovingAverge(this.exchange.ohlcvMAsList, this.windows)
    }
    /**
     * 生产环境中读取数据
     */
    else {
      let ohlcvList
      /**
       * 初始fetch，获取所有所需数据
       */
      if (!this.ohlcvMAsList || !this.ohlcvMAsList.length) {
        await this.exchange.loadMarkets()
        let symbols = _.filter(this.exchange.symbols, symbol => symbol.endsWith('BTC'))
        ohlcvList = await klineListGetDuringPeriod(this.exchangeId, symbols, this.numberOfPoints + this.padding)
      }
      /**
       * 后续fetch，仅获取更新的数据
       */
      else {
        ohlcvList = await fetchNewPointAndAttach(this.ohlcvMAsList, this.exchangeId, this.windows)
      }
      /**
       * 计算MA
       */
      this.ohlcvMAsList = calcMovingAverge(ohlcvList, this.windows)
    }
  }

  _getWhiteList (whiteList, volumeWhiteListLong, volumeWhiteListShort, blackList) {
    /**
     * volumeWhiteListLong 排除掉黑名单已经包括的部分
     */
    volumeWhiteListLong = _.filter(volumeWhiteListLong, o => blackList.indexOf(o) === -1).slice(0, this.longVolSymbolNo)
    /**
     * volumeWhiteListShort 排除掉黑名单及volumeWhiteListLong已经包括的部分
     */
    volumeWhiteListShort = _.filter(volumeWhiteListShort, o => {
      return volumeWhiteListLong.indexOf(o) === -1 && blackList.indexOf(o) === -1
    }).slice(0, this.shortVolSymbolNo)
    /**
     * 生成最终白名单
     */
    let whiteListSet = new Set([...whiteList, ...volumeWhiteListLong, ...volumeWhiteListShort])
    /*
    * 删除黑名单中的部分
    * */
    blackList && blackList.forEach(symbol => whiteListSet.delete(symbol))
    return [...whiteListSet]
  }

  klineMatchCriteria (ohlcvMAs) {
    let klineIdx = ohlcvMAs.data.length - 1
    /**
     * 检查 volume 条件
     */
    let isVolumeIncreaseFast = (ohlcvMAs.data[klineIdx].volume / ohlcvMAs.data[klineIdx - 1].volume) > 1
    let volumeList = ohlcvMAs.data.slice(klineIdx - this.volWindow + 1, klineIdx + 1).map(o => o.volume)
    let volumeAvg = _.mean(volumeList)
    let isVolumeHigherThanAvg = volumeList.slice(-1)[0] > volumeAvg
    let matchVolCriteria = isVolumeIncreaseFast && isVolumeHigherThanAvg
    /**
     * 检查 price 条件
     */
    let isFastMAGreater = (ohlcvMAs.data[klineIdx][`MA${this.windows[0]}`] >= ohlcvMAs.data[klineIdx][`MA${this.windows[1]}`]) && (ohlcvMAs.data[klineIdx][`MA${this.windows[0]}`] >= ohlcvMAs.data[klineIdx][`MA${this.windows[2]}`])
    let isMiddleMAGreater = ohlcvMAs.data[klineIdx][`MA${this.windows[1]}`] >= ohlcvMAs.data[klineIdx][`MA${this.windows[2]}`]
    let priceGreaterThanFastMA = ohlcvMAs.data[klineIdx].close > ohlcvMAs.data[klineIdx][`MA${this.windows[0]}`]
    let isFastMAIncreasing = ohlcvMAs.data[klineIdx][`MA${this.windows[0]}`] > ohlcvMAs.data[klineIdx - 1][`MA${this.windows[0]}`]
    let isMiddleMAIncreasing = ohlcvMAs.data[klineIdx][`MA${this.windows[1]}`] > ohlcvMAs.data[klineIdx - 1][`MA${this.windows[1]}`]
    let isSlowMAIncreasing = ohlcvMAs.data[klineIdx][`MA${this.windows[2]}`] > ohlcvMAs.data[klineIdx - 1][`MA${this.windows[2]}`]
    let isKlineHigherThanPrevPoint = (ohlcvMAs.data[klineIdx].open > ohlcvMAs.data[klineIdx - 1].open) && (ohlcvMAs.data[klineIdx].close > ohlcvMAs.data[klineIdx - 1].close)
    let matchPriceCriteria = isFastMAGreater && isMiddleMAGreater && priceGreaterThanFastMA && isFastMAIncreasing && isMiddleMAIncreasing && isSlowMAIncreasing && isKlineHigherThanPrevPoint

    return matchVolCriteria && matchPriceCriteria
  }

  /**
   * @param {*} ohlcvMAs
   * @param {*} klineIndex 用来判断是否满足条件的kline的Index
   */
  checkBuyingCriteria (ohlcvMAs) {
    let currentKlineMatchCriteria = this.klineMatchCriteria(ohlcvMAs)
    return currentKlineMatchCriteria
  }

  _pickSymbolsFromMarket () {
    /**
     * 获得名单备选池
     */
    if (this.useVolAsCriteria) {
      let topVolumeList = getTopVolume(this.ohlcvMAsList, undefined, this.longVolWindow)
      let volumeWhiteListLong = (topVolumeList).map(o => `${o.symbol}`)
      topVolumeList = getTopVolume(this.ohlcvMAsList, undefined, this.shortVolWindow)
      let volumeWhiteListShort = (topVolumeList).map(o => `${o.symbol}`)

      let prevPoolStr = JSON.stringify(this.symbolPool)
      this.symbolPool = this._getWhiteList(this.whiteList, volumeWhiteListLong, volumeWhiteListShort, this.blackList)
      if (JSON.stringify(this.symbolPool) !== prevPoolStr) {
        // 如果symbolPool变化了，则log新Pool
        log(`SymbolPool: ${this.symbolPool}`.yellow)
      }
    }
    else {
      let whiteList = _.filter(this.exchange.symbols, o => o.endsWith('/BTC'))
      this.symbolPool = this._getWhiteList(whiteList, [], [], this.blackList)
      log(`symbolPool: all except blackList, ${this.symbolPool.length} symbols in total`.yellow)
    }

    /**
     * 获得购买池 - 挑出现在买该哪些币
     */
    let buyingPool = []
    for (let ohlcvMAs of this.ohlcvMAsList) {
      /**
       * 过滤不在名单候选池中的币
       * */
      if (this.symbolPool.length > 0) {
        if (!this.symbolPool.includes(ohlcvMAs.symbol)) {
          continue
        }
      }
      /**
       * 过滤已经买入的币
       * */
      let boughtSymbols = this.workerList.map(worker => worker.symbol)
      if (boughtSymbols.indexOf(ohlcvMAs.symbol) > -1) {
        continue
      }
      /**
       * 过滤不符合买入条件的币
       */
      let matchBuyingCriteria = this.checkBuyingCriteria(ohlcvMAs)
      if (matchBuyingCriteria) {
        log(`Should buy ${ohlcvMAs.symbol} - last 4 klines\n`, ohlcvMAs.data.slice(-4).map(o => JSON.stringify(o)).join('\n'))
        buyingPool.push(ohlcvMAs.symbol)
      }
    }

    return buyingPool
  }
  /**
   * 为买新币筹措BTC：让worker取消掉止盈orders，卖掉部分现有币，并重新创建止盈order
   * @param {*} worker
   * @param {*} toSellBTCAmount
   */
  async _createPartiallySellPromise (worker, toSellBTCAmount) {
    let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol: worker.symbol})
    await worker.cancelCutProfitOrders()
    await worker.marketSell(ohlcvMAs, toSellBTCAmount)
    await worker.createCutProfitOrders(ohlcvMAs)
  }

  /**
   * 创建worker，买入币，并创建止盈
   * @param {*} pickedSymbol
   * @param {*} BTCForEachWorker
   */
  async _createWorkersToBuySymbols (pickedSymbol, BTCForEachWorker) {
    let id = uuid()
    let worker = new Worker(id, pickedSymbol, this.exchange, this.dynamicProfitList, BTCForEachWorker)
    this.workerList.push(worker)

    let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol: worker.symbol})
    await worker.marketBuy(ohlcvMAs)
    await worker.createCutProfitOrders(ohlcvMAs)
  }

  /**
   * 创建worker，买新币，每个币的买入的额度为均分所有BTC给现有worker和新worker
   * @param {*} pickedSymbols // 从market里选出要买的symbols
   */
  async _buySymbols (pickedSymbols) {
    try {
      /**
       * 计算每个symbol要花多少比特币买
       */
      let balanceBTC = await this.loadBalance()
      let updateWorkerRemainingBTCPromises = this.workerList.map(worker => worker.updateRemainingBTCAmount())
      await Promise.all(updateWorkerRemainingBTCPromises)
      let totalWorkersHoldedBTC = this.workerList.reduce((sum, worker) => sum + worker.remainingBTC, 0)
      // let workerHoldedBTC = await this.workerList.reduce(async (sum, worker) => sum + worker.getRemainingBTCAmount(), 0)
      let BTCForEachWorker = Math.min((totalWorkersHoldedBTC + balanceBTC) / (pickedSymbols.length + this.workerList.length), this.buyLimitInBTC)
      /**
       * 如果BTC不够，则让现有worker卖出一部分持有币
       */
      let requiredBTC = BTCForEachWorker * pickedSymbols.length
      if (requiredBTC > balanceBTC) {
        /**
         * 让现有worker卖出部分币，好抓住新机会
         */
        let neededAmount = requiredBTC - balanceBTC // 需要worker卖出的量
        let getBTCpromises = []
        for (let worker of this.workerList) {
          if (worker.remainingBTC > BTCForEachWorker) {
            let toSellBTCAmount = worker.remainingBTC - BTCForEachWorker
            getBTCpromises.push(this._createPartiallySellPromise(worker, toSellBTCAmount))
            neededAmount -= toSellBTCAmount
            if (neededAmount < 0) { // 攒够了足够多的BTC
              break
            }
          }
        }
        await Promise.all(getBTCpromises)
        balanceBTC = await this.loadBalance()
      }

      /**
       * 创建workers并买币
       */
      BTCForEachWorker = Math.min(balanceBTC / pickedSymbols.length, this.buyLimitInBTC) // 每个币要花的BTC
      let buySymbolPromises = pickedSymbols.map(pickedSymbol => {
        return this._createWorkersToBuySymbols(pickedSymbol, BTCForEachWorker)
      })

      await Promise.all(buySymbolPromises)
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * 创建promise，如果worker应该卖，就return worker，否则return undefined
   * @param {Object} worker
   */
  async createReturnWorkerIfShouldSellPromise (worker) {
    let currentOhlcvMAs = _.find(this.ohlcvMAsList, {symbol: worker.symbol})

    let shouldLockProfit = false
    /**
     * 是否锁定收益：止盈线被触发，且当前价格小于等于成本价 (lastPickedTrade.buyPrice)
     * */
    if (this.useLockProfit) {
      let priceDropThroughCost = currentOhlcvMAs.data.slice(-1)[0].close <= worker.buyPrice
      if (priceDropThroughCost) { // 判断止盈线是否被触发
        log(`Current price ${currentOhlcvMAs.data.slice(-1)[0].close} <= Purchase price ${worker.buyPrice}`.green)
        await worker.updateCutProfitFilledAmount()
        if (worker.orderFilledAmount > 0) {
          shouldLockProfit = true
        }
      }
    }

    let dropThroughKline = false
    let fastMADropThroughMiddleMA = false
    let volumeLessThanPrevPoint = false
    /*
    * 如果是在当前kline买入，需要等kline结束才判断是否dropThroughKline
    * */
    if (currentOhlcvMAs.data.slice(-1)[0].timeStamp > worker.buyTimeStamp) {
      // 生产环境中，卖出是用前一根kline判断
      let sellKline = currentOhlcvMAs.data.length - 2
      let fastMA = `MA${this.windows[0]}`
      let mediumMA = `MA${this.windows[1]}`
      dropThroughKline = currentOhlcvMAs.data[sellKline].close < currentOhlcvMAs.data[sellKline][fastMA]
      fastMADropThroughMiddleMA = currentOhlcvMAs.data[sellKline][fastMA] < currentOhlcvMAs.data[sellKline][mediumMA] && currentOhlcvMAs.data[sellKline - 1][fastMA] > currentOhlcvMAs.data[sellKline - 1][mediumMA]
      // 暂停volume缩小时卖出的条件
      // volumeLessThanPrevPoint = (currentOhlcvMAs.data[sellKline].volume / currentOhlcvMAs.data[sellKline - 1].volume) < 0.5
    }
    /**
     * 如果任一条件满足，则返回worker
     */
    if (shouldLockProfit || dropThroughKline || fastMADropThroughMiddleMA || volumeLessThanPrevPoint) {
      log(`--- ${worker.symbol} shouldLockProfit ${shouldLockProfit} dropThroughKline ${dropThroughKline} fastMADropThroughMiddleMA ${fastMADropThroughMiddleMA} volumeLessThanPrevPoint ${volumeLessThanPrevPoint}`.yellow)
      log(`Should sell ${worker.symbol} last 4 klines\n`, currentOhlcvMAs.data.slice(-4).map(o => JSON.stringify(o)).join('\n'))
      return worker
    }
    else {
      return undefined
    }
  }

  async _checkIfWorkersShouldSell () {
    let checkWorkerShouldSellPromises = this.workerList.map(worker =>
      this.createReturnWorkerIfShouldSellPromise(worker)
    )
    let checkWorkerShouldSellResult = await Promise.all(checkWorkerShouldSellPromises)
    let shouldSellWorkers = _.filter(checkWorkerShouldSellResult, o => !!o)
    return shouldSellWorkers
  }

  /**
   * toSellWorkers卖币，并从this.workerList里删除这些workers
   * @param {*} toSellWorkers
   */
  async _workersSellAndRemove (toSellWorkers) {
    let workerSellPromises = toSellWorkers.map(async worker => {
      let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol: worker.symbol})
      await worker.cancelCutProfitOrders()
      return worker.marketSell(ohlcvMAs)
    })
    await Promise.all(workerSellPromises)

    for (let worker of toSellWorkers) {
      let workerIdx = _.findIndex(this.workerList, {id: worker.id})
      this.workerList.splice(workerIdx, 1)
    }
  }

  /**
   * 将当前的状态log到terminal里
   */
  _logState () {
    let timeEpoch = Number(this.ohlcvMAsList[0].data.slice(-1)[0].timeStamp)
    let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
    log(`Current Time: ${moment().format('MMMM Do YYYY, h:mm:ss a')}, Data time: ${currentTime}`.green)
    if (this.workerList.length > 0) {
      log(`Currently holding ${this.workerList.map(o => o.symbol).join(' ')}`)
    }
    log(`SymbolPool: ${this.symbolPool}`.yellow)
  }

  _logMarket () {
    let klineIncreaseStatList = []
    for (let symbol of this.symbolPool) {
      let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol})
      let klineIncreaseStat = calcContinuousKlineIncrease(ohlcvMAs, this.contiKlineObserveWindow)
      klineIncreaseStatList.push(klineIncreaseStat)
      log(`${symbol} increase: ${JSON.stringify(klineIncreaseStat)}`.yellow)
    }
    let marketStat = {
      mean: _.mean(klineIncreaseStatList.map(o => Number(o.mean))).toFixed(2),
      sum: _.mean(klineIncreaseStatList.map(o => Number(o.sum))).toFixed(2),
      median: _.mean(klineIncreaseStatList.map(o => Number(o.median))).toFixed(2)
    }
    log(`market average: ${JSON.stringify(marketStat)}`.yellow)
  }

  async start () {
    let logTimer = new Date().getTime() - this.logInterval

    log(`---------- Running in Production ----------`.blue)
    log(`---------- Fetching Balance ----------`.green)
    let balance = await this.loadBalance()
    log(`---        BTC Balance - ${balance}`.green)
    log(`---------- Fetching Balance ---------- \n`.green)
    while (true) {
      try {
        /**
         * 获取新数据
         */
        await this.fetchData()
        /**
         * 检查在模拟，并且获得了结果
         */
        if (this.simulationResultBalance) return this.simulationResultBalance
        /**
         * 检查是否需要卖币
         */
        let toSellWorkers = await this._checkIfWorkersShouldSell()
        /**
         * 卖币
         */
        if (toSellWorkers.length > 0) {
          this._logState()
          await this._workersSellAndRemove(toSellWorkers)
          this._logState()
        }
        /**
         * 检查是否需要买币
         */
        this.logTopVol && logSymbolsBasedOnVolPeriod(this.ohlcvMAsList, this.logTopVolWindow, this.logTopVolSymbolNumber, this.logTopVolThreshold, this.symbolPool)
        let pickedSymbols = this._pickSymbolsFromMarket()// 检查是否有该买的currency
        /**
         * 买币
         */
        if (pickedSymbols.length > 0) {
          this._logState()
          await this._buySymbols(pickedSymbols)
          this._logState()
        }
        /**
         * Log市场情况和当前状态
         */
        if (new Date().getTime() - logTimer > this.logInterval) {
          logTimer = new Date().getTime()
          this._logState()
          this._logMarket()
        }
        /**
         * 热更新参数
         */
        this._hotReloadParams()
        /**
         * 检查内存
         */
        // checkMemory()
      } catch (error) {
        console.log('Major error', error)
        break
      }
    }
  }
}
