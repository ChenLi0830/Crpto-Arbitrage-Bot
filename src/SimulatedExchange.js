const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const _ = require('lodash')
const ccxt = require('ccxt')
const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')
const uuidv4 = require('uuid/v4')

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
      intervalInMillesec,
      ohlcvMAsListSource = []
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
    this.ohlcvMAsListSource = ohlcvMAsListSource // 整个时间段内，需要的数据
    this.ohlcvMAsList = []
    this.limitSellOrders = []
  }

  /**
   * 从数据源里得到在'currentTime'下的ohlcvMAsList
   * @param {*} ohlcvMAsListSource
   * @param {*} currentTime
   * @param {*} length
   */
  _calcOhlcvMAsList () {
    if (this.currentTime === undefined) {
      this.currentTime = this.ohlcvMAsListSource[0].data[this.stepIndex].timeStamp
    }
    /**
     * 让this.stepIndex-1的timeStamp < this.currentTime <= this.stepIndex的timeStamp
     */
    while (this.currentTime > this.ohlcvMAsListSource[0].data[this.stepIndex].timeStamp) {
      this.stepIndex += 1
    }

    let ohlcvMAsList = this.ohlcvMAsListSource.map(ohlcvMAsSource => {
      let ohlcvMAs = {
        ...ohlcvMAsSource,
        data: ohlcvMAsSource.data.slice(this.stepIndex + 1 - (this.numberOfPoints + this.padding), this.stepIndex + 1)
      }
      /**
       * 获得当前时间的ohlcv
       * 假设ohlcv的volume从倒数第二个点到最后一个点是均匀变化的，而close是在low-high之间的随机数，
       * 但当currentTime=最后一点的timeStamp时，close值为真实对应的close
       */
      let timePercent = (this.currentTime - ohlcvMAs.data.slice(-2)[0].timeStamp) / this.intervalInMillesec
      let ohlcv = {
        open: ohlcvMAs.data.slice(-1)[0].open,
        high: ohlcvMAs.data.slice(-1)[0].high,
        low: ohlcvMAs.data.slice(-1)[0].low,
        close: timePercent < 1 ? ohlcvMAs.data.slice(-1)[0].low + Math.random() * (ohlcvMAs.data.slice(-1)[0].high - ohlcvMAs.data.slice(-1)[0].low) : ohlcvMAs.data.slice(-1)[0].close,
        volume: timePercent * ohlcvMAs.data.slice(-1)[0].volume,
        timeStamp: this.currentTime
      }
      ohlcvMAs.data[ohlcvMAs.data.length - 1] = ohlcv
      return ohlcvMAs
    })

    return ohlcvMAsList
  }

  async initExchange () {
    let exchange = new ccxt[this.exchangeId](ccxt.extend({enableRateLimit: true}))
    await exchange.loadMarkets()
    this.symbols = _.filter(exchange.symbols, symbol => symbol.endsWith('BTC'))
    this.markets = exchange.markets
    /**
     * 如果创建实例时没有获得ohlcvMAsListSource，则在此时获取整个时间段内，需要的数据
     */
    if (this.ohlcvMAsListSource.length === 0) {
      let allNumberOfPoints = Math.trunc((this.endTime - this.startTime) / this.intervalInMillesec)
      this.ohlcvMAsListSource = await klineListGetDuringPeriod(this.exchangeId, this.symbols, allNumberOfPoints, this.endTime)
    }
    this.ohlcvMAsList = this._calcOhlcvMAsList()
  }

  nextStep () {
    this.currentTime = `${Number(this.currentTime) + this.stepSizeInMillesec}`
    this.ohlcvMAsList = this._calcOhlcvMAsList()
  }

  fetchBalance () {
    return {
      free: this.balance
    }
  }

  fetchL2OrderBook (symbol) {
    let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol})
    let price = ohlcvMAs.data.slice(-1)[0].close
    return {
      asks: [[price, Infinity]],
      bids: [[price, Infinity]]
    }
  }

  createMarketBuyOrder (symbol, buyInAmount) {
    this.balance[symbol] = this.balance[symbol] === undefined ? buyInAmount : this.balance[symbol] + buyInAmount
    return {
      id: uuidv4(),
      timestamp: new Date().getTime(),
      datetime: new Date(),
      symbol: symbol,
      type: 'market',
      side: 'buy',
      price: 0,
      amount: buyInAmount,
      cost: 0,
      filled: buyInAmount,
      remaining: 0,
      status: 'closed',
      fee: undefined
    }
  }

  fetchOrders (symbol) {
    return this.limitSellOrders
  }

  createMarketSellOrder (symbol, sellAmount) {
    this.balance[symbol] = this.balance[symbol] - sellAmount
    return {
      id: uuidv4(),
      timestamp: new Date().getTime(),
      datetime: new Date(),
      symbol: symbol,
      type: 'market',
      side: 'sell',
      price: 0,
      amount: sellAmount,
      cost: 0,
      filled: sellAmount,
      remaining: 0,
      status: 'closed',
      fee: undefined
    }
  }

  createLimitSellOrder (symbol, amount, price) {
    let id = uuidv4()
    let order = {
      id,
      amount,
      price,
      status: 'open',
      filled: 0
    }
    this.limitSellOrders.push(order)
    return order
  }

  cancelOrder (orderId, symbol) {
    let index = _.findIndex(this.limitSellOrders, {id: orderId})
    this.limitSellOrders.splice(index, 1)
  }
}
