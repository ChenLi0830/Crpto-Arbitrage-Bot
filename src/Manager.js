// 'use strict'
const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
const {saveJsonToCSV} = require('./utils')
require('ansicolor').nice
const moment = require('moment')
const credentials = require('../credentials')
const {MinorError, MajorError} = require('./utils/errors')
const utils = require('./utils')
const player = require('play-sound')(opts = {})
const Worker = require('./Worker')
const uuid = require('uuid/v4')

const {
  retryMutationTaskIfTimeout,
  retryQueryTaskIfAnyError,
  cutExtractedInfoList,
  getTopVibrated,
  getTopVolume,
  getTopWeighted,
  addVibrateValue,
  addBTCVolValue,
  generateCutProfitList,
  addPaddingExtractedInfoList,
  fetchNewPointAndAttach,
  calcMovingAverge,
  logSymbolsBasedOnVolPeriod
} = utils

const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')

module.exports = class Manager {
  constructor (exchangeId = 'binance', credentials, params) {
    const {
      numberOfPoints,
      padding,
      windows,
      useVolAsCriteria = false, // todo 改回true
      whiteList = [],
      blackList = [],
      longVolSymbolNo = 10, // 用长期vol选多少个候选币
      shortVolSymbolNo = 2, // 用短期vol选多少个候选币
      longVolWindow = 24 * 60 / 5,
      shortVolWindow = 4 * 60 / 5,
      logTopVolWindow = 15 / 5,
      logTopVolSymbolNumber = 10,
      logTopVolThreshold,
      volWindow = 48, // volume均线的window
      buyLimitInBTC = 1, // 最多每个worker花多少BTC买币
      dynamicProfitList,
    } = params

    this.exchangeId = exchangeId
    this.exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials))
    this.numberOfPoints = numberOfPoints
    this.padding = padding
    this.windows = windows
    this.volWindow = volWindow
    this.whiteList = whiteList
    this.blackList = blackList
    this.buyLimitInBTC = buyLimitInBTC
    this.dynamicProfitList = dynamicProfitList

    // Vol相关
    this.useVolAsCriteria = useVolAsCriteria
    this.longVolSymbolNo = longVolSymbolNo
    this.shortVolSymbolNo = shortVolSymbolNo
    this.longVolWindow = longVolWindow
    this.shortVolWindow = shortVolWindow
    this.logTopVolWindow = logTopVolWindow
    this.logTopVolSymbolNumber = logTopVolSymbolNumber
    this.logTopVolThreshold = logTopVolThreshold

    this.ohlcvMAsList = [] // 记录所有symbols的k线和MA
    this.workerList = [] // 记录所有active的worker
    this.eventList = [] // 记录买币和卖币events
    this.symbolPool = [] // 统计所有白名单黑名单后，最终会从这个pool里挑选币
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

  async buyCurrency (symbol) {
    let id = uuid()
    let worker = new Worker(id, symbol)
    this.workerList.push(worker)
  }

  _getWhiteList (whiteList, volumeWhiteList24H, volumeWhiteList4H, blackList) {
    let whiteListSet = new Set([...whiteList, ...volumeWhiteList24H.slice(0, this.longVolSymbolNo), ...volumeWhiteList4H.slice(0, this.shortVolSymbolNo)])
    /*
    * 删除黑名单中的部分
    * */
    blackList && blackList.forEach(symbol => whiteListSet.delete(symbol))
    return [...whiteListSet]
  }

  klineMathCriteria (ohlcvMAs, klineIdx) {
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
    let isNewKline = process.env.PRODUCTION ? ((new Date().getTime() - ohlcvMAs.data.slice(-1)[0].timeStamp) < 45 * 1000) : false
    let currentIndex = ohlcvMAs.data.length - 1
    let currentKlineMatchCriteria = this.klineMathCriteria(ohlcvMAs, currentIndex)
    let prevIndex = currentIndex - 1
    let prevKlineMatchCriteria = this.klineMathCriteria(ohlcvMAs, prevIndex)

    /*
    * 如果当前k线满足条件，或如果是刚刚生成的k线，判断它之前的k线是否满足条件，如果是则也买入
    * */
    if (currentKlineMatchCriteria || (isNewKline && prevKlineMatchCriteria)) {
      return true
    }
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

      this.symbolPool = this._getWhiteList(this.whiteList, volumeWhiteListLong, volumeWhiteListShort, this.blackList)
      log(`symbolPool: ${this.symbolPool}`.yellow)
    }
    else {
      let whiteList = _.filter(this.exchange.symbols, o => o.endsWith('/BTC'))
      this.symbolPool = this._getWhiteList(whiteList, [], [], this.blackList)
    }

    /**
     * 获得购买池 - 挑出现在买该哪些币
     */
    let buyingPool = []
    for (let ohlcvMAs of this.ohlcvMAsList) {
      /**
       * 过滤不在名单候选池中的币
       * */
      if (this.symbolPool > 0) {
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
        buyingPool.push(ohlcvMAs.symbol)
      }
    }

    return buyingPool
  }

  async _createPartiallySellPromise (worker, toSellAmount) {
    
    /* 进入一个function rearrangeWorkersBTC，让每个worker先取消orders，然后卖出百分比，然后再设置orders */
  }
  async _createWorkersToBuySymbols (pickedSymbol, BTCForEachWorker) {

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
      let spentBTC = this.workerList.reduce((sum, worker) => sum + worker.BTCAmount, 0)
      let BTCForEachWorker = (spentBTC + balanceBTC) / (pickedSymbols.length + this.workerList.length)
      if (BTCForEachWorker > this.buyLimitInBTC) {
        BTCForEachWorker = this.buyLimitInBTC
      }
      /**
       * 如果BTC不够，则让现有worker卖出一部分持有币
       */
      let requiredBTC = BTCForEachWorker * pickedSymbols.length
      if (requiredBTC < balanceBTC) {
        /**
         * 让现有worker卖出部分币，好抓住新机会
         */
        let neededAmount = requiredBTC - balanceBTC // 需要worker卖出的量
        let getBTCpromises = []
        for (let worker of this.workerList) {
          if (worker.BTCAmount > BTCForEachWorker) {
            let toSellAmount = worker.BTCAmount - BTCForEachWorker
            getBTCpromises.push(this._createPartiallySellPromise(worker, toSellAmount))
            neededAmount -= toSellAmount
            if (neededAmount < 0) { // 攒够了足够多的BTC
              break
            }
          }
        }
        await Promise.all(getBTCpromises)
        balanceBTC = this.loadBalance()
      }

      /**
       * 创建workers并买币
       */
      BTCForEachWorker = balanceBTC / pickedSymbols.length // 每个币要花的BTC
      let buySymbolPromises = pickedSymbols.map(pickedSymbol => {
        return this._createWorkersToBuySymbols(pickedSymbol, BTCForEachWorker)
      })

      await Promise.all(buySymbolPromises)
    } catch (error) {
      console.log(error)
    }
  }

  async start () {
    while (true) {
      try {
        await this.fetchData()
        // 检查是否有改卖的币
        // 如果有，则创建promises，卖掉，并更新worker

        logSymbolsBasedOnVolPeriod(this.ohlcvMAsList, this.logTopVolWindow, this.logTopVolSymbolNumber, this.logTopVolThreshold, this.symbolPool)

        let pickedSymbols = this._pickSymbolsFromMarket()// 检查是否有该买的currency
        pickedSymbols = ['ETH/BTC'] // todo remove
        if (pickedSymbols.length > 0) {
          await this._buySymbols(pickedSymbols)
        }
      } catch (error) {
        console.log(error)
      }

      break // Todo remove in production
    }
  }
}
