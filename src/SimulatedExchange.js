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
      intervalInMillesec,
      params
    ) {
    this.exchangeId = exchangeId
    this.balance = {BTC: simuBalance}
    this.tradingFee = simuTradingFee
    this.endTime = simuEndTime
    this.startTime = this.endTime - simuDuration
    this.stepSize = simuTimeStepSize
    this.intervalInMillesec = intervalInMillesec

    this.symbols = []
    this.markets = {}
    this.ohlcvMAsListSource = []
  }

  async initExchange () {
    let exchange = new ccxt[this.exchangeId](ccxt.extend({enableRateLimit: true}))
    await exchange.loadMarkets()
    this.symbols = _.filter(exchange.symbols, symbol => symbol.endsWith('BTC'))
    this.markets = exchange.markets

    /**
     * 获取整个时间段内，需要的数据
     */
    let numberOfPoints = Math.trunc((this.endTime - this.startTime) / this.intervalInMillesec)
    this.ohlcvMAsListSource = await klineListGetDuringPeriod(this.exchangeId, this.symbols, numberOfPoints, this.endTime)
  }

  fetchBalance () {
    return {
      free: this.balance
    }
  }

  fetchL2OrderBook (symbol) {
    
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
