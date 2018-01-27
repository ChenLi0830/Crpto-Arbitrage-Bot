const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const _ = require('lodash')
const ccxt = require('ccxt')
const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')

module.exports = class SimulatedExchange {
  constructor (
      exchangeId = 'binance',
      simuBalance,
      simuTradingFee,
      simuDuration,
      simuEndTime = new Date().getTime(),
      simuTimeStepSize,
      params
    ) {
    const {
      numberOfPoints,
      padding,
      intervalInMillesec
    } = params

    this.exchangeId = exchangeId
    this.balance = {BTC: simuBalance}
    this.tradingFee = simuTradingFee
    this.numberOfPoints = numberOfPoints
    this.padding = padding
    this.endTime = simuEndTime
    this.startTime = this.endTime - simuDuration
    this.currentTime = undefined // 第一次_calcOhlcvMAsList时，初始化为第一组ohlcvMAsList数据对应的timeStamp
    this.stepSizeInMillesec = simuTimeStepSize
    this.stepIndex = this.padding + this.numberOfPoints - 1 // 用来记录上一个currentTime对应在ohlcvMAsListSource的index是多少
    this.intervalInMillesec = intervalInMillesec

    this.symbols = []
    this.markets = {}
    this.ohlcvMAsListSource = []
    this.ohlcvMAsList = []
  }

  /**
   * 从数据源里得到在'currentTime'下的ohlcvMAsList
   * @param {*} ohlcvMAsListSource
   * @param {*} currentTime
   * @param {*} length
   */
  _calcOhlcvMAsList () {
    if (this.currentTime === undefined) {
      this.currentTime = this.ohlcvMAsListSource[this.stepIndex].data.timeStamp
    }
    /**
     * 让this.stepIndex-1的timeStamp < this.currentTime <= this.stepIndex的timeStamp
     */
    while (this.currentTime > this.ohlcvMAsListSource[this.stepIndex].data.timeStamp) {
      this.stepIndex += 1
    }
    let ohlcvMAsList = this.ohlcvMAsListSource.slice(this.stepIndex - (this.numberOfPoints + this.padding) + 1, this.stepIndex)
    /**
     * 获得当前时间的ohlcv
     * 假设ohlcv的volume从倒数第二个点到最后一个点是均匀变化的，且当时价格是在low-high之间的随机数
     */
    let volPercent = (this.currentTime - ohlcvMAsList.slice(-2)[0].timeStamp) / this.intervalInMillesec
    let ohlcv = {
      open: ohlcvMAsList.slice(-2)[1].open,
      high: ohlcvMAsList.slice(-2)[1].high,
      low: ohlcvMAsList.slice(-2)[1].low,
      close: ohlcvMAsList.slice(-2)[1].low + Math.random() * (ohlcvMAsList.slice(-2)[1].high - ohlcvMAsList.slice(-2)[1].low),
      volume: volPercent * ohlcvMAsList.slice(-1)[0].volume,
      timeStamp: this.currentTime
    }
    ohlcvMAsList[ohlcvMAsList.length - 1] = ohlcv
    return ohlcvMAsList
  }

  async initExchange () {
    let exchange = new ccxt[this.exchangeId](ccxt.extend({enableRateLimit: true}))
    await exchange.loadMarkets()
    this.symbols = _.filter(exchange.symbols, symbol => symbol.endsWith('BTC'))
    this.markets = exchange.markets
    /**
     * 获取整个时间段内，需要的数据
     */
    let allNumberOfPoints = Math.trunc((this.endTime - this.startTime) / this.intervalInMillesec)
    this.ohlcvMAsListSource = await klineListGetDuringPeriod(this.exchangeId, this.symbols, allNumberOfPoints, this.endTime)
    this.ohlcvMAsList = this._calcOhlcvMAsList()
  }

  nextStep () {
    this.currentTime += this.stepSizeInMillesec
    this.ohlcvMAsList = this._calcOhlcvMAsList()
  }

  fetchBalance () {
    return {
      free: this.balance
    }
  }

  fetchL2OrderBook (symbol) {
    let price = this.ohlcvMAsList[symbol].slice(-1)[0]
    return {
      asks: [price, Infinity],
      bids: [price, Infinity],
    }
  }

  createMarketBuyOrder (symbol, buyInAmount) {

  }

  fetchOrders (symbol) {

  }

  createMarketSellOrder (symbol, sellAmount) {

  }

  createLimitSellOrder (symbol, amount, price) {

  }

  cancelOrder (orderId, symbol) {

  }

}
