'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
const utils = require('./utils')
require('ansicolor').nice;

let {
  interval,
  intervalInMillesec,
  recordNb,
  numberOfFetch,
  windows,
  lineLength,
  ohlcvIndex,
  volumeIndex,
  timeIndex,
  KLINE_FILE,
  PICKED_TRADE,
  blackList,
  whiteList,
} = require('./config')

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
  if (process.env.PRODUCTION) {
    log('--------- Fetching Data For Production -------'.blue)

    log(`---       interval ${interval}`)
    log(`---       intervalInMillesec ${intervalInMillesec}`)
    log(`---       recordNb ${recordNb}`)
    log(`---       numberOfFetch ${numberOfFetch}`)

    if (numberOfFetch > 1){
      log('---       numberOfFetch should usually be 1 in production'.red)
    }

    log(`---       windows ${windows}`)
    log(`---       lineLength ${lineLength}`)
  }

  while (true) { // keep fetching
//    await api.sleep(intervalInMillesec * 0.6)
    try {
      let exchange = new ccxt.binance()
      await exchange.loadMarkets()

      let extractedInfoList = []
      for (let symbol of exchange.symbols) {
//        await api.sleep (exchange.rateLimit)
        let klines = {}
        let volumeLine = []
        let closeLine = []
        let openLine = []
        let highLine = []
        let lowLine = []
        let timeLine = []
        let symbolInvalid = false

        if ((symbol.indexOf('.d') < 0) && symbol.endsWith('BTC')) { // skip darkpool symbols
          log(`processing ${symbol}`.green)

          if (blackList && blackList.length > 0 && blackList.includes(symbol)) {
            log(`${symbol} is in blacklist, skipping it`.yellow)
            continue
          }

          if (whiteList && whiteList.length > 0 && !whiteList.includes(symbol)) {
            log(`${symbol} is not in whiteList, skipping it`.yellow)
            continue
          }

          let ohlcv = await exchange.fetchOHLCV(symbol, interval, undefined, recordNb)

          if (ohlcv.length < recordNb){
            log(`symbol ${symbol} doesn't have that much history data, skipping it`.yellow)
            continue
          }

//         if numberOfFetch > 0 , 获取更多历史数据
          for (let i=0; i<numberOfFetch - 1; i++){
            let timeStamp = ohlcv[0][0]
            let newSince = timeStamp - 500 * intervalInMillesec
            let newOhlcv = await exchange.fetchOHLCV(symbol, interval, newSince, recordNb)
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
          openLine = ohlcv.slice(-totalKlinelength).map(x => x[1])
          highLine = ohlcv.slice(-totalKlinelength).map(x => x[2])
          lowLine = ohlcv.slice(-totalKlinelength).map(x => x[3])
          closeLine = ohlcv.slice(-totalKlinelength).map(x => x[4])

          /** get timeLine */
          timeLine = ohlcv.slice(-totalKlinelength).map(x => x[timeIndex])

          extractedInfoList.push({
            symbol,
            klines,
            volumeLine,
            closeLine,
            openLine,
            highLine,
            lowLine,
            timeLine,
          })
        }
      }

      log(`klineDataLength ${extractedInfoList[0].klines[windows[0]].length}`)
      fs.writeFileSync(KLINE_FILE, 'module.exports = ' + JSON.stringify(extractedInfoList), 'utf-8')

    } catch (e) {
      console.error(e)
    }

    if (!process.env.PRODUCTION) {
      break
    } else {
      utils.resetConsole()
    }
  }
  process.exit()
})()
