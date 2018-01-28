const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const _ = require('lodash')
const ccxt = require('ccxt')
const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')
const uuidv4 = require('uuid/v4')
const moment = require('moment')
const {
  getTargetCurrencyFromSymbol,
  saveJsonToCSV
} = require('./utils')

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
    this.tradingRecord = []
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

  resetSimulation () {
    this.currentTime = undefined
    this.stepIndex = this.padding + this.numberOfPoints - 1
    this.limitSellOrders = []
    this.tradingRecord = []
    this.ohlcvMAsList = this._calcOhlcvMAsList()
  }

  /**
   * 模拟市场经历了stepSizeInMillesec时间的变化
   */
  nextStep () {
    this.currentTime = `${Number(this.currentTime) + this.stepSizeInMillesec}`
    if (this.currentTime > this.endTime) {
      /**
       * 模拟过程结束: 统计BTC余额，保存tradingRecord
       */
      let openOrders = _.filter(this.limitSellOrders, {status: 'open'})
      for (let order of openOrders) {
        this.cancelOrder(order.id)
      }
      let BTCBalance = this.balance['BTC']
      Object.keys(this.balance).forEach(currencyKey => {
        let currencyBalance = this.balance[currencyKey]
        let symbol = `${currencyKey}/BTC`
        if (currencyKey !== 'BTC' && currencyBalance > 0) {
          let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol})
          let currencyPrice = ohlcvMAs.data.slice(-1)[0].close
          BTCBalance += currencyPrice * currencyBalance
        }
      })
      saveJsonToCSV(this.tradingRecord, ['event', 'amount', 'price', 'type', 'time'], `./savedData/klines/simulationTradingRecords.csv`)
      return BTCBalance
    }
    /**
     * 得到新数据，并更新this.limitSellOrders
     */
    this.ohlcvMAsList = this._calcOhlcvMAsList()
    this.limitSellOrders.forEach(order => {
      let pastOhlcvMAs = _.find(this.ohlcvMAsList, {symbol: order.symbol}).data.slice(-2)[0]
      /**
       * 保证过去的这一根k线是在设置order的那根k线之后
       */
      if (order.timestamp > pastOhlcvMAs.timeStamp) {
        /**
         * 如果过去的这根k线的high值大于止盈，则order被filled，更新BTC值
         */
        if (pastOhlcvMAs.high > order.price) {
          order.status = 'closed'
          order.filled = order.amount
          let earnedBTCAmount = order.amount * order.price
          this.balance['BTC'] += earnedBTCAmount

          this.tradingRecord.push({
            event: `Sell ${order.symbol}`,
            amount: order.amount,
            price: order.price,
            type: 'limitOrder',
            time: moment(Number(order.timestamp)).format('MMMM Do YYYY, h:mm:ss a')
          })
        }
      }
    })
  }

  fetchBalance () {
    return {
      free: this.balance
    }
  }

  fetchL2OrderBook (symbol) {
    let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol})
    let price = ohlcvMAs.data.slice(-1)[0].close * (1 + this.tradingFee)
    return {
      asks: [[price, Infinity]],
      bids: [[price, Infinity]]
    }
  }

  createMarketBuyOrder (symbol, amount) {
    let targetCurrency = getTargetCurrencyFromSymbol(symbol)
    let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol})
    let price = ohlcvMAs.data.slice(-1)[0].close
    let timeStamp = this.ohlcvMAsList[0].data.slice(-1)[0].timeStamp

    this.balance[targetCurrency] = this.balance[targetCurrency] === undefined ? amount : this.balance[targetCurrency] + amount
    this.balance['BTC'] = this.balance['BTC'] - amount * price * (1 + this.tradingFee)

    this.tradingRecord.push({
      event: `Buy ${symbol}`,
      amount: amount,
      price: price,
      type: 'marketOrder',
      time: moment(Number(timeStamp)).format('MMMM Do YYYY, h:mm:ss a')
    })

    return {
      id: uuidv4(),
      timestamp: timeStamp,
      datetime: new Date(Number(timeStamp)),
      symbol: symbol,
      type: 'market',
      side: 'buy',
      price: 0,
      amount: amount,
      cost: 0,
      filled: amount,
      remaining: 0,
      status: 'closed',
      fee: undefined
    }
  }

  fetchOrders (symbol) {
    let orders = _.filter(this.limitSellOrders, {symbol})
    return orders
  }

  createMarketSellOrder (symbol, amount) {
    let targetCurrency = getTargetCurrencyFromSymbol(symbol)
    let ohlcvMAs = _.find(this.ohlcvMAsList, {symbol})
    // 以最后一根的open价来卖
    let price = ohlcvMAs.data.slice(-1)[0].open
    let timeStamp = this.ohlcvMAsList[0].data.slice(-1)[0].timeStamp

    this.balance['BTC'] = this.balance['BTC'] + amount * price * (1 - this.tradingFee)
    this.balance[targetCurrency] = this.balance[targetCurrency] - amount

    this.tradingRecord.push({
      event: `Sell ${symbol}`,
      amount,
      price,
      type: 'marketOrder',
      time: moment(Number(timeStamp)).format('MMMM Do YYYY, h:mm:ss a')
    })

    return {
      id: uuidv4(),
      timestamp: timeStamp,
      datetime: new Date(Number(timeStamp)),
      symbol: symbol,
      type: 'market',
      side: 'sell',
      price: 0,
      amount: amount,
      cost: 0,
      filled: amount,
      remaining: 0,
      status: 'closed',
      fee: undefined
    }
  }

  createLimitSellOrder (symbol, amount, price) {
    let id = uuidv4()
    let timeStamp = this.ohlcvMAsList[0].data.slice(-1)[0].timeStamp
    let order = {
      id,
      timestamp: timeStamp,
      datetime: new Date(Number(timeStamp)),
      symbol,
      amount,
      price,
      status: 'open',
      filled: 0
    }

    this.limitSellOrders.push(order)
    let targetCurrency = getTargetCurrencyFromSymbol(symbol)
    this.balance[targetCurrency] = this.balance[targetCurrency] - amount

    return order
  }

  cancelOrder (orderId) {
    let order = _.find(this.limitSellOrders, {id: orderId})
    if (order.status === 'canceled') return

    order.status = 'canceled'
    let targetCurrency = getTargetCurrencyFromSymbol(order.symbol)
    this.balance[targetCurrency] = this.balance[targetCurrency] + (order.amount - order.filled)
  }
}
