const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const _ = require('lodash')
const ccxt = require('ccxt')

module.exports = class SimulatedExchange {
  constructor (exchangeId = 'binance', balance, tradingFee, startTime, endTime, stepSize, params) {
    this.exchangeId = exchangeId
    this.balance = balance
    this.tradingFee = tradingFee
    this.startTime = startTime
    this.endTime = endTime
    this.stepSize = stepSize

    this.symbols = []
    this.markets = {}
  }

  async initExchange () {
    let exchange = new ccxt[this.exchangeId](ccxt.extend({enableRateLimit: true}))
    await exchange.loadMarkets()
    this.symbols = exchange.symbols
    this.markets = exchange.markets
  }

  fetchBalance () {
    return {
      free: {
        BTC: {

        }
      }
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
