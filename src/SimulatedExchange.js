const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const _ = require('lodash')
const ccxt = require('ccxt')

module.exports = class SimulatedExchange {
  constructor (exchangeId = 'binance', simuBalance, simuTradingFee, simuDuration, simuEndTime = new Date().getTime(), simuTimeStepSize, params) {
    this.exchangeId = exchangeId
    this.balance = {BTC: simuBalance}
    this.tradingFee = simuTradingFee
    this.endTime = simuEndTime
    this.startTime = this.endTime - simuDuration
    this.stepSize = simuTimeStepSize

    this.symbols = []
    this.markets = {}
    this.ohlcvMAsListSource = []
  }

  async initExchange () {
    let exchange = new ccxt[this.exchangeId](ccxt.extend({enableRateLimit: true}))
    await exchange.loadMarkets()
    this.symbols = exchange.symbols
    this.markets = exchange.markets

    await _fetchAllNeededData(this.exchangeId, this.startTime, this.endTime)
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
