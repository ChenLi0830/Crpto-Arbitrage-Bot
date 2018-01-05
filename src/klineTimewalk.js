'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
const {saveJsonToCSV} = require('./utils')
require('ansicolor').nice;
const moment = require('moment')


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
const PLOT_CSV_FILE = './savedData/klines/plotCsv.csv'

//-----------------------------------------------------------------------------
function checkValueCriteria(klines, index, closeLine) {
  let isFastKlineLarger = (klines[windows[0]][index] > klines[windows[1]][index]) && (klines[windows[0]][index] > klines[windows[2]][index])
  let isMiddleKlineLarger = klines[windows[1]][index] > klines[windows[2]][index]
  let priceGreaterThanFastKline = closeLine[index] > klines[windows[0]][index]

  return isFastKlineLarger && isMiddleKlineLarger && priceGreaterThanFastKline
}

function checkVolCriteria(volumeLine){
  let isVolumeIncreaseFast = (volumeLine[lineLength-1] / volumeLine[lineLength-2]) > 1
  let volumeAvg = _.mean(volumeLine.slice(-20))
  let isVolumeHigherThanAvg = volumeLine[lineLength - 1] > volumeAvg
  return isVolumeIncreaseFast && isVolumeHigherThanAvg
}

function checkBuyingCriteria(klines, volumeLine, closeLine, openLine) {
  let matchVolCriteria = checkVolCriteria(volumeLine)
  let isPricesHigherThanPrevPoint = (closeLine[lineLength - 1] > closeLine[lineLength - 2]) && (openLine[lineLength - 1] > openLine[lineLength - 2])
//  let isFastKlineIncreaseFast = (klines[windows[0]][lineLength-1] / klines[windows[0]][lineLength-2]) > 1.1

  let currentPoint = lineLength-1
  let prevPoint = lineLength-2

  let nowValueMatchCriteria = checkValueCriteria(klines, currentPoint, closeLine)
//  let prevValueMatchCriteria = checkValueCriteria(klines, prevPoint)

  //  log(`nowMatchCriteria`, nowMatchCriteria)
  //  log(`prevMatchCriteria`, prevMatchCriteria)

  return nowValueMatchCriteria && matchVolCriteria && isPricesHigherThanPrevPoint/*&& !prevValueMatchCriteria*/  //&& isFastKlineIncreaseFast
}

function rateCurrency(klines, volumeLine) {
  let fastKline = klines[windows[0]]
  let deriveK = (fastKline[lineLength - 1] / fastKline[lineLength - 2])
  let deriveVolume = (volumeLine[lineLength - 1] / volumeLine[lineLength - 2])

  let volInBTC = klines[windows[0]][lineLength - 1] * volumeLine[lineLength - 1]

//  let rate = Math.min(deriveK * deriveK * deriveK, 20) * Math.min(deriveVolume, 3) * volInBTC //* Math.sqrt(volInBTC)
  let rate = deriveK

//  if (volumeLine[lineLength - 2] === 0) { // 之前没有交易的货币不考虑
//    rate = - Infinity
//  }
  return rate
}

function rateAndSort(extractedInfoList) {
  let buyingPool = []

  for (let extractedInfo of extractedInfoList) {
    const {klines, volumeLine, closeLine, openLine} = extractedInfo
    let matchBuyingCriteria = checkBuyingCriteria(klines, volumeLine, closeLine, openLine)

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
//    console.log('sortedPoolsymbol', sortedPool.map(currency => `${currency.symbol}: ${currency.rate}`).join('\n'))
    let pickedTrade
//    if (sortedPool[0].rate > 20){
      pickedTrade  = sortedPool[0]
      //      把pickedTrade写入文件，由购买currency线程读取
      fs.writeFileSync(PICKED_TRADE, 'module.exports = ' + JSON.stringify(pickedTrade), 'utf-8')
//    }
    return pickedTrade
  }
}

function isNewTradeBetter(pickedTrade, lastPickedTrade){
  return !lastPickedTrade || (pickedTrade.rate > lastPickedTrade.rate)
}

