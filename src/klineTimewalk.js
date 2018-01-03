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
function checkValueCriteria(klines, index) {
  let isFastKlineLarger = (klines[windows[0]][index] > klines[windows[1]][index]) && (klines[windows[0]][index] > klines[windows[2]][index])
  let isMiddleKlineLarger = klines[windows[1]][index] > klines[windows[2]][index]
  return isFastKlineLarger && isMiddleKlineLarger
}

function checkBuyingCriteria(klines, volumeLine) {
  let isVolumeIncreaseFast = (volumeLine[lineLength-1] / volumeLine[lineLength-2]) > 1
//  let isFastKlineIncreaseFast = (klines[windows[0]][lineLength-1] / klines[windows[0]][lineLength-2]) > 1.1

  let currentPoint = lineLength-1
  let prevPoint = lineLength-2

  let nowValueMatchCriteria = checkValueCriteria(klines, currentPoint)
  let prevValueMatchCriteria = checkValueCriteria(klines, prevPoint)

  //  log(`nowMatchCriteria`, nowMatchCriteria)
  //  log(`prevMatchCriteria`, prevMatchCriteria)

  return nowValueMatchCriteria && !prevValueMatchCriteria && isVolumeIncreaseFast //&& isFastKlineIncreaseFast
}

function rateCurrency(klines, volumeLine) {
  let fastKline = klines[windows[0]]
  let deriveK = (fastKline[lineLength - 1] / fastKline[lineLength - 2])
  let deriveVolume = (volumeLine[lineLength - 1] / volumeLine[lineLength - 2])

  let volInBTC = klines[windows[0]][lineLength - 1] * volumeLine[lineLength - 1]

  let rate = Math.min(deriveK * deriveK, 5) * Math.min(deriveVolume, 3) * volInBTC //* Math.sqrt(volInBTC)

//  if (rate < 0 || rate > 100000) {
//    console.log('fastKline[lineLength - 1]', fastKline[lineLength - 1], 'fastKline[lineLength - 2]', fastKline[lineLength - 2])
//    console.log('volumeLine[lineLength - 1]', volumeLine[lineLength - 1], 'volumeLine[lineLength - 2]', volumeLine[lineLength - 2])
//    console.log('deriveK',deriveK, 'deriveVolume', deriveVolume)
//  }
  if (volumeLine[lineLength - 2] === 0) { // 之前没有交易的货币不考虑
    rate = - Infinity
  }
  return rate
}

function rateAndSort(extractedInfoList) {
  let buyingPool = []

  for (let extractedInfo of extractedInfoList) {
    const {klines, volumeLine, priceLine} = extractedInfo
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
//    console.log('sortedPoolsymbol', sortedPool.map(currency => `${currency.symbol}: ${currency.rate}`).join('\n'))
    let pickedTrade = sortedPool[0]
    //      把pickedTrade写入文件，由购买currency线程读取
    fs.writeFileSync(PICKED_TRADE, 'module.exports = ' + JSON.stringify(pickedTrade), 'utf-8')

    return pickedTrade
  }
}

function isNewTradeBetter(pickedTrade, lastPickedTrade){
  return !lastPickedTrade || (pickedTrade.rate > lastPickedTrade.rate)
}

function calcProfitPercent(lastPickedTrade, lastTradeCurrentState){
  if (lastPickedTrade) {
    let purchasePrice = lastPickedTrade.priceLine.slice(-1)[0]
    let sellPrice = lastTradeCurrentState.priceLine.slice(-1)[0]
//    if (purchasePrice > sellPrice) {
//      log(`${lastPickedTrade.symbol}: purchase ${purchasePrice} -> sell ${sellPrice}`.yellow)
//    }

    //          lastTradeCurrentState.priceLine.slice(-1)[0]

    let profitPercent = (sellPrice - purchasePrice) / purchasePrice
    return profitPercent
  } else {
    return 0
  }
}

