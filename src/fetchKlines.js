'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
const utils = require('./utils')
const credentials = require('../credentials')
require('ansicolor').nice;

let {
  interval,
  intervalInMillesec,
  recordNb,
  numberOfFetch,
  windows,
  lineLength,
  ohlcvIndex,
  KLINE_FILE,
  blackList,
  whiteList,
  KLINE_24H_FILE,
} = require('./config')

//-----------------------------------------------------------------------------

let last24HtimeStamp = null
let needUpdate24H = true

function extractOHLCVInfo(ohlcv, symbol) {
  let klines = {}

  /** get klines */
  for (let window of windows) {
    klines[window] = getAverage(ohlcv, window, ohlcvIndex)
  }

  let totalKlinelength = klines[windows[0]].length

  /** get timeLine */
  let timeLine = ohlcv.slice(-totalKlinelength).map(x => x[0])
  /** get priceLine */
  let openLine = ohlcv.slice(-totalKlinelength).map(x => x[1])
  let highLine = ohlcv.slice(-totalKlinelength).map(x => x[2])
  let lowLine = ohlcv.slice(-totalKlinelength).map(x => x[3])
  let closeLine = ohlcv.slice(-totalKlinelength).map(x => x[4])
  /** get volumeLine */
  let volumeLine = ohlcv.slice(-totalKlinelength).map(x => x[5])

  return {
    symbol,
    klines,
    volumeLine,
    closeLine,
    openLine,
    highLine,
    lowLine,
    timeLine,
  }
}

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

async function fetchPromiseBySegment(promises, segNumber) {
  let response = []
  while (promises.length > 0) {
    let promiseSeg = promises.splice(0, segNumber)
    let newRes = await Promise.all(promiseSeg)
    console.log(`fetched ${promiseSeg.length} klines`)
    response = [...response, ...newRes]
  }
  return response
}

(async function main () {
  if (process.env.PRODUCTION) {
    log('--------- Fetching Data For Production -------'.blue)

    log(`---       interval ${interval}`)
    log(`---       intervalInMillesec ${intervalInMillesec}`)
    log(`---       recordNb ${recordNb}`)
    log(`---       numberOfFetch ${numberOfFetch}`)

    if (numberOfFetch > 1){
      log('---       numberOfFetch should can only be 1 in production!'.red)
    }

    log(`---       windows ${windows}`)
    log(`---       lineLength ${lineLength}`)
    log(`---       KLINE_FILE ${KLINE_FILE}`)

  }

  let exchangeId = 'binance'
  let exchange = new ccxt[exchangeId](ccxt.extend(credentials[exchangeId]))

  while (true) { // keep fetching
//    await api.sleep(intervalInMillesec * 0.6)
    try {
      await exchange.loadMarkets()
      let extractedInfoList = []
      let extractedInfo24HList = []
      let lastFetch24HTimeStamp = null

      if (process.env.PRODUCTION) {
        if (!last24HtimeStamp || (new Date().getTime() - last24HtimeStamp > 30 * 60 * 1000)) {
          last24HtimeStamp = new Date().getTime()
          needUpdate24H = true
        }
        await api.sleep(10000)

        let promises = []
        let validSymbols = []
        let promiseList24H = []
        exchange.symbols.forEach(symbol => {
          if ((symbol.indexOf('.d') < 0) && symbol.endsWith('BTC')) {

            if (blackList && blackList.length > 0 && blackList.includes(symbol)) {
              log(`${symbol} is in blacklist, skipping it`.yellow)
              return
            }

            if (whiteList && whiteList.length > 0 && !whiteList.includes(symbol)) {
              log(`${symbol} is not in whiteList, skipping it`.yellow)
              return
            }

            validSymbols.push(symbol)
            promises.push(exchange.fetchOHLCV(symbol, interval, undefined, recordNb))
            promiseList24H.push(exchange.fetchOHLCV(symbol, '30m', undefined, 48))
          }
        })


        let ohlcvList = await fetchPromiseBySegment(promises, 10)
        let ohlcv24HList = needUpdate24H ? await await fetchPromiseBySegment(promiseList24H, 10) : []
        console.log('ohlcvList.length', ohlcvList.length)
        console.log('ohlcv24HList.length', ohlcv24HList.length)

        for (let i=0; i<ohlcvList.length; i++) {
          let ohlcv = ohlcvList[i]
          let symbol = validSymbols[i]
          let ohlcv24H = needUpdate24H ? ohlcv24HList[i] : null

          if (ohlcv.length < recordNb){
            log(`symbol ${symbol} doesn't have that much history data, skipping it`.green)
            continue
          }

          let extractedInfo = extractOHLCVInfo(ohlcv, symbol)
          let extractedInfo24H = needUpdate24H ? extractOHLCVInfo(ohlcv24H, symbol) : null
          extractedInfoList.push(extractedInfo)
          needUpdate24H && extractedInfo24HList.push(extractedInfo24H)
        }
      }
      else {
        let exchange = new ccxt.binance()
        await exchange.loadMarkets()

        extractedInfoList = []
        for (let symbol of exchange.symbols) {
          //        await api.sleep (exchange.rateLimit)
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

            for (let i=0; i<numberOfFetch - 1; i++) {
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

            let extractedInfo = extractOHLCVInfo(ohlcv, symbol)
            extractedInfoList.push(extractedInfo)
          }
        }
      }

      log(`klineDataLength ${extractedInfoList[0].klines[windows[0]].length}`)
      fs.writeFileSync(KLINE_FILE, 'module.exports = ' + JSON.stringify(extractedInfoList), 'utf-8')
      if (needUpdate24H) {
        console.log('needUpdate24H', needUpdate24H)
        console.log('extractedInfo24HList.length', extractedInfo24HList.length)
        fs.writeFileSync(KLINE_24H_FILE, 'module.exports = ' + JSON.stringify(extractedInfo24HList), 'utf-8')
        needUpdate24H = false
      }
    } catch (e) {
      console.log(new Date())
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
