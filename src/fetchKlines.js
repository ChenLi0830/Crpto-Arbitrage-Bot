'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
require('ansicolor').nice;

const interval = '15m'
const intervalInMillesec = 15 * 60 * 1000
const numberOfFetch = 1 // min = 1, 获取多少次500个点，数字越大，获得的历史数据越多
const windows = [8, 32, 128] // 必须从小到大，maximum = 500 - lineLength
const lineLength = 50
const ohlcvIndex = 4 // [ timestamp, open, high, low, close, volume ]
const volumeIndex = 5
const timeIndex = 0
const KLINE_FILE = './savedData/klines/klines.js'
const PICKED_TRADE = './savedData/pickedTrade.js'
//-----------------------------------------------------------------------------

function getAverage(ohlcv, window, ohlcvIndex){
  let endIdx = ohlcv.length - 1
  let startIdx = ohlcv.length - window
  let result = []

  for (let shift=0; shift<ohlcv.length - Math.max(...windows); shift++) {
    let value = 0
    for (let i=startIdx-shift; i<=endIdx-shift; i++) {
      value += (ohlcv[i][ohlcvIndex] / window)
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

      let extractedInfoList = []
      for (let symbol of exchange.symbols) {
        let klines = {}
        let volumeLine = []
        let priceLine = []
        let timeLine = []
        let symbolInvalid = false

        if ((symbol.indexOf('.d') < 0) && symbol.endsWith('BTC')) { // skip darkpool symbols
          log(`processing ${symbol}`.green)

          let ohlcv = await exchange.fetchOHLCV(symbol, interval)

//         if numberOfFetch > 0 , 获取更多历史数据
          for (let i=0; i<numberOfFetch - 1; i++){
            let timeStamp = ohlcv[0][0]
            let newSince = timeStamp - 500 * intervalInMillesec
            let newOhlcv = await exchange.fetchOHLCV(symbol, interval, newSince)
            if (newOhlcv[0][0] === ohlcv[0][0]) {
              symbolInvalid = true
              log(`symbol ${symbol} doesn't have that much history data, ignoring it`.yellow)
              break
            }
            console.log('newOhlcv.slice(-1)[0][0]', newOhlcv.slice(-1)[0][0], 'ohlcv[0][0]', ohlcv[0][0])
            ohlcv = [...newOhlcv, ...ohlcv]
          }

          if (symbolInvalid) { // do not save invalid symbol data
            continue
          }

//          const lineData = ohlcv.slice(-lineLength).map(x => x[ohlcvIndex]) // closing price
////          console.log('lineData', lineData)
////          printLine(lineData)

          /** get klines */
          for (let window of windows) {
            klines[window] = getAverage(ohlcv, window, ohlcvIndex)
          }

          let totalKlinelength = klines[windows[0]].length
          /** get volumeLine */
          volumeLine = ohlcv.slice(-totalKlinelength).map(x => x[volumeIndex])
          /** get priceLine */
          priceLine = ohlcv.slice(-totalKlinelength).map(x => x[ohlcvIndex])
          /** get timeLine */
          timeLine = ohlcv.slice(-totalKlinelength).map(x => x[timeIndex])

          extractedInfoList.push({
            symbol,
            klines,
            volumeLine,
            priceLine,
            timeLine,
          })
        }
      }

      log(`klineDataLength ${extractedInfoList[0].klines[windows[0]].length}`)
      fs.writeFileSync(KLINE_FILE, 'module.exports = ' + JSON.stringify(extractedInfoList), 'utf-8')

    } catch (e) {
      console.error(e)
    }

    break // Todo remove in production
  }
  process.exit()
})()

module.exports = {
  interval,
  intervalInMillesec,
  windows,
  lineLength,
  ohlcvIndex,
  volumeIndex,
}
