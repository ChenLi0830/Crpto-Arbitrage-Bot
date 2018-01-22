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
const credentials = require('../credentials')
const {MinorError, MajorError} = require('./utils/errors')
const utils = require('./utils')

let {
  lineLength,
  windows,
  KLINE_FILE,
  PLOT_CSV_FILE,
} = require('./config')

lineLength = 50

let vibrateWhiteList = []
let volumeWhiteList = []
let topVibratedNo = 10
let topVolumeNo = 10
let topWeightNo = 50
let observeWindow = 300

let whiteList = []

/**
 * 高持续度增长
 * 有阶跃
 * */
//let whiteList = [
//  'NEO/BTC', // 1 1
//  'FUN/BTC', // 1 1
//  'ZRX/BTC', // 1 1
//  'LRC/BTC', // 1 1
//  'ELF/BTC', // 1 1
//]//['WABI/BTC', 'WINGS/BTC', 'TNB/BTC'] // hand picked
//-----------------------------------------------------------------------------

/**
 * 从ExtractedInfoList里截取出对应长度的
 * */
function cutExtractedInfoList (ohlcvMAList, start, lineLength) {
  let newExtractedInfoList = ohlcvMAList.map(ohlcvMA => {
    /** newKlines - length==lineLength */
    let newKlines = {}
    Object.keys(ohlcvMA.klines).forEach(key => {
      newKlines[key] = ohlcvMA.klines[key].slice(start, start + lineLength)
    })
    /** newVolumes */
    let newVolumes = ohlcvMA.volumeLine.slice(start, start + lineLength)
    /** newPrices */
    let newCloseLine = ohlcvMA.closeLine.slice(start, start + lineLength)
    let newOpenLine = ohlcvMA.openLine.slice(start, start + lineLength)
    let newHighLine = ohlcvMA.highLine.slice(start, start + lineLength)
    let newLowLine = ohlcvMA.lowLine.slice(start, start + lineLength)
    /** newTimes */
    let newTimes = ohlcvMA.timeLine.slice(start, start + lineLength)

    return {
      ...ohlcvMA,
      klines: newKlines,
      volumeLine: newVolumes,
      closeLine: newCloseLine,
      openLine: newOpenLine,
      highLine: newHighLine,
      lowLine: newLowLine,
      timeLine: newTimes,
    }
  })
  return newExtractedInfoList
}

function checkValueCriteria(klines, index, closeLine) {
  let isFastKlineLarger = (klines[windows[0]][index] > klines[windows[1]][index]) && (klines[windows[0]][index] > klines[windows[2]][index])
  let isMiddleKlineLarger = klines[windows[1]][index] > klines[windows[2]][index]
  let priceGreaterThanFastKline = closeLine[index] > klines[windows[0]][index]
  return isFastKlineLarger && isMiddleKlineLarger && priceGreaterThanFastKline /*&& previousIncreaseNotTooBig*/
}

function checkVolCriteria(volumeLine){
  let isVolumeIncreaseFast = (volumeLine[lineLength-1] / volumeLine[lineLength-2]) > 1
  let volumeAvg = _.mean(volumeLine.slice(-20))
  let isVolumeHigherThanAvg = volumeLine[lineLength - 1] > volumeAvg
  return isVolumeIncreaseFast && isVolumeHigherThanAvg
}

function checkBuyingCriteria(ohlcvMA) {
  const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = ohlcvMA
  let matchVolCriteria = checkVolCriteria(volumeLine)
  let isPricesHigherThanPrevPoint = (closeLine[lineLength - 1] > closeLine[lineLength - 2]) && (openLine[lineLength - 1] > openLine[lineLength - 2])
  let isVibrateEnough = ohlcvMA.vibrateValue > 50

  let currentPoint = lineLength-1
  let prevPoint = lineLength-2

  let nowValueMatchCriteria = checkValueCriteria(klines, currentPoint, closeLine)

  return nowValueMatchCriteria && matchVolCriteria && isPricesHigherThanPrevPoint /*&& isVibrateEnough*/ /*&& !prevValueMatchCriteria*/  //&& isFastKlineIncreaseFast
}

function rateCurrency(klines, volumeLine) {
  let fastKline = klines[windows[0]]
  let deriveK = (fastKline[lineLength - 1] / fastKline[lineLength - 2])
  let deriveVolume = (volumeLine[lineLength - 1] / volumeLine[lineLength - 2])

  let volInBTC = klines[windows[0]][lineLength - 1] * volumeLine[lineLength - 1]

  let rate = deriveK
  return rate
}

function rateAndSort(ohlcvMAList, whiteList) {
  let buyingPool = []

  for (let ohlcvMA of ohlcvMAList) {
    /**
     * 白名单过滤
     * */
    if (whiteList && whiteList.length > 0) {
      if (!whiteList.includes(ohlcvMA.symbol)) {
        continue
      }
    }
    /**
     * 若无白名单，则选择振动最强的
     * */
    else if (vibrateWhiteList && vibrateWhiteList.length > 0 && !vibrateWhiteList.includes(ohlcvMA.symbol)) {
      continue
    }

    const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = ohlcvMA
    let matchBuyingCriteria = checkBuyingCriteria(ohlcvMA)

    if (matchBuyingCriteria) {
      let rate = rateCurrency(klines, volumeLine)

      buyingPool.push({...ohlcvMA, rate})
    }
  }

  let sortedPool = _.sortBy(buyingPool, item => -item.rate)
  return sortedPool
}

