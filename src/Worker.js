const log = require('ololog').configure({locate: false})
require('ansicolor').nice

const {
  generateCutProfitList,
  retryMutationTaskIfTimeout
} = require('./utils')

const {sleep} = require('./api')

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

  marketBuy () {
    
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
