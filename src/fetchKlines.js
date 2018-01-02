'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
require('ansicolor').nice;

let interval = '15m'
let intervalInMillesec = 15 * 60 * 1000
let windows = [7, 25, 99] // 必须从小到大，maximum = 500 - lineLength
let lineLength = 50
const ohlcvIndex = 4 // [ timestamp, open, high, low, close, volume ]
const KLINE_FILE = './savedData/klines.js'

//-----------------------------------------------------------------------------

function getAverage(ohlcv, window, lineLength, ohlcvIndex){
  let endIdx = ohlcv.length - 1
  let startIdx = ohlcv.length - window
  let result = []

  for (let shift=0; shift<lineLength; shift++) {
    let value = 0
    for (let i=startIdx-shift; i<=endIdx-shift; i++) {
      value += (ohlcv[i][ohlcvIndex] / window)
    }
    result.unshift(value)
  }

  return result
}

function checkValueCriteria(klines, volumeLine, index) {

  let isVolumeIncrease = volumeLine[index] > volumeLine[index-1]
  let isFastKlineLarger = (klines[windows[0]][index] > klines[windows[1]][index]) && (klines[windows[0]][index] > klines[windows[2]][index])
  let isMiddleKlineLarger = klines[windows[1]][index] > klines[windows[2]][index]

  return isVolumeIncrease && isFastKlineLarger
}

function checkBuyingCriteria(klines, volumeLine) {
  let currentPoint = lineLength-1
  let prevPoint = lineLength-2

  let nowMatchCriteria = checkValueCriteria(klines, volumeLine, currentPoint)
  let prevMatchCriteria = checkValueCriteria(klines, volumeLine, prevPoint)

  log(`nowMatchCriteria`, nowMatchCriteria)
  log(`prevMatchCriteria`, prevMatchCriteria)

  return nowMatchCriteria && !prevMatchCriteria
}

function rateCurrency(klines, volumeLine) {
  let deriveK = (klines[windows[0]][lineLength - 1] - klines[windows[0]][lineLength - 2]) / klines[windows[0]][lineLength - 2]
  let deriveVolume = (volumeLine[lineLength - 1] - volumeLine[lineLength - 2]) / volumeLine[lineLength - 2]
  return deriveK * deriveVolume
}

function rateAndSort(extractedInfoList) {
  let buyingPool = []

  for (let symbol of Object.keys(extractedInfoList)) {
    let extractedInfo = extractedInfoList[symbol]

    if (symbol === 'ETH/BTC') {
      console.log('extractedInfo', extractedInfo)
    }

    const {klines, volumeLine} = extractedInfo
    let matchBuyingCriteria = checkBuyingCriteria(klines, volumeLine)

    if (matchBuyingCriteria) {
      let rate = rateCurrency(klines, volumeLine)

      buyingPool.push({symbol, ...extractedInfo, rate})
    }
  }

  let sortedPool = _.sortBy(buyingPool, item => item.rate)

  return sortedPool
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


      let extractedInfoList = {}
      for (let symbol of exchange.symbols) {
        let klines = {}
        let volumeLine = []

        if ((symbol.indexOf('.d') < 0) && symbol.endsWith('BTC')) { // skip darkpool symbols
          log(`processing ${symbol}`.green)
          const ohlcv = await new ccxt.binance().fetchOHLCV(symbol, interval)

          const lineData = ohlcv.slice(-lineLength).map(x => x[ohlcvIndex]) // closing price
//          console.log('lineData', lineData)
//          printLine(lineData)
          volumeLine = ohlcv.slice(-lineLength).map(x => x[5])

          for (let window of windows) {
            klines[window] = getAverage(ohlcv, window, lineLength, ohlcvIndex)
            //          printLine(klines[window])
          }

          extractedInfoList[symbol] = {
            klines,
            volumeLine
          }

        }
      }

//      const extractedInfoList = require('../savedData/klines')
      let sortedPool = rateAndSort(extractedInfoList)
      console.log('sortedPool', sortedPool)

      fs.writeFileSync(KLINE_FILE, 'module.exports = ' + JSON.stringify(extractedInfoList), 'utf-8')


    } catch (e) {
      console.error(e)
    }
  }
  process.exit()
})()
