'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
require('ansicolor').nice;

const {
  interval,
  intervalInMillesec,
  lineLength,
  ohlcvIndex,
  volumeIndex,
  windows
} = require('./fetchKlines')

const KLINE_FILE = './savedData/klines/klines.js'
const PICKED_TRADE = './savedData/pickedTrade.js'

//-----------------------------------------------------------------------------
function checkValueCriteria(klines, volumeLine, index) {
  let isFastKlineLarger = (klines[windows[0]][index] > klines[windows[1]][index]) && (klines[windows[0]][index] > klines[windows[2]][index])
  let isMiddleKlineLarger = klines[windows[1]][index] > klines[windows[2]][index]

  return isFastKlineLarger
}

function checkBuyingCriteria(klines, volumeLine) {
  let isVolumeIncrease = volumeLine[lineLength-1] > volumeLine[lineLength-2]

  let currentPoint = lineLength-1
  let prevPoint = lineLength-2

  let nowValueMatchCriteria = checkValueCriteria(klines, volumeLine, currentPoint)
  let prevValueMatchCriteria = checkValueCriteria(klines, volumeLine, prevPoint)

  //  log(`nowMatchCriteria`, nowMatchCriteria)
  //  log(`prevMatchCriteria`, prevMatchCriteria)

  return nowValueMatchCriteria && !prevValueMatchCriteria && isVolumeIncrease
}

function rateCurrency(klines, volumeLine) {
  let fastKline = klines[windows[0]]
  let deriveK = (fastKline[lineLength - 1] - fastKline[lineLength - 2]) / fastKline[lineLength - 2]
  let deriveVolume = (volumeLine[lineLength - 1] - volumeLine[lineLength - 2]) / volumeLine[lineLength - 2]
  let rate = deriveK * deriveVolume

  if (rate < 0 || rate > 100000) {
    console.log('fastKline[lineLength - 1]', fastKline[lineLength - 1], 'fastKline[lineLength - 2]', fastKline[lineLength - 2])
    console.log('volumeLine[lineLength - 1]', volumeLine[lineLength - 1], 'volumeLine[lineLength - 2]', volumeLine[lineLength - 2])
    console.log('deriveK',deriveK, 'deriveVolume', deriveVolume)
  }
  if (volumeLine[lineLength - 2] === 0) { // 之前没有交易的货币不考虑
    rate = - Infinity
  }
  return rate
}

function rateAndSort(extractedInfoList) {
  let buyingPool = []

  for (let extractedInfo of extractedInfoList) {
    const {klines, volumeLine} = extractedInfo
    let matchBuyingCriteria = checkBuyingCriteria(klines, volumeLine)

    if (matchBuyingCriteria) {
      let rate = rateCurrency(klines, volumeLine)

      buyingPool.push({...extractedInfo, rate})
    }
  }

  let sortedPool = _.sortBy(buyingPool, item => -item.rate)

  return sortedPool
}

function printLine(lineData){
  const chart = asciichart.plot(lineData, {height: 15})
  log.yellow('\n' + chart, '\n')
}

function pickTradeUpdateFile(newExtractedInfoList){
  let sortedPool = rateAndSort(newExtractedInfoList)
  if (sortedPool.length > 0) {
    console.log('sortedPoolsymbol', sortedPool.map(currency => `${currency.symbol}: ${currency.rate}`).join('\n'))

    let pickedTrade = sortedPool[0]
    //      把pickedTrade写入文件，由购买currency线程读取
    fs.writeFileSync(PICKED_TRADE, 'module.exports = ' + JSON.stringify(pickedTrade), 'utf-8')

    return pickedTrade
  }
}

function timeWalk(extractedInfoList){
  let shift = 0
  let BTC = 1

  while (shift + lineLength < 500) {
    let newExtractedInfoList = extractedInfoList.map(extractedInfo => {
      /** newKlines - length==lineLength */
      let newKlines = {}
      Object.keys(extractedInfo.klines).forEach(key => {
        newKlines[key] = extractedInfo.klines[key].slice(shift, shift + lineLength)
      })

      /** newVolumes */
      let newVolumes = extractedInfo.volumeLine.slice(shift, shift + lineLength)

      return {
        ...extractedInfo,
        klines: newKlines,
        volumeLine: newVolumes,
      }
    })

    //    log('newExtractedInfoList', JSON.stringify(newExtractedInfoList))
    fs.writeFileSync(`${KLINE_FILE}-${shift}.js`, 'module.exports = ' + JSON.stringify(newExtractedInfoList), 'utf-8')

    let pickedTrade = pickTradeUpdateFile(newExtractedInfoList)
    if (pickedTrade) {
      log('pickedTrade'.blue, pickedTrade.symbol, pickedTrade.rate)
      log(`${(500 - shift - lineLength) * 15} mins ago from 10:00am`)
    }

    log(`shift ${shift}`)
    shift ++
  }
}

(async function main () {
  while (true) { // keep fetching
    //    await api.sleep(intervalInMillesec * 0.6)
    try {
            const extractedInfoList = require('../savedData/klines/klines')
      //      let sortedPool = rateAndSort(extractedInfoList)
      //      log(`sortedPool`, sortedPool)
            timeWalk(extractedInfoList)

    } catch (e) {
      console.error(e)
    }

    break // Todo remove in production
  }
  process.exit()
})()