function timeWalk(extractedInfoList){
  let shift = 0
  let money = 100
  let lastPickedTrade = null
  let plot = []//{time, value, event, profit, rate, BTCvolume}

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
      let newPrices = extractedInfo.priceLine.slice(shift, shift + lineLength)

      return {
        ...extractedInfo,
        klines: newKlines,
        volumeLine: newVolumes,
        priceLine: newPrices,
      }
    })

    //    log('newExtractedInfoList', JSON.stringify(newExtractedInfoList))
    fs.writeFileSync(`${KLINE_FILE}-${shift}.js`, 'module.exports = ' + JSON.stringify(newExtractedInfoList), 'utf-8')

    let pickedTrade = pickTradeUpdateFile(newExtractedInfoList)

    if (pickedTrade) {
      log('pickedTrade'.green, pickedTrade.symbol, pickedTrade.rate)
      log(`${(extractedInfoList[0].volumeLine.length - shift - lineLength) * Math.trunc(intervalInMillesec / (60 * 1000)) } mins ago from 10:00am`)
    }
      /** determine if sell */
    let lastTradeCurrentState = lastPickedTrade
      ? _.find(newExtractedInfoList, {symbol: lastPickedTrade.symbol})
      : null

    /** get conditions */
    let potentialProfit = lastPickedTrade ? calcProfitPercent(lastPickedTrade, lastTradeCurrentState) : 0
    let lostTooMuch = potentialProfit < -0.03
    let recentPriceDiff = lastPickedTrade ? (lastTradeCurrentState.priceLine[lineLength-1] - lastTradeCurrentState.priceLine[lineLength-2])/lastTradeCurrentState.priceLine[lineLength-1] : 0
    let bigChangeInPrice = recentPriceDiff < -0.03
    let earnedEnough = potentialProfit > 0.10
    let noLongerGoodTrade = lastPickedTrade
      ? !checkValueCriteria(lastTradeCurrentState.klines, lineLength -1 )
      : false

    /** determine if change */
    let newTradeIsBetter = pickedTrade
      ? isNewTradeBetter(pickedTrade, lastPickedTrade)
      : false

    /** make changes */
    if (lostTooMuch || earnedEnough || bigChangeInPrice || noLongerGoodTrade || newTradeIsBetter) {
      let newPlotDot = {
        time: shift,
        profit: lastPickedTrade ? potentialProfit : 'n/a',
        rate: lastPickedTrade ? lastPickedTrade.rate : 'n/a',
        BTCvolume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] * lastPickedTrade.priceLine[lineLength-1] : 'n/a',
        volume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] : 'n/a',
        price: lastPickedTrade ? lastPickedTrade.priceLine[lineLength-1] : 'n/a',
        volDerive: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] / lastPickedTrade.volumeLine[lineLength-2] : 'n/a',
        klineDerive: lastPickedTrade ? lastPickedTrade.klines[windows[0]][lineLength-1] / lastPickedTrade.klines[windows[0]][lineLength-2] : 'n/a',
      }

      log(`earnedEnough ${earnedEnough} bigChangeInPrice ${bigChangeInPrice } lostTooMuch ${lostTooMuch} noLongerGoodTrade ${noLongerGoodTrade} || newTradeIsBetter ${newTradeIsBetter}`.yellow)
      potentialProfit !== 0 && log(`money ${money} -> ${money * (1 + potentialProfit)}`.yellow)

      money = money * (1 + potentialProfit)
      newPlotDot.value = money

      // buy in this symbol
      if (newTradeIsBetter) {
        lastPickedTrade = pickedTrade
        log(`Buy in ${lastPickedTrade.symbol}`.blue)
        newPlotDot.event = `Buy in ${pickedTrade.symbol}`
      } else {
        newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
        lastPickedTrade = null
      }

      plot.push(newPlotDot)
    }

    log(`shift ${shift}`)
    shift ++
  }
//  profit, rate
  saveJsonToCSV(plot, ['time', 'value', 'event', 'profit', 'rate', 'BTCvolume', 'volDerive', 'klineDerive'], PLOT_CSV_FILE)
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
