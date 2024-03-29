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
let potentialTrades = []

const exchangeBlacklist = ['lakebtc', 'qryptos']
const POTENTIAL_TRADE_FILE = './savedData/temp_tasksSortByProfit.js'
const PRICE_DIFF = 0.01;
const BTC_VOLUME = 0.5
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

let updateTickersBySymbol = (ticker, exchange) => {
  let exchangeTicker = getExchangeTicker(ticker, exchange)
  if (! exchangeTicker) {
    return
  }
  if (tickersBySymbol[ticker.symbol]) {
    tickersBySymbol[ticker.symbol].push(exchangeTicker)
  } else {
    tickersBySymbol[ticker.symbol] = [exchangeTicker]
  }
}

let getExchangeTicker = (ticker, exchange) => {
  if (isNaN(ticker.bid) || isNaN(ticker.ask)) {
    return null
  }
  return {
//    ...ticker
    price: (ticker.bid + ticker.ask) / 2,
    averagePrice: ticker.average,
    timestamp: ticker.timestamp,
    vwap: ticker.vwap,
    exchangeId: exchange.id,
    dayVolInBTC: ticker.quoteVolume,
  }
}

async function fetchTickers (exchange) {
  try {
    console.log(`start initializing exchange ${exchange.id}`)

    await exchange.loadMarkets()

    /** fetch all tickers together */
    console.log(exchange.id, 'exchange.hasFetchTickers', exchange.hasFetchTickers)
    if (exchange.hasFetchTickers) {
      let tickers = await exchange.fetchTickers()
      Object.keys(tickers).forEach(key => {
        let ticker = tickers[key]
        updateTickersBySymbol(ticker, exchange)
      })
    }
    /** fetch ticker one by one if exchange doesn't have fetchTickers method */
    else {
      for (let symbol of exchange.symbols) {
        if ((symbol.indexOf('.d') < 0) && (symbol.endsWith('/BTC') && symbol.startsWith('TRX'))) { // skip darkpool symbols
          await api.sleep(exchange.rateLimit)
          let ticker = await exchange.fetchTicker(symbol)
          console.log('ticker', ticker)
          console.log(`Fetched ${symbol} from ${exchange.id} with rateLimit: ${exchange.rateLimit}`)

          updateTickersBySymbol(ticker, exchange)
        }
        //      break; // used for dev to avoid being throttled
      }
    }

    // 每完成一个交易所，就update tickersSortedByPrice
    let tickersSortedByPrice = api.sortByPrice(tickersBySymbol)
//    fs.writeFileSync('./savedData/temp_tickersBySymbol.js', 'module.exports = ' + util.inspect(tickersBySymbol) , 'utf-8')
//    fs.writeFileSync('./savedData/temp_tickersSortedByPrice.js', 'module.exports = ' + util.inspect(tickersSortedByPrice) , 'utf-8')
    potentialTrades = await api.getPotentialTrades(tickersSortedByPrice, PRICE_DIFF, BTC_VOLUME)
    if (potentialTrades.length > 0){
      fs.writeFileSync(POTENTIAL_TRADE_FILE, 'module.exports = ' + util.inspect(potentialTrades), 'utf-8')
    }
  }

  catch (e) {
    api.handleError(e)
  }
}

async function fetchTrades() {

  let exchanges = []
  const enableRateLimit = true
  const ids = ccxt.exchanges.filter (id => id in credentials)

  /** instantiate all exchanges */
//  await Promise.all(ccxt.exchanges.map(async id => {
  await Promise.all(ids.map(async id => {
//    let exchange = new (ccxt)[id]()
    let exchange = new ccxt[id] (ccxt.extend ({ enableRateLimit }, credentials[id]))

    if (_.includes(exchangeBlacklist, id)) {
      return
    }

    exchanges.push(exchange)
    await fetchTickers(exchange)
  }))

  //  await api.makeTrade(trade)
  //  let succeeded = exchanges.filter (exchange => exchange.markets ? true : false).length.toString ().bright.green
  //  let failed = exchanges.filter (exchange => exchange.markets ? false : true).length
  //  let total = ccxt.exchanges.length.toString ().bright.white
  //  console.log (succeeded, 'of', total, 'exchanges loaded', ('(' + failed + ' errors)').red)
}

(async () => {
  while (true) {
    try{
      await fetchTrades()
    }
    catch (e){
      api.handleError(e)
    }
  }
})()