function calcProfitPercent(lastPickedTrade, lastTradeCurrentState){
  if (lastPickedTrade) {
    let purchasePrice = lastPickedTrade.closeLine.slice(-1)[0]
    let sellPrice = lastTradeCurrentState.closeLine.slice(-1)[0]
//    if (purchasePrice > sellPrice) {
//      log(`${lastPickedTrade.symbol}: purchase ${purchasePrice} -> sell ${sellPrice}`.yellow)
//    }

    //          lastTradeCurrentState.closeLine.slice(-1)[0]

    let profitPercent = (sellPrice - purchasePrice) / purchasePrice
    return profitPercent
  } else {
    return 0
  }
}

function useKlineStrategy(params){
  let {newExtractedInfoList, totalDataLength, lastPickedTrade, money, currentTime} = params
  let pickedTrade = pickTradeUpdateFile(newExtractedInfoList)

  if (pickedTrade) {
    log('pickedTrade'.green, pickedTrade.symbol, pickedTrade.rate)
//    log(currentTime)
//    log(`${(totalDataLength - shift - lineLength) * Math.trunc(intervalInMillesec / (60 * 1000)) } mins ago from 10:00am`)
  }

  /** determine if sell */
  let lastTradeCurrentState = lastPickedTrade
    ? _.find(newExtractedInfoList, {symbol: lastPickedTrade.symbol})
    : null

  /** get conditions */
  let potentialProfit = lastPickedTrade ? calcProfitPercent(lastPickedTrade, lastTradeCurrentState) : 0
//  let lostTooMuch = potentialProfit < -0.03
  let dropThroughKline = lastPickedTrade ? lastTradeCurrentState.closeLine[lineLength-1] < lastTradeCurrentState.klines[windows[0]][lineLength-1] : false
//  let recentPriceDiff = lastPickedTrade ? (lastTradeCurrentState.closeLine[lineLength-1] - lastTradeCurrentState.closeLine[lineLength-2])/lastTradeCurrentState.closeLine[lineLength-1] : 0
//  let bigChangeInPrice = recentPriceDiff < -0.03
  let earnedEnough = potentialProfit >= 0.50
//  let noLongerGoodTrade = lastPickedTrade
//    ? !checkValueCriteria(lastTradeCurrentState.klines, lineLength -1, lastTradeCurrentState.closeLine )
//    : false

//  /** determine if change */
//  let newTradeIsBetter = pickedTrade
//    ? isNewTradeBetter(pickedTrade, lastPickedTrade)
//    : false

  let newPlotDot = null

  /** make changes */
  if ((!lastPickedTrade && pickedTrade) || earnedEnough || dropThroughKline /*lostTooMuch || bigChangeInPrice || noLongerGoodTrade*/ ) {
    newPlotDot = {
      time: currentTime,
      profit: lastPickedTrade ? potentialProfit : 'n/a',
      rate: lastPickedTrade ? lastPickedTrade.rate : 'n/a',
      BTCvolume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] * lastPickedTrade.closeLine[lineLength-1] : 'n/a',
      volume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] : 'n/a',
      price: lastPickedTrade ? lastPickedTrade.closeLine[lineLength-1] : 'n/a',
      volDerive: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] / lastPickedTrade.volumeLine[lineLength-2] : 'n/a',
      klineDerive: lastPickedTrade ? lastPickedTrade.klines[windows[0]][lineLength-1] / lastPickedTrade.klines[windows[0]][lineLength-2] : 'n/a',
    }

    log(`earnedEnough ${earnedEnough} dropThroughKline ${dropThroughKline}`.yellow)
    potentialProfit !== 0 && log(`money ${money} -> ${money * (1 + potentialProfit)}`.yellow)

    money = money * (1 + potentialProfit)
    newPlotDot.value = money

//    // buy in this symbol
//    if (newTradeIsBetter) {
//      lastPickedTrade = pickedTrade
//      log(`Buy in ${lastPickedTrade.symbol}`.blue)
//      newPlotDot.event = `Buy in ${pickedTrade.symbol}`
//    } else {
//      newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
//      lastPickedTrade = null
//    }
    // buy in this symbol
    if (earnedEnough || dropThroughKline) {
      newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
      newPlotDot.sellPrice = lastTradeCurrentState.closeLine[lineLength-1],
      lastPickedTrade = null
    } else {
      lastPickedTrade = pickedTrade
      log(`Buy in ${lastPickedTrade.symbol}}`.blue)
      newPlotDot.event = `Buy in ${pickedTrade.symbol}`
    }
  }

  return {lastPickedTrade, money, newPlotDot}
}

