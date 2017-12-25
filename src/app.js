'use strict'

const ccxt = require('ccxt')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const fs = require('fs')
const util = require('util')
const api = require('./api')
const _ = require('lodash')
const credentials = require ('../credentials.js')

require('ansicolor').nice

let tickersBySymbol = []

const PRICE_DIFF = 0.001;
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

let human_value = function (price) {
  return typeof price == 'undefined' ? 'N/A' : price
}


async function fetchTickers (exchange) {
  try {
    console.log(`start initializing exchange ${exchange.id}`)

    await exchange.loadMarkets()

    for (let symbol of exchange.symbols) {
      if ((symbol.indexOf('.d') < 0)) { // skip darkpool symbols
        await api.sleep(exchange.rateLimit)
        let ticker = await exchange.fetchTicker(symbol)
        console.log(`Fetched ${symbol} from ${exchange.id} with rateLimit: ${exchange.rateLimit}`)

        let exchangeTicker = {
//          ...ticker,
          price: (ticker.bid + ticker.ask) / 2,
          timestamp: ticker.timestamp,
          vwap: ticker.vwap,
          exchangeId: exchange.id,
        }

        if (tickersBySymbol[ticker.symbol]) {
          tickersBySymbol[ticker.symbol].push(exchangeTicker)
        } else {
          tickersBySymbol[ticker.symbol] = [exchangeTicker]
        }
      }
//      break; // used for dev to avoid being throttled
    }
  }

  catch (e) {
    api.handleError(e, exchange)
  }
}

//async function getPotentialTrades(tickersSortedByPrice) {
//  let worthTasks = []
//  for (let tickerKey of Object.keys(tickersSortedByPrice)) {
//    let exchangePrices = tickersSortedByPrice[tickerKey]
//    let lowIndex = 0
//    let highIndex = exchangePrices.length - 1
//
//    while (highIndex > lowIndex && api.largePriceDiff(exchangePrices[highIndex], exchangePrices[lowIndex], PRICE_DIFF)) {
//      if (exchangePrices[highIndex] > exchangePrices[lowIndex] * 2) {
//        lowIndex++
//        highIndex--
//        continue
//      } else {
//        worthTasks.push({
//          symbol: tickerKey,
//          buyFrom: exchangePrices[lowIndex].exchangeId,
//          purchasePrice: exchangePrices[lowIndex].price,
//          sellTo: exchangePrices[highIndex].exchangeId,
//          sellPrice: exchangePrices[highIndex].price,
//          profitePercent: (exchangePrices[highIndex].price - exchangePrices[lowIndex].price) / exchangePrices[lowIndex].price
//        })
//        break
//      }
//    }
//
//  }
//  let tasksSortByProfit = _.sortBy(worthTasks, task => -task.profitePercent)
//  fs.writeFileSync('./temp_worthTasks.js', 'module.exports = ' + util.inspect(worthTasks) , 'utf-8')
//  console.log('worthTasks', worthTasks)
//}


async function main () {

  let exchanges = []
  const enableRateLimit = true

  const ids = ccxt.exchanges.filter (id => id in credentials)

  // instantiate all exchanges
//    await Promise.all(ccxt.exchanges.map(async id => {
  await Promise.all(ids.map(async id => {
//    let exchange = new (ccxt)[id]()

    // instantiate the exchange
    let exchange = new ccxt[id] (ccxt.extend ({ enableRateLimit }, credentials[id]))

    exchanges.push(exchange)
    await fetchTickers(exchange)
  }))

  // get Potential Trades
  let tickersSortedByPrice = api.sortByPrice(tickersBySymbol)
  fs.writeFileSync('./temp_tickersBySymbol.js', 'module.exports = ' + util.inspect(tickersBySymbol) , 'utf-8')
  fs.writeFileSync('./temp_tickersSortedByPrice.js', 'module.exports = ' + util.inspect(tickersSortedByPrice) , 'utf-8')
  let potentialTrades = await api.getPotentialTrades(tickersSortedByPrice, PRICE_DIFF)

//  await api.makeTrade(trade)
  //  let succeeded = exchanges.filter (exchange => exchange.markets ? true : false).length.toString ().bright.green
  //  let failed = exchanges.filter (exchange => exchange.markets ? false : true).length
  //  let total = ccxt.exchanges.length.toString ().bright.white
  //  console.log (succeeded, 'of', total, 'exchanges loaded', ('(' + failed + ' errors)').red)
}

main()
