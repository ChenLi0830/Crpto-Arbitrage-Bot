'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
require('ansicolor').nice;

let interval = '15m'
let intervalInMillesec = 15 * 60 * 1000
let windows = [7, 25, 99] // maximum = 500 - lineLength
let lineLength = 100
const ohlcvIndex = 4 // [ timestamp, open, high, low, close, volume ]
const KLINE_FILE = './savedData/klines.js'
//-----------------------------------------------------------------------------

function getAverage(ohlcv, window, lineLength, ohlcvIndex){
  let endIdx = ohlcv.length - 1
  let startIdx = ohlcv.length - window + 1
  let result = []

  for (let shift=0; shift<lineLength; shift++) {

    let value = 0
    for (let i=startIdx-shift; i<=endIdx-shift; i++) {
      value += ohlcv[i][ohlcvIndex] / window
    }

    result.unshift(value)
  }

  return result
}

function printLine(lineData){
  const chart = asciichart.plot(lineData, {height: 15})
  const lastPrice = lineData[lineData.length - 1] // closing price
  const bitcoinRate = ('₿ = $' + lastPrice).green
  log.yellow('\n' + chart, bitcoinRate, '\n')
}

(async function main () {
  while (true) { // keep fetching
//    await api.sleep(intervalInMillesec * 0.6)
    try {
      let exchange = new ccxt.binance()
      await exchange.loadMarkets()

      let saveData = {}
      for (let symbol of exchange.symbols) {
        let klines = {}
        let volumeLine = []

        if ((symbol.indexOf('.d') < 0) && symbol.endsWith('BTC')) { // skip darkpool symbols
          log(`processing ${symbol}`.green)
          const ohlcv = await new ccxt.binance().fetchOHLCV(symbol, interval)

          const lineData = ohlcv.slice(-lineLength).map(x => x[ohlcvIndex]) // closing price
          //        printLine(lineData)
          volumeLine = ohlcv.slice(-lineLength).map(x => x[5])

          for (let window of windows) {
            klines[window] = getAverage(ohlcv, window, lineLength, ohlcvIndex)
            //          printLine(klines[window])
          }

          saveData[symbol] = {
            klines,
            volumeLine
          }
        }
        fs.writeFileSync(KLINE_FILE, 'module.exports = ' + JSON.stringify(saveData), 'utf-8')
      }

    } catch (e) {
      console.error(e)
    }
  }
  process.exit()
})()
