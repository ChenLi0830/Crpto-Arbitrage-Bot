const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const {
  generateCutProfitList,
  retryMutationTaskIfTimeout,
  retryQueryTaskIfAnyError
} = require('./utils')

const api = require('./api')
const player = require('play-sound')(opts = {})

module.exports = class Worker {
  constructor (id, symbol, exchange, updateWorkerList, dynamicProfitList, BTCAmount, params) {
    this.id = id
    this.symbol = symbol
    this.exchange = exchange
    this.BTCAmount = BTCAmount
    this.onWorkerUpdate = updateWorkerList // 当worker完成大变动时，通知Manager
    this.dynamicProfitList = dynamicProfitList

    this.currencyAmount = undefined // 买了多少币
    this.buyPrice = undefined // 购买价格
    this.limitOrders = []
    this.done = false
  }

  async marketBuy (ohlcvMAs) {
    let orderBook = await retryQueryTaskIfAnyError(this.exchange, 'fetchL2OrderBook', [this.symbol])
    let weightedPrices = api.weightedPrice(orderBook.asks, this.BTCAmount)

    let askedPriceHigh = weightedPrices.tradePrice
    let weightedPrice = weightedPrices.avgPrice

    log(`--- Buy in ${this.symbol} at ${weightedPrice} with BTCAmount ${this.BTCAmount}`.blue)
    log('last 4 close prices', ohlcvMAs.data.slice(-4).join('\n'))

    player.play('./src/Glass.aiff', (err) => {
      if (err) throw err
    })

    /**
     * 买三次，避免买不到
     * */
    let maxAmount = this.BTCAmount * 0.999 / askedPriceHigh
    let buyInAmount = maxAmount * 0.7
    buyInAmount = buyInAmount > 1 ? Math.trunc(buyInAmount) : buyInAmount
    let buyResult = await retryMutationTaskIfTimeout(this.exchange, 'createMarketBuyOrder', [this.symbol, buyInAmount, {'recvWindow': 60 * 10 * 1000}])
    console.log('buyResult', buyResult)
    if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
      throw new Error('Purchase error!')
    }

    let boughtAmount = Number(buyResult.info.executedQty)

    try {
      let buyInAmount = maxAmount * 0.21
      buyInAmount = buyInAmount > 1 ? Math.trunc(buyInAmount) : buyInAmount
      let buyResult = await retryMutationTaskIfTimeout(this.exchange, 'createMarketBuyOrder', [this.symbol, buyInAmount, {'recvWindow': 60*10*1000}])
      //          let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
      log(`Second buy result`, buyResult)
      if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
        throw new Error('Second purchase error!')
      }

      boughtAmount += Number(buyResult.info.executedQty)

      buyInAmount = maxAmount * 0.07
      buyInAmount = buyInAmount > 1 ? Math.trunc(buyInAmount) : buyInAmount
      buyResult = await retryMutationTaskIfTimeout(this.exchange, 'createMarketBuyOrder', [this.symbol, buyInAmount, {'recvWindow': 60*10*1000}])
      //          let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
      log(`Third buy result`, buyResult)
      if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
        throw new Error('Third purchase error!')
      }

      boughtAmount += Number(buyResult.info.executedQty)
    }
    catch (error) {
      log(`Second or third buy error, relatively ok ${error}`.red)
    }

    this.buyPrice = weightedPrice
    this.currencyAmount = boughtAmount
    log(`Worker finish buying ${this.currencyAmount} ${this.symbol} at the price: ${this.buyPrice}; Total BTC of this worker: ${this.BTCAmount}`)
  }

  marketSell (sellAmount) {

    if (sellAmount === this.BTCAmount) {
      this.done = true
      this.onWorkerUpdate(this.id)
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

      let createLimitOrderPromises = cutProfitList.map(cutProfit => {
        let cutAmount = this.currencyAmount * cutProfit.percent / 100
        return retryMutationTaskIfTimeout(this.exchange, 'createLimitSellOrder', [this.symbol, cutAmount, this.buyPrice * (100 + cutProfit.value) / 100, {'recvWindow': 60 * 10 * 1000}])
      })

      let limitOrders = []
      await Promise.all(createLimitOrderPromises.map(async (createOrderPromise, i) => {
        try {
          let limitOrderResult = await createOrderPromise
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

      log(`Worker finished creating limit orders ${JSON.stringify(limitOrders)}`)
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * 取消止盈单
   */
  cancelCutProfitOrders () {

  }
}
