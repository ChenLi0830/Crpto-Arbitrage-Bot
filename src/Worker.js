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

    this.currencyAmount = 0 // 买了多少币
    this.buyPrice = 0 // 购买价格
    this.limitOrders = []
    this.done = false
  }

  async marketBuy (ohlcvMAs, klineIndex) {
    let orderBook = await retryQueryTaskIfAnyError(this.exchange, 'fetchL2OrderBook', [this.symbol])
    let weightedPrices = api.weightedPrice(orderBook.asks, this.BTCAmount)

    let askedPriceHigh = weightedPrices.tradePrice
    let weightedPrice = weightedPrices.avgPrice

    this.buyPrice = weightedPrice

    log(`--- Buy in ${this.symbol} at ${weightedPrice} with BTCAmount ${this.BTCAmount}`.blue)
    log('last 4 close prices', pickedTrade.closeLine.slice(-4).join(', '))
    log('last 4 close timeLine', pickedTrade.timeLine.slice(-4).join(', '))
    log('last 4 close volumeLine', pickedTrade.volumeLine.slice(-4).join(', '))
    log('last 4 close MA4', pickedTrade.klines[windows[0]].slice(-4).join(', '))
    log('last 4 close MA16', pickedTrade.klines[windows[1]].slice(-4).join(', '))
    log('klineIndex', klineIndex)

    player.play('./src/Glass.aiff', (err) => {
      if (err) throw err
    })

    /**
     * 买三次，避免买不到
     * */
    let maxAmount = this.BTCAmount * 0.999 / askedPriceHigh
    let buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7

    let buyResult = await retryMutationTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
    //        let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
    console.log('buyResult', buyResult)
    if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
      throw new Error('Purchase error!')
    }

    let boughtAmount = Number(buyResult.info.executedQty)

    try {
      let BTCAmount = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
      //          let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
      let maxAmount = BTCAmount * 0.999 / askedPriceHigh
      let buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7
      let buyResult = await retryMutationTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
      //          let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
      log(`Second buy result`, buyResult)
      if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
        throw new Error('Second purchase error!')
      }

      boughtAmount += Number(buyResult.info.executedQty)

      BTCAmount = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
      //          let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
      maxAmount = BTCAmount * 0.999 / askedPriceHigh
      buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7
      buyResult = await retryMutationTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
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

    lastPickedTrade = pickedTrade
    lastPickedTrade.boughtAmount = boughtAmount

    let newBTCAmount = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
    let spentBTC = BTCAmount - newBTCAmount
    let buyPrice = (spentBTC / boughtAmount)
    log(`---    spent ${spentBTC} BTC -  ${Math.trunc(100 * spentBTC/BTCAmount)}% in purchase, average purchase price ${buyPrice}`)
    lastPickedTrade.buyPrice = buyPrice

    newPlotDot.event = `Buy in ${pickedTrade.symbol}`
    newPlotDot.price = (spentBTC / boughtAmount)
    newPlotDot.value = BTCAmount
/*orderBook.asks[0][0]*/ 
  }

  marketSell (sellAmount) {
    // 卖完光币后，

    if (sellAmount === this.BTCAmount) {
      this.done = true
      this.onWorkerUpdate(this.id)
    }
  }

  /**
   * 止盈：创建limit orders
   * @param {*} ohlcvMAs
   */
  async createCutProfitOrders (ohlcvMAs) {
    try {
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
      console.log('limitOrders', limitOrders)
      this.limitOrders = limitOrders
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
