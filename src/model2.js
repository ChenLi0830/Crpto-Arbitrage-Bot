'use strict'

const ccxt = require('ccxt')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const fs = require('fs')
const util = require('util')
const api = require('./api')
const _ = require('lodash')
const credentials = require('../credentials1_2.js')

require('ansicolor').nice

let tickersBySymbol = []

const PRICE_DIFF = 0.001
//-----------------------------------------------------------------------------

process.on('uncaughtException', e => {
  log.bright.red.error(e)
  process.exit(1)
})
process.on('unhandledRejection', e => {
  log.bright.red.error(e)
  process.exit(1)
})

//-----------------------------------------------------------------------------

async function useModal (exchange, symbols) {
  let results = await Promise.all(symbols.map(async symbol => {
    //      if (!exchange.hasFetchOrderBook) {
    //        throw new Error(`exchange ${exchangeId} doesn't have method fetchOrderBook`)
    //        return
    //      }
    let orderBook = await exchange.fetchOrderBook(symbol, {
      'limit_bids': 10, // max = 50
      'limit_asks': 10, // may be 0 in which case the array is empty
      'group': 1 // 1 = orders are grouped by price, 0 = orders are separate
    })
    return {...orderBook, symbol}
  }))

  results.forEach(result => {
    log(`${result.symbol} - bids: ${result.bids[0]} - asks: ${result.asks[0]}`)
  })

  let a = results[0] //钱和玉米 = 获得玉米或钱
  let b = results[1] //钱和种子 = 获得种子或钱
  let c = results[2] //种子和玉米 = 获得种子或玉米

  let sellCBuyBSellA = a.bids[0][0] > (b.asks[0][0] / c.bids[0][0])
  let buyASellBBuyC = a.asks[0][0] < (b.bids[0][0] / c.asks[0][0])

//  let maxProfit = (a.bids[0][0] - (b.asks[0][0] / c.bids[0][0])) /
//    (b.asks[0][0] / c.bids[0][0])
//  log(`opportunity: sellBBuyCSellA, with profit ${maxProfit}`.cyan)

  if (sellCBuyBSellA) {
    let maxProfit = (a.bids[0][0] - (b.asks[0][0] / c.bids[0][0])) /
      (b.asks[0][0] / c.bids[0][0])
    log(`opportunity: sellBBuyCSellA, with profit ${maxProfit}`.cyan)
  }

  if (buyASellBBuyC) {
    let maxProfit = ((b.bids[0][0] / c.asks[0][0]) - a.asks[0][0]) / a.asks[0][0]
    log(`opportunity: buyASellCBuyB, with profit ${maxProfit}`.cyan)
  }

}

/** 三角套利模型 */
async function main () {
  let exchangeId = 'huobipro'
  let symbols = ['LTC/BTC', 'LTC/USDT', 'BTC/USDT']
  const enableRateLimit = true

  let exchange = new ccxt[exchangeId]()
  await exchange.loadMarkets()

  while (true) {
    try {
      await api.sleep(exchange.rateLimit)
      await useModal(exchange, symbols)
    }
    catch (error) {
      api.handleError(error)
    }
  }
}

main()
