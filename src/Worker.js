const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const _ = require('lodash')
const SimulatedExchange = require('./SimulatedExchange')
const {
  generateCutProfitList,
  retryMutationTaskIfTimeout,
  retryQueryTaskIfAnyError,
  getTargetCurrencyFromSymbol
} = require('./utils')

const api = require('./api')

module.exports = class Worker {
  constructor (id, symbol, exchange, dynamicProfitList, BTCAmount, params = {}) {
    const {
      maxPartialSellPercent = 50
    } = params
    this.id = id
    this.symbol = symbol
    this.exchange = exchange
    this.BTCAmount = BTCAmount
    this.dynamicProfitList = dynamicProfitList
    this.maxPartialSellPercent = maxPartialSellPercent

    this.currencyAmount = undefined // 买了多少币
    this.buyPrice = undefined // 购买价格
    this.buyTimeStamp = undefined // 购买时k线的timeStamp
    this.limitOrders = []
    this.orderFilledAmount = 0 // 创建的limit sell order被filled了多少
    this.remainingBTC = BTCAmount

    this.player = (this.exchange instanceof SimulatedExchange) ? null : require('play-sound')()
  }

  async marketBuy (ohlcvMAs) {
    let orderBook = await retryQueryTaskIfAnyError(this.exchange, 'fetchL2OrderBook', [this.symbol])
    let weightedPrices = api.weightedPrice(orderBook.asks, this.BTCAmount)

    let askedPriceHigh = weightedPrices.tradePrice
    let weightedPrice = weightedPrices.avgPrice
    log(`--- Start Task: Worker for ${this.symbol} is buying at ${weightedPrice} with BTCAmount ${this.BTCAmount}`.blue)

    if (this.player) {
      this.player.play('./src/Glass.aiff', (err) => {
        if (err) throw err
      })
    }

    /**
     * 买三次，避免买不到
     * */
    let maxAmount = this.BTCAmount * 0.999 / askedPriceHigh
    let buyInAmount = maxAmount * 0.7
    buyInAmount = buyInAmount > 1 ? Math.trunc(buyInAmount) : buyInAmount
    let buyResult = await retryMutationTaskIfTimeout(this.exchange, 'createMarketBuyOrder', [this.symbol, buyInAmount, {'recvWindow': 60 * 10 * 1000}])
    console.log('buyResult', buyResult)
    if (!buyResult || buyResult.status !== 'closed') {
      throw new Error('Purchase error!')
    }

    let boughtAmount = Number(buyResult.amount)

    try {
      let buyInAmount = maxAmount * 0.21
      buyInAmount = buyInAmount > 1 ? Math.trunc(buyInAmount) : buyInAmount
      let buyResult = await retryMutationTaskIfTimeout(this.exchange, 'createMarketBuyOrder', [this.symbol, buyInAmount, {'recvWindow': 60*10*1000}])
      log(`Second buy result`, buyResult)
      if (!buyResult || buyResult.status !== 'closed') {
        throw new Error('Second purchase error!')
      }

      boughtAmount += Number(buyResult.amount)

      buyInAmount = maxAmount * 0.07
      buyInAmount = buyInAmount > 1 ? Math.trunc(buyInAmount) : buyInAmount
      buyResult = await retryMutationTaskIfTimeout(this.exchange, 'createMarketBuyOrder', [this.symbol, buyInAmount, {'recvWindow': 60*10*1000}])
      log(`Third buy result`, buyResult)
      if (!buyResult || buyResult.status !== 'closed') {
        throw new Error('Third purchase error!')
      }

      boughtAmount += Number(buyResult.amount)
    }
    catch (error) {
      log(`Second or third buy error, relatively ok ${error}`.red)
    }

    this.buyPrice = weightedPrice
    this.currencyAmount = boughtAmount
    this.buyTimeStamp = ohlcvMAs.data.slice(-1)[0].timeStamp
    log(`--- Finished task: Worker finish buying ${this.currencyAmount} ${this.symbol} at the price: ${this.buyPrice}; Total BTC of this worker: ${this.BTCAmount}\n`.green)
  }

  /**
   * 查看有多少orders被filled了，并更新this.filledAmount
   * @param {*} [fetchedOrders] // 如果没有定义，则会调用fetchOrders获得
   */
  async updateCutProfitFilledAmount (fetchedOrders) {
    /*
    * 查看limit order的filled amount
    * */
    if (!fetchedOrders) {
      fetchedOrders = await retryQueryTaskIfAnyError(this.exchange, 'fetchOrders', [this.symbol])
    }
    let filledAmount = 0
    for (let limitOrder of this.limitOrders) {
      let currentOrderStatus = _.find(fetchedOrders, {id: limitOrder.id})
      if (currentOrderStatus.status === 'closed') { // 止盈order被filled了
        filledAmount += limitOrder.amount
      }
      else if (currentOrderStatus.status === 'open') { // 止盈order未被filled，或被filled一部分
        filledAmount += Math.min(currentOrderStatus.filled, limitOrder.amount) // filled是safeFloat，可能跟实际值有出入
      }
    }
    log(`Total filledAmount ${filledAmount}`)
    this.filledAmount = filledAmount
  }

  async updateRemainingBTCAmount () {
    await this.updateCutProfitFilledAmount()
    this.remainingBTC = ((this.currencyAmount - this.filledAmount) / this.currencyAmount) * this.BTCAmount
  }

  /**
   * 用市场价卖出，获得targetBTCAmount的BTC，若为targetBTCAmount 为undefined，则卖出全部
   * @param {*} ohlcvMAs
   * @param {Number} [targetBTCAmount] 要获得多少BTC，默认为undefined
   */
  async marketSell (ohlcvMAs, targetBTCAmount = undefined) {
    let targetCurrency = getTargetCurrencyFromSymbol(this.symbol)
    let targetBalance = (await retryQueryTaskIfAnyError(this.exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free'][targetCurrency]
    let sellAmount
    /**
     * sellAmount = 全卖
     * */
    if (targetBTCAmount === undefined) {
      sellAmount = targetBalance
    }
    /**
     * sellAmount = 卖一部分，最多一半
     * */
    else {
      let targetCurrencyAmount = targetBTCAmount / ohlcvMAs.data.slice(-1)[0].close
      let maxPartialSellAmount = targetBalance * (this.maxPartialSellPercent / 100)
      sellAmount = Math.min(targetCurrencyAmount, maxPartialSellAmount)
    }

    log(`--- Start Task: Worker for ${this.symbol} is selling ${targetCurrency}, balance ${targetBalance}, sell amount ${sellAmount}`.green)

    if (targetBTCAmount === undefined) { // 全卖时播放声音
      if (this.player) {
        this.player.play('./src/Purr.aiff', (err) => {
          if (err) throw err
        })
      }
    }

    let minSellAmount = this.exchange.markets[this.symbol].limits.amount.min
    if (sellAmount < minSellAmount) {
      /**
       * 如果小于所能卖出的最小值，则认为是已经被用户或止盈卖光了
       * */
      log(`${this.symbol} has already been sold by user or limit orders`.yellow)
    }
    else {
      /**
       * 卖币
       * */
      let sellResult = await retryMutationTaskIfTimeout(this.exchange, 'createMarketSellOrder', [this.symbol, sellAmount, {'recvWindow': 60*10*1000}])
      log(`--- Selling Result`.blue, sellResult)
    }
    this.BTCAmount = targetBTCAmount ? this.BTCAmount - sellAmount * ohlcvMAs.data.slice(-1)[0].close : this.BTCAmount
    this.currencyAmount = this.currencyAmount - sellAmount
  }

  async recreateCancelledProfitOrders () {
    try {
      log(`--- Start Task: Worker for ${this.symbol} is recreating cancelled orders`.green)
      let fetchedOrders = await retryQueryTaskIfAnyError(this.exchange, 'fetchOrders', [this.symbol])
      /**
       * 找到最近创建的orders当两个order之间相差10秒，则视为同时下的order
       * */
      console.log('fetchedOrders', fetchedOrders)
      fetchedOrders = _.filter(fetchedOrders, {type: 'limit', side: 'sell'}) // 只保留limit sell orders
      fetchedOrders = _.sortBy(fetchedOrders, order => -order.timestamp)
      let canceledOrders = _.filter(fetchedOrders, order => (fetchedOrders[0].timestamp - order.timestamp < 10 * 1000) && order.status === 'canceled')
      /**
       * 重建order
       */
      let limitOrderTotalPercent = _.sumBy(this.dynamicProfitList, o => o.percent)
      let totalOrderAmount = canceledOrders.reduce((sum, order) => sum + order.amount, 0)
      let recreateOrderPromises = canceledOrders.map(order => {
        let orderPercent = (order.amount / totalOrderAmount) * limitOrderTotalPercent
        let cutAmount = this.currencyAmount * orderPercent / 100
        return retryMutationTaskIfTimeout(this.exchange, 'createLimitSellOrder', [this.symbol, cutAmount, order.price, {'recvWindow': 60 * 10 * 1000}])
      })

      let limitOrders = []
      await Promise.all(recreateOrderPromises.map(async (recreateOrderPromise, i) => {
        try {
          let limitOrderResult = await recreateOrderPromise
          console.log('limitOrderResult', limitOrderResult)
          if (limitOrderResult && limitOrderResult.id) {
            limitOrders.push({
              id: limitOrderResult.id,
              amount: limitOrderResult.amount
            })
          }
        } catch (error) {
          console.log(this.id, this.symbol, error)
          log(`recreateLimitOrdersResult error, often because of not enough balance, ignored`.red)
        }
      }))

      this.limitOrders = limitOrders
      this.orderFilledAmount = 0

      log(`--- Finished task: Worker for ${this.symbol} finished recreating canceled orders\n`.green)
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * 设置止盈：创建 limit sell orders
   * @param {*} ohlcvMAs
   */
  async createCutProfitOrders (ohlcvMAs) {
    try {
      if (!this.currencyAmount) {
        throw new Error(`CreateCutProfitOrders: must buy symbol first`)
      }
      let cutProfitList = generateCutProfitList(ohlcvMAs, 60 / 5, this.dynamicProfitList)

      log(`--- Start Task: Worker for ${this.symbol} is creating limit sell orders`.green)

      let createLimitOrderPromises = cutProfitList.map(cutProfit => {
        let cutAmount = this.currencyAmount * cutProfit.percent / 100
        return retryMutationTaskIfTimeout(this.exchange, 'createLimitSellOrder', [this.symbol, cutAmount, this.buyPrice * (100 + cutProfit.value) / 100, {'recvWindow': 60 * 10 * 1000}])
      })

      let limitOrders = []
      await Promise.all(createLimitOrderPromises.map(async (createOrderPromise, i) => {
        try {
          let limitOrderResult = await createOrderPromise
          console.log('limitOrderResult', limitOrderResult)
          if (limitOrderResult && limitOrderResult.id) {
            limitOrders.push({
              id: limitOrderResult.id,
              amount: limitOrderResult.amount
            })
          }
        } catch (error) {
          console.log(this.id, this.symbol, error)
          log(`createLimitOrdersResult error, often because of not enough balance, ignored`.red)
        }
      }))

      this.limitOrders = limitOrders
      this.orderFilledAmount = 0

      log(`--- Finished task: Worker for ${this.symbol} finished creating limit orders ${JSON.stringify(limitOrders)}\n`.green)
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * 取消止盈单
   */
  async cancelCutProfitOrders () {
    log(`--- Start Task: Worker for ${this.symbol} is cancelling limit sell orders`.green)
    let fetchedOrders = await retryQueryTaskIfAnyError(this.exchange, 'fetchOrders', [this.symbol])
    await this.updateCutProfitFilledAmount(fetchedOrders)
    /**
     * 取消被程序创建且当前为open的order
     * */
    let orderIds = []
    fetchedOrders.forEach(obj => obj.status === 'open' && orderIds.push(obj.id))
    orderIds = _.filter(orderIds, id => this.limitOrders.map(order => order.id).indexOf(id) > -1)

    let cancelOrderPromises = orderIds.map(orderId => retryMutationTaskIfTimeout(this.exchange, 'cancelOrder', [orderId, this.symbol, {'recvWindow': 60*10*1000}]))

    let results = await Promise.all(cancelOrderPromises)
    console.log('results', results)

    this.limitOrders = []
    this.orderFilledAmount = 0

    log(`--- Finished task: Worker for ${this.symbol} finished cancelling open orders\n`.green)
  }
}
