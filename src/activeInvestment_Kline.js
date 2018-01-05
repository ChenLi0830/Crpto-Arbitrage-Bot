'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')

require('ansicolor').nice;

//-----------------------------------------------------------------------------

(async function main () {
  let intervals = [7, 25, 99]

  let exchange = new ccxt.binance()

  for (let symbol of exchange.symbols) {
    if ((symbol.indexOf('.d') < 0) && symbol.endsWith('/BTC')) { // skip darkpool symbols
      await api.sleep(exchange.rateLimit)

      fs.writeFileSync(POTENTIAL_TRADE_FILE, 'module.exports = ' + potentialTrades, 'utf-8')
    }
    //      break; // used for dev to avoid being throttled
  }

  const index = 4 // [ timestamp, open, high, low, close, volume ]
  const ohlcv = await new ccxt.binance().fetchOHLCV('ETH/BTC', '15m')
  console.log('ohlcv.length', ohlcv.length)
  const lastPrice = ohlcv[ohlcv.length - 1][index] // closing price
  const series = ohlcv.slice(-80).map(x => x[index]) // closing price
  const bitcoinRate = ('₿ = $' + lastPrice).green
  const chart = asciichart.plot(series, {height: 15})
  log.yellow('\n' + chart, bitcoinRate, '\n')
  process.exit()

})()