function pickTradeFromList(newExtractedInfoList, whiteList){
  let sortedPool = rateAndSort(newExtractedInfoList, whiteList)
  if (sortedPool.length > 0) {
    //    console.log('sortedPoolsymbol', sortedPool.map(currency => `${currency.symbol}: ${currency.rate}`).join('\n'))
    log('Picking from list: '.green, sortedPool.map(o => o.symbol).join(' '))
    let pickedTrade
    //    if (sortedPool[0].rate > 20){
    pickedTrade  = sortedPool[0]
    return pickedTrade
  }
}

function noCurrentTradeOrNewTradeBetter(pickedTrade, lastPickedTrade){
  return !lastPickedTrade || (pickedTrade.rate > lastPickedTrade.rate)
}

function calcProfitPercent(lastPickedTrade, lastTradeCurrentState){
  if (lastPickedTrade) {
    let purchasePrice = lastPickedTrade.closeLine.slice(-1)[0]
    let sellPrice = lastTradeCurrentState.closeLine.slice(-1)[0]

    let profitPercent = (sellPrice - purchasePrice) / purchasePrice
    return profitPercent
  } else {
    return 0
  }
}

function useKlineStrategy(params){
  let {newExtractedInfoList, lastPickedTrade, money, currentTime, PRODUCTION, exchange, whiteList=[]} = params
  let pickedTrade = pickTradeFromList(newExtractedInfoList, whiteList)

  if (pickedTrade) {
    log('pickedTrade'.green, pickedTrade.symbol, pickedTrade.rate)
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
  //  let earnedEnough = potentialProfit >= 0.50
  let targetValue = lastPickedTrade ? Math.sqrt(lastTradeCurrentState.meanSquareError) : 0
  let earnedEnough = false//lastPickedTrade ? (potentialProfit >= targetValue) : false
  //  let earnedEnough = lastPickedTrade ? true : false

  if (lastPickedTrade) {
    log(`targetValue ${targetValue}`.blue)
  }
  //  let noLongerGoodTrade = lastPickedTrade
  //    ? !checkValueCriteria(lastTradeCurrentState.klines, lineLength -1, lastTradeCurrentState.closeLine )
  //    : false

  ////  /** determine if change */
  //  let newTradeIsBetter = pickedTrade
  //    ? noCurrentTradeOrNewTradeBetter(pickedTrade, lastPickedTrade)
  //    : false

  let newPlotDot = null

  /** make changes */
  if ((!lastPickedTrade && pickedTrade) || earnedEnough || dropThroughKline /*lostTooMuch || bigChangeInPrice || noLongerGoodTrade*/ ) {
    log(`--- earnedEnough ${earnedEnough} dropThroughKline ${dropThroughKline}`.yellow)

    /*
    * Time Walk Simulation
    * */
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

    potentialProfit !== 0 && log(`money ${money} -> ${money * (1 + potentialProfit)}`.yellow)

    money = money * (1 + potentialProfit)
    newPlotDot.value = money

    if (earnedEnough || dropThroughKline) {
      log(`Sell ${lastPickedTrade.symbol}`.blue)
      newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
      newPlotDot.sellPrice = lastTradeCurrentState.closeLine[lineLength-1]
      lastPickedTrade = null
    } else {
      lastPickedTrade = pickedTrade
      log(`Buy in ${lastPickedTrade.symbol}`.blue)
      newPlotDot.event = `Buy in ${pickedTrade.symbol}`
    }
  }

  return {lastPickedTrade, money, newPlotDot}
}

function useVolumeStrategy(params) {
  let {newExtractedInfoList, lastPickedTradeList, money, currentTime} = params
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

function timeWalkCalcProfit(ohlcvMAList){
  let shift = 0
  let money = 100
  let lastPickedTrade = null // for kline strategy
  let lastPickedTradeList = [] // for volume strategy
  let plot = []//{time, value, event, profit, rate, BTCvolume}

  while (shift + lineLength < ohlcvMAList[0].volumeLine.length) {
    let newExtractedInfoList = cutExtractedInfoList (ohlcvMAList, shift, lineLength)
    let timeEpoch = newExtractedInfoList[0].timeLine[lineLength-1]
    let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
    log(`${currentTime} ->`.green)

    /** useKlineStrategy */
    let klineResult = useKlineStrategy({newExtractedInfoList, lastPickedTrade, money, currentTime, whiteList})
    lastPickedTrade = klineResult.lastPickedTrade
    money = klineResult.money
    let newPlotDot = klineResult.newPlotDot

    if (!!newPlotDot) {
      plot.push(newPlotDot)
    }
    //    log(`shift ${shift}`)
    shift++
  }
  //  profit, rate
//  saveJsonToCSV(plot, ['time', 'value', 'event', 'profit', 'rate', 'BTCvolume', 'volDerive', 'klineDerive', 'price', 'sellPrice'], PLOT_CSV_FILE)
  let profitLine = plot.map(dot => dot.value)
  return profitLine
}


//(function main () {
//  let PRODUCTION = process.env.PRODUCTION
//  log(`PRODUCTION ${PRODUCTION}`.red)
//  /**
//   * TimeWalk simulation
//   * */
//  const ohlcvMAList = require(`.${KLINE_FILE}`)
//  try {
//    timeWalk(ohlcvMAList)
//  } catch (error) {
//    console.error(error)
//    log(error.message.red)
//  }
//  process.exit()
//})()

module.exports = {timeWalkCalcProfit}