function useVolumeStrategy(params) {
  let {newExtractedInfoList, totalDataLength, lastPickedTradeList, money, currentTime} = params
  let sortedByVol = _.sortBy(newExtractedInfoList, o => - (o.volumeLine[lineLength-1] * o.closeLine[lineLength-1]))
//  console.log('sortedByVol', sortedByVol.map(info => info.volumeLine[lineLength-1] * info.closeLine[lineLength-1]).join(' '))

  let firstFive = sortedByVol.slice(0, 5)
  log('firstFive.length', firstFive.length, firstFive.map(info => info.symbol).join(' '))

  let overallProfit = 0
  if (lastPickedTradeList.length === 5) {
    for (let lastPickedTrade of lastPickedTradeList) {
      let lastTradeCurrentState = _.find(newExtractedInfoList, {symbol: lastPickedTrade.symbol})
      let profit = calcProfitPercent(lastPickedTrade, lastTradeCurrentState)
      overallProfit += ( profit/5 )
    }
  }

  lastPickedTradeList = firstFive
  money = money * ( 1 + overallProfit )
  log(`overallProfit ${overallProfit}, money ${money}`.green)
  log(currentTime)

  let newPlotDot = {
    time: currentTime,
    profit: overallProfit,
    value: money,
  }

  return {lastPickedTradeList, money, newPlotDot}
}

function timeWalk(extractedInfoList){
  let shift = 0
  let money = 100
  let lastPickedTrade = null // for kline strategy
  let lastPickedTradeList = [] // for volume strategy
  let plot = []//{time, value, event, profit, rate, BTCvolume}
  let totalDataLength = extractedInfoList[0].volumeLine.length

  while (shift + lineLength < extractedInfoList[0].volumeLine.length) {
    let newExtractedInfoList = extractedInfoList.map(extractedInfo => {
      /** newKlines - length==lineLength */
      let newKlines = {}
      Object.keys(extractedInfo.klines).forEach(key => {
        newKlines[key] = extractedInfo.klines[key].slice(shift, shift + lineLength)
      })
      /** newVolumes */
      let newVolumes = extractedInfo.volumeLine.slice(shift, shift + lineLength)
      /** newPrices */
      let newCloseLine = extractedInfo.closeLine.slice(shift, shift + lineLength)
      let newOpenLine = extractedInfo.openLine.slice(shift, shift + lineLength)
      let newHighLine = extractedInfo.highLine.slice(shift, shift + lineLength)
      let newLowLine = extractedInfo.lowLine.slice(shift, shift + lineLength)
      /** newTimes */
      let newTimes = extractedInfo.timeLine.slice(shift, shift + lineLength)

      return {
        ...extractedInfo,
        klines: newKlines,
        volumeLine: newVolumes,
        closeLine: newCloseLine,
        openLine: newOpenLine,
        highLine: newHighLine,
        lowLine: newLowLine,
        timeLine: newTimes,
      }
    })

    fs.writeFileSync(`${KLINE_FILE}-${shift}.js`, 'module.exports = ' + JSON.stringify(newExtractedInfoList), 'utf-8')
    let timeEpoch = newExtractedInfoList[0].timeLine[lineLength-1]
    let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
    log(`${currentTime} ->`.green)

    log(Object.keys(newExtractedInfoList[0]).join(' '))

    /** useKlineStrategy */
    let klineResult = useKlineStrategy({newExtractedInfoList, totalDataLength, lastPickedTrade, money, currentTime})
    lastPickedTrade = klineResult.lastPickedTrade
    money = klineResult.money
    let newPlotDot = klineResult.newPlotDot

//    /** volumeStrategy */
//    let volumeResult = useVolumeStrategy({newExtractedInfoList, totalDataLength, lastPickedTradeList, money, currentTime})
//    lastPickedTradeList = volumeResult.lastPickedTradeList
//    money = volumeResult.money
//    let newPlotDot = volumeResult.newPlotDot

    if (!!newPlotDot) {
      plot.push(newPlotDot)
    }

//    log(`shift ${shift}`)
    shift++
  }
//  profit, rate
  saveJsonToCSV(plot, ['time', 'value', 'event', 'profit', 'rate', 'BTCvolume', 'volDerive', 'klineDerive', 'price', 'sellPrice'], PLOT_CSV_FILE)
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
