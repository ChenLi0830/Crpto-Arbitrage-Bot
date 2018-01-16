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
const player = require('play-sound')(opts = {})
const {
  retryExTaskIfTimeout,
  cutExtractedInfoList,
  getTopVibrated,
  getTopVolume,
  getTopWeighted,
  addVibrateValue,
  addBTCVolValue,
  generateCutProfitList,
} = utils

const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')

let {
  lineLength,
  windows,
  KLINE_FILE,
  PLOT_CSV_FILE,
  intervalInMillesec
} = require('./config')

/**
 * 测试用，lineLength是用来获得24小时vol时用的
 * */
lineLength = 1 * 24 * 60 / 5//
KLINE_FILE = `./savedData/klines/klines-simulate-7-usdt.js`

console.log('KLINE_FILE', KLINE_FILE)
console.log('PLOT_CSV_FILE', PLOT_CSV_FILE)

let vibrateWhiteList = []
let volumeWhiteList4H = []
let volumeWhiteList24H = []
let weightWhiteList = []
let topVibratedNo = 10
let topVolumeNo = 10
let topWeightNo = 10
let observeWindow = 300
let klineIndex = process.env.PRODUCTION ? 0 : lineLength - 1 // 在生产环境中看上一个kline的index

/**
 * 设置白名单
 * */
let whiteList = []
let useVolumeToChooseCurrency = true
//let whiteList = [
//  'DLT/BTC',
//  'FUEL/BTC'
//]

let cutProfitList = []

//-----------------------------------------------------------------------------

function checkValueCriteria(klines, closeLine, openLine) {
  let isFastKlineLarger = (klines[windows[0]][klineIndex] > klines[windows[1]][klineIndex]) && (klines[windows[0]][klineIndex] > klines[windows[2]][klineIndex])
  let isMiddleKlineLarger = klines[windows[1]][klineIndex] > klines[windows[2]][klineIndex]
  let priceGreaterThanFastKline = closeLine[klineIndex] > klines[windows[0]][klineIndex]
  let isFastKlineIncreasing = klines[windows[0]][klineIndex] > klines[windows[0]][klineIndex-1]
  let isMiddleKlineIncreasing = klines[windows[1]][klineIndex] > klines[windows[1]][klineIndex-1]
  let isSlowKlineIncreasing = klines[windows[2]][klineIndex] > klines[windows[2]][klineIndex-1]

  return isFastKlineLarger && isMiddleKlineLarger && priceGreaterThanFastKline && isFastKlineIncreasing && isMiddleKlineIncreasing && isSlowKlineIncreasing
}

function checkVolCriteria(volumeLine){
  let isVolumeIncreaseFast = (volumeLine[klineIndex] / volumeLine[klineIndex-1]) > 1
  let volumeAvg = _.mean(volumeLine.slice(-20))
  let isVolumeHigherThanAvg = volumeLine[klineIndex] > volumeAvg
  return isVolumeIncreaseFast && isVolumeHigherThanAvg
}

function checkBuyingCriteria(extractedInfo) {
  const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = extractedInfo
  let matchVolCriteria = checkVolCriteria(volumeLine)
  let isPricesHigherThanPrevPoint = (closeLine[klineIndex] > closeLine[klineIndex-1]) && (openLine[klineIndex] > openLine[klineIndex-1])
  let nowValueMatchCriteria = checkValueCriteria(klines, closeLine, openLine)
  return nowValueMatchCriteria && matchVolCriteria && isPricesHigherThanPrevPoint
}

function rateCurrency(klines, volumeLine) {
  let fastKline = klines[windows[0]]
  let deriveK = (fastKline[klineIndex] / fastKline[klineIndex-1])
  let deriveVolume = (volumeLine[klineIndex] / volumeLine[klineIndex-1])

  let volInBTC = klines[windows[0]][klineIndex] * volumeLine[klineIndex]

  //  let rate = Math.min(deriveK * deriveK * deriveK, 20) * Math.min(deriveVolume, 3) * volInBTC //* Math.sqrt(volInBTC)
  let rate = deriveK

  //  if (volumeLine[klineIndex-1] === 0) { // 之前没有交易的货币不考虑
  //    rate = - Infinity
  //  }
  return rate
}

function rateAndSort(extractedInfoList, whiteList) {
  let buyingPool = []

  for (let extractedInfo of extractedInfoList) {
    /**
     * 白名单过滤
     * */
    let whiteListSet = new Set([...whiteList, ...volumeWhiteList24H.slice(0, topVolumeNo), ...volumeWhiteList4H.slice(0, 2)])
    whiteList = [...whiteListSet]
//    whiteList = [...whiteListSet].slice(0, topVolumeNo)

    if (whiteList && whiteList.length > 0) {
      if (!whiteList.includes(extractedInfo.symbol)) {
        continue
      }
    }
    /**
     * 若无白名单，则选择振动最强的
     * */
    else if (vibrateWhiteList && vibrateWhiteList.length > 0 && !vibrateWhiteList.includes(extractedInfo.symbol)) {
      continue
    }
    else if (weightWhiteList && weightWhiteList.length > 0 && !weightWhiteList.includes(extractedInfo.symbol)) {
      continue
    }

    const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = extractedInfo
    let matchBuyingCriteria = checkBuyingCriteria(extractedInfo)
    let isNewKline = ((new Date().getTime() - extractedInfo.timeLine.slice(-1)[0]) < 45 * 1000) //todo 改成30
    if (matchBuyingCriteria) {
      let rate = rateCurrency(klines, volumeLine)
      buyingPool.push({...extractedInfo, rate})
    }
    /*
    * 如果是刚刚生成的k线，判断它之前的k线是否满足条件，如果是则买入
    * */
    else if (isNewKline) {
      let prevExtractedInfo = cutExtractedInfoList([extractedInfo], 0, extractedInfo.timeLine.length-1)[0]
      let prevPointMatchBuyingCriteria = checkBuyingCriteria(prevExtractedInfo)

      if (prevPointMatchBuyingCriteria) {
        const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = prevExtractedInfo
        let rate = rateCurrency(klines, volumeLine)
        buyingPool.push({...extractedInfo, rate})
      }
    }
  }

  let sortedPool = _.sortBy(buyingPool, item => -item.rate)
  return sortedPool
}

function printLine(lineData){
  const chart = asciichart.plot(lineData, {height: 15})
  log.yellow('\n' + chart, '\n')
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
    let purchasePrice = lastPickedTrade.closeLine[klineIndex]
    let sellPrice = lastTradeCurrentState.closeLine[klineIndex]

    let purchaseTime = lastPickedTrade.timeLine[klineIndex]
    let purchaseIndex = lastTradeCurrentState.timeLine.indexOf(purchaseTime)

    let soldMoney = 0
    let volPercent = 100
    let cutProfitIndex = 0
    for (let i = purchaseIndex; i <= klineIndex; i++){
      /**
       * 计算止盈点获得的钱soldMoney和剩余的volPercent
       * */
      while (cutProfitIndex < cutProfitList.length && lastTradeCurrentState.highLine[i] > (1 + cutProfitList[cutProfitIndex].value/100) * purchasePrice) {
        soldMoney += ((1 + cutProfitList[cutProfitIndex].value/100) * purchasePrice * cutProfitList[cutProfitIndex].percent)
        volPercent -= cutProfitList[cutProfitIndex].percent
//        log(`lastTradeCurrentState.highLine[i] ${lastTradeCurrentState.highLine[i]}`.yellow)
//        log(`(1 + cutProfitList[cutProfitIndex].value/100) * purchasePrice ${(1 + cutProfitList[cutProfitIndex].value/100) * purchasePrice}`.yellow)
//        log('soldMoney', soldMoney)
        cutProfitIndex++
      }
    }

    soldMoney += (volPercent * sellPrice)
    let avgSellPrice = soldMoney / 100
//    log('avgSellPrice', avgSellPrice)

//    let hitCost = 1.003 // 冲击成本，1为无成本
    let hitCost = 1 // 冲击成本，1为无成本
    let profitPercent = (avgSellPrice - purchasePrice * hitCost) / purchasePrice
    return profitPercent
  } else {
    return 0
  }
}

async function useKlineStrategy(params){
  let {newExtractedInfoList, lastPickedTrade, money, currentTime, PRODUCTION, exchange, whiteList=[]} = params
  let pickedTrade = pickTradeFromList(newExtractedInfoList, whiteList)

  if (pickedTrade) {
    log('pickedTrade'.green, pickedTrade.symbol, pickedTrade.rate)
  }

  /** determine if sell */
  let lastTradeCurrentState = lastPickedTrade
    ? _.find(newExtractedInfoList, {symbol: lastPickedTrade.symbol})
    : null

  if (lastTradeCurrentState) {
    log(`The most recent price of ${lastTradeCurrentState.symbol} is ${lastTradeCurrentState.closeLine.slice(-1)[0]}`.yellow)
  }

  /** get conditions */
  let potentialProfit = lastPickedTrade ? calcProfitPercent(lastPickedTrade, lastTradeCurrentState) : 0
  //  let lostTooMuch = potentialProfit < -0.03

  let dropThroughKline = false
  let fastMADropThroughMiddleMA = false
  /*
  * 如果是在当前kline买入，需要等kline结束才判断是否dropThroughKline
  * */
  if (lastTradeCurrentState && (lastTradeCurrentState.timeLine[klineIndex] > lastPickedTrade.timeLine[klineIndex])) {
    /**
     * 生产环境中，卖出是用前一根kline判断
     * */
    let sellKline = process.env.PRODUCTION ? klineIndex-1 : klineIndex
    dropThroughKline = lastTradeCurrentState.closeLine[sellKline] < lastTradeCurrentState.klines[windows[0]][sellKline]
    fastMADropThroughMiddleMA = lastTradeCurrentState.klines[windows[0]][sellKline] < lastTradeCurrentState.klines[windows[1]][sellKline]
  }

  //  let recentPriceDiff = lastPickedTrade ? (lastTradeCurrentState.closeLine[klineIndex] - lastTradeCurrentState.closeLine[klineIndex-1])/lastTradeCurrentState.closeLine[klineIndex] : 0
  //  let bigChangeInPrice = recentPriceDiff < -0.03
//  let earnedEnough = potentialProfit >= 0.50
  let targetValue = lastPickedTrade ? Math.sqrt(lastTradeCurrentState.meanSquareError) : 0
  let earnedEnough = false//lastPickedTrade ? (potentialProfit >= targetValue) : false
//  let earnedEnough = lastPickedTrade ? true : false

//  if (lastPickedTrade) {
//    log(`targetValue ${targetValue}`.blue)
//  }
  //  let noLongerGoodTrade = lastPickedTrade
  //    ? !checkValueCriteria(lastTradeCurrentState.klines, klineIndex, lastTradeCurrentState.closeLine )
  //    : false

  ////  /** determine if change */
  //  let newTradeIsBetter = pickedTrade
  //    ? noCurrentTradeOrNewTradeBetter(pickedTrade, lastPickedTrade)
  //    : false

  let newPlotDot = null

  /** make changes */
  if ((!lastPickedTrade && pickedTrade) || earnedEnough || dropThroughKline || fastMADropThroughMiddleMA ) {
    log(`--- earnedEnough ${earnedEnough} dropThroughKline ${dropThroughKline} fastMADropThroughMiddleMA ${fastMADropThroughMiddleMA}`.yellow)

    if (PRODUCTION) {
      newPlotDot = {
        time: currentTime,
        rate: lastPickedTrade ? lastPickedTrade.rate : 'n/a',
        BTCvolume: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] * lastPickedTrade.closeLine[klineIndex] : 'n/a',
        volume: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] : 'n/a',
        volDerive: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] / lastPickedTrade.volumeLine[klineIndex-1] : 'n/a',
        klineDerive: lastPickedTrade ? lastPickedTrade.klines[windows[0]][klineIndex] / lastPickedTrade.klines[windows[0]][klineIndex-1] : 'n/a',
      }

      if (earnedEnough || dropThroughKline || fastMADropThroughMiddleMA ) {
        /*
        * 卖币
        * */
        log(`--- Selling ${lastPickedTrade.symbol}`.blue)

        log('last 4 close prices', lastTradeCurrentState.closeLine.slice(-4).join(', '))
        log('last 4 close timeLine', lastTradeCurrentState.timeLine.slice(-4).join(', '))
        log('last 4 close volumeLine', lastTradeCurrentState.volumeLine.slice(-4).join(', '))
        log('last 4 close MA4', lastTradeCurrentState.klines[windows[0]].slice(-4).join(', '))
        log('last 4 close MA16', lastTradeCurrentState.klines[windows[1]].slice(-4).join(', '))
        log('klineIndex', klineIndex)
        log('lastTradeCurrentState.closeLine.length', lastTradeCurrentState.closeLine.length)
        let symbol = lastPickedTrade.symbol
        let targetCurrency = symbol.split('/')[0]

        /**
         * 取消当前open order
         * */
        let fetchOrderResult = await retryExTaskIfTimeout(exchange, 'fetchOpenOrders', [symbol])

        let orderIds = fetchOrderResult.map(obj => obj.id)

        let cancelPromiseList = orderIds.map(orderId => retryExTaskIfTimeout(exchange, 'cancelOrder', [orderId, symbol, {'recvWindow': 60*10*1000}]))

        let results = await Promise.all(cancelPromiseList)

        /**
         * 开始卖
         * */

        let targetBalance = (await retryExTaskIfTimeout(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free'][targetCurrency]
        log(`--- ${targetCurrency} balance ${targetBalance}, sell amount ${lastPickedTrade.boughtAmount}`.green)

        log(`--- Start Selling`.blue)

        player.play('./src/Purr.aiff', (err) => {
          if (err) throw err
        })

        let sellResult = await retryExTaskIfTimeout(exchange, 'createMarketSellOrder', [symbol, lastPickedTrade.boughtAmount, {'recvWindow': 60*10*1000}])
        //        let sellResult = await exchange.createMarketSellOrder(symbol, lastPickedTrade.boughtAmount)
        log(`--- Selling Result`.blue, sellResult)

        let newBTCBalance = (await retryExTaskIfTimeout(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
        //        let newBTCBalance = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
        log(`--- newBTCBalance ${newBTCBalance}`)

        newPlotDot.event = `Sell ${lastPickedTrade.symbol}`

        let askPrice = (await retryExTaskIfTimeout(exchange, 'fetchL2OrderBook', [symbol])).asks[0]
        //        let askPrice = (await exchange.fetchL2OrderBook(symbol)).asks[0]
        newPlotDot.sellPrice = askPrice[0]
        newPlotDot.value = newBTCBalance

        lastPickedTrade = null
      }
      else {
        /*
        * 买币
        * */
        let symbol = pickedTrade.symbol

        let BTCAmount = (await retryExTaskIfTimeout(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
        //        let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
        let orderBook = await retryExTaskIfTimeout(exchange, 'fetchL2OrderBook', [symbol])
        //        let orderBook = await exchange.fetchL2OrderBook(symbol)

        let weightedBuyPrice = api.weightedPrice(orderBook.asks, BTCAmount).tradePrice

        log(`--- Buy in ${pickedTrade.symbol} at ${weightedBuyPrice} with BTCAmount ${BTCAmount}`.blue)
        log('last 4 close prices', pickedTrade.closeLine.slice(-4).join(', '))
        log('last 4 close timeLine', pickedTrade.timeLine.slice(-4).join(', '))
        log('last 4 close volumeLine', pickedTrade.volumeLine.slice(-4).join(', '))
        log('last 4 close MA4', pickedTrade.klines[windows[0]].slice(-4).join(', '))
        log('last 4 close MA16', pickedTrade.klines[windows[1]].slice(-4).join(', '))
        log('klineIndex', klineIndex)
        log('lastTradeCurrentState.closeLine.length', pickedTrade.closeLine.length)

        player.play('./src/Glass.aiff', (err) => {
          if (err) throw err
        })

        /**
         * 买三次，避免买不到
         * */
        let maxAmount = BTCAmount * 0.999 / weightedBuyPrice
        let buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7

        let buyResult = await retryExTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
        //        let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
        console.log('buyResult', buyResult)
        if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
          throw new Error('Purchase error!')
        }

        let boughtAmount = Number(buyResult.info.executedQty)
        //        todo get order Id and clientOrderId

        try {
          let BTCAmount = (await retryExTaskIfTimeout(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
          //          let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
          let maxAmount = BTCAmount * 0.999 / weightedBuyPrice
          let buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7
          let buyResult = await retryExTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
          //          let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
          log(`Second buy result`, buyResult)
          if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
            throw new Error('Second purchase error!')
          }

          boughtAmount += Number(buyResult.info.executedQty)

          BTCAmount = (await retryExTaskIfTimeout(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
          //          let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
          maxAmount = BTCAmount * 0.999 / weightedBuyPrice
          buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7
          buyResult = await retryExTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
          //          let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
          log(`Third buy result`, buyResult)
          if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
            throw new Error('Third purchase error!')
          }

          boughtAmount += Number(buyResult.info.executedQty)
        }
        catch (error) {
          log(`Second or third buy error, relatively ok ${error}`.red)
        }

        lastPickedTrade = pickedTrade
        lastPickedTrade.boughtAmount = boughtAmount

        /**
         * 设置止赢
         * */

        console.log('orderBook.asks[0]', orderBook.asks[0])
        console.log('lastPickedTrade.boughtAmount', lastPickedTrade.boughtAmount)
        cutProfitList = generateCutProfitList(lastPickedTrade, 60 / 5)

        let createLimitOrderPromises = cutProfitList.map(cutProfit => {
          let cutAmount = boughtAmount * cutProfit.percent / 100
          return retryExTaskIfTimeout(exchange, 'createLimitSellOrder', [symbol, cutAmount, orderBook.asks[0][0] * (100+cutProfit.value)/100, {'recvWindow': 60*10*1000}])
        })

        try {
          let createLimitOrdersResult = await Promise.all(createLimitOrderPromises)
          let orderIds = []
          for (let limitOrderResult of createLimitOrdersResult) {
            console.log('limitOrderResult', limitOrderResult)
          }
          //        console.log('createLimitOrdersResult', createLimitOrdersResult)
        }
        catch (error) {
          console.log(error)
          log(`createLimitOrdersResult error, ignored`.red)
        }

        let newBTCAmount = (await retryExTaskIfTimeout(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
        let spentBTC = BTCAmount - newBTCAmount
        log(`---    spent ${Math.trunc(100 * spentBTC/BTCAmount)}% in purchase, average purchase price ${spentBTC / boughtAmount}`)

        newPlotDot.event = `Buy in ${pickedTrade.symbol}`
        newPlotDot.price = (spentBTC / boughtAmount) // todo 换成实际价格
        newPlotDot.value = BTCAmount
      }

    } else {
      /*
      * Time Walk Simulation
      * */
      newPlotDot = {
        time: currentTime,
        profit: lastPickedTrade ? potentialProfit : 'n/a',
        rate: lastPickedTrade ? lastPickedTrade.rate : 'n/a',
        BTCvolume: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] * lastPickedTrade.closeLine[klineIndex] : 'n/a',
        volume: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] : 'n/a',
        price: lastPickedTrade ? lastPickedTrade.closeLine[klineIndex] : 'n/a',
        volDerive: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] / lastPickedTrade.volumeLine[klineIndex-1] : 'n/a',
        klineDerive: lastPickedTrade ? lastPickedTrade.klines[windows[0]][klineIndex] / lastPickedTrade.klines[windows[0]][klineIndex-1] : 'n/a',
      }

      potentialProfit !== 0 && log(`money ${money} -> ${money * (1 + potentialProfit)}`.yellow)

      money = money * (1 + potentialProfit) * 0.9995 // 0.001 手续费
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
      if (earnedEnough || dropThroughKline || fastMADropThroughMiddleMA) {
        log(`Sell ${lastPickedTrade.symbol}`.blue)
        newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
        newPlotDot.sellPrice = lastTradeCurrentState.closeLine[klineIndex]
        lastPickedTrade = null
      } else {
        lastPickedTrade = pickedTrade
        cutProfitList = generateCutProfitList(lastPickedTrade, 60 / 5)
        log(`Buy in ${lastPickedTrade.symbol}`.blue)
        newPlotDot.event = `Buy in ${pickedTrade.symbol}`
      }
    }
  }

  return {lastPickedTrade, money, newPlotDot}
}

function useVolumeStrategy(params) {
  let {newExtractedInfoList, lastPickedTradeList, money, currentTime} = params
  let sortedByVol = _.sortBy(newExtractedInfoList, o => - (o.volumeLine[klineIndex] * o.closeLine[klineIndex]))
  //  console.log('sortedByVol', sortedByVol.map(info => info.volumeLine[klineIndex] * info.closeLine[klineIndex]).join(' '))

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

async function timeWalk(extractedInfoList){
  let shift = 0
//  let shift = 8901 - 2016 - 1
  let money = 100
  let lastPickedTrade = null // for kline strategy
  let lastPickedTradeList = [] // for volume strategy
  let plot = []//{time, value, event, profit, rate, BTCvolume}

  while (shift + lineLength < extractedInfoList[0].volumeLine.length) {
    let newExtractedInfoList = cutExtractedInfoList (extractedInfoList, shift, lineLength)
//    fs.writeFileSync(`${KLINE_FILE}-${shift}.js`, 'module.exports = ' + JSON.stringify(newExtractedInfoList), 'utf-8')
    let timeEpoch = newExtractedInfoList[0].timeLine[klineIndex]
    let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
    log(`${currentTime} ->`.green)

    /**
     * 给 newExtractedInfoList 添加 vibrateValue 和 BTCVolume
     * */
//    extractedInfoList = addVibrateValue(extractedInfoList, observeWindow)
//    extractedInfoList = addBTCVolValue(extractedInfoList, observeWindow)

    /**
     * 用momentum获得对应的whiteList -> weightWhiteList,
     * */
//    if ((shift % 288) === 0) {
//      let startDate = new Date()
//      let topWeighted = getTopWeighted(newExtractedInfoList, topWeightNo, 3 * 24 * 60 / 5)
//      weightWhiteList = (topWeighted).map(o => `${o.symbol}`)
//      console.log('weightWhiteList', weightWhiteList)
//      log(topWeighted.map(o => `${o.symbol}: ${o.weightValue}`).join(' '))
//    }

    /**
     * 用Vibrate获得对应的whiteList -> vibrateWhiteList,
     * */
    //    let topVibrated = getTopVibrated(extractedInfoList, topVibratedNo, observeWindow)
    //    vibrateWhiteList = (topVibrated).map(o => `${o.symbol}`)
    //    log(topVibrated.map(o => `${o.symbol}: ${o.meanSquareError}`).join(' '))

    /**
     * 用Volume获得对应的whiteList -> volumeWhiteList,
     * */
    if (useVolumeToChooseCurrency) {
      let topVolume = getTopVolume(newExtractedInfoList, undefined, 24 * 60 / 5, 5000)
      volumeWhiteList24H = (topVolume).map(o => `${o.symbol}`)
      log(topVolume.map(o => `${o.symbol}: ${o.BTCVolume}`).join(' '))

      topVolume = getTopVolume(newExtractedInfoList, undefined, 1 * 60 / 5, 5000 / 24)
      volumeWhiteList4H = (topVolume).map(o => `${o.symbol}`)
      log(topVolume.map(o => `${o.symbol}: ${o.BTCVolume}`).join(' '))

      let whiteListSet = new Set([...whiteList, ...volumeWhiteList24H.slice(0, topVolumeNo), ...volumeWhiteList4H.slice(0, 2)])
      console.log('whiteListSet', whiteListSet)
    }

    /** useKlineStrategy */
    let klineResult = await useKlineStrategy({newExtractedInfoList, lastPickedTrade, money, currentTime, whiteList})
    lastPickedTrade = klineResult.lastPickedTrade
    money = klineResult.money
    let newPlotDot = klineResult.newPlotDot

    //    /** volumeStrategy */
    //    let volumeResult = useVolumeStrategy({newExtractedInfoList, lastPickedTradeList, money, currentTime})
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
  let PRODUCTION = process.env.PRODUCTION
  log(`PRODUCTION ${PRODUCTION}`.red)
  if (PRODUCTION) {
    utils.resetConsole()
    /**
     * Production
     * */
    let lastPickedTrade = null // for kline strategy
    let lastPickedTradeList = [] // for volume strategy
    let plot = []//{time, value, event, profit, rate, BTCvolume}
    let prevExtractedInfoList = null
    let exchangeId = 'binance'
    let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials[exchangeId]))

    await exchange.loadMarkets()
    let symbols = _.filter(exchange.symbols, symbol => symbol.endsWith('BTC'))

    log(`---------- Running in Production ----------`.blue)
    log(`---        klineIndex ${klineIndex}`)
    log(`---        windows ${windows}`)
    log(`---------- Fetching Balance ----------`.green)
    let money = (await retryExTaskIfTimeout(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
    log(`---        BTC Balance - ${money}`.green)
    log(`---------- Fetching Balance ---------- \n`.green)

    while (true) {
      try {
        /**
         * Read data and get currentTime
         * */
        let numberOfPoint = 24 * 60 / 5
        let padding = 100
        let extractedInfoList = await klineListGetDuringPeriod(exchangeId, symbols, numberOfPoint + padding)
        klineIndex = extractedInfoList[0].timeLine.length - 1
        /**
         * Determine memory leak
         * */
//        try {
//          global.gc();
//        } catch (e) {
//          console.log("You must run program with 'node --expose-gc index.js' or 'npm start'");
//          process.exit();
//        }
//        var heapUsed = process.memoryUsage().heapUsed;
//        console.log("Program is using " + heapUsed + " bytes of Heap.")

        /**
         * Skip if extractedInfoList hasn't changed
         * */
        if (JSON.stringify(prevExtractedInfoList) === JSON.stringify(extractedInfoList)) {
          //        if (checkInfoChanged(prevExtractedInfoList, extractedInfoList)) {
          log('No new data, Skip'.green)
          continue
        }
        else {
          prevExtractedInfoList = extractedInfoList
        }

        let timeEpoch = Number(extractedInfoList[0].timeLine[klineIndex])
        let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
        log(`${moment().format('MMMM Do YYYY, h:mm:ss a')}, Data time: ${currentTime} ->`.green)

        if (useVolumeToChooseCurrency) {
          let topVolume = getTopVolume(extractedInfoList, undefined, numberOfPoint, 5000)
          volumeWhiteList24H = (topVolume).map(o => `${o.symbol}`)
          //        log(topVolume.map(o => `${o.symbol}: ${o.BTCVolume}`).join(' '))

          topVolume = getTopVolume(extractedInfoList, undefined, numberOfPoint / 6, 5000 / 6)
          volumeWhiteList4H = (topVolume).map(o => `${o.symbol}`)
          //        log(topVolume.map(o => `${o.symbol}: ${o.BTCVolume}`).join(' '))

          let whiteListSet = new Set([...whiteList, ...volumeWhiteList24H, ...volumeWhiteList4H])
          log(`WhiteList: ${([...whiteListSet].slice(0, topVolumeNo)).join(' ')}`.yellow)

          topVolume = getTopVolume(extractedInfoList, undefined, numberOfPoint / 24, 5000 / 24)
          //        console.log('topVolume', topVolume)
          //        log(topVolume.map(o => `${o.symbol}: ${o.BTCVolume}`).join(' '))
          log(`Top volume 1H: `.yellow + topVolume.map(o => {
            return whiteListSet.has(o.symbol) ? '' : (` ${o.symbol}: `.yellow + `${Math.round(o.BTCVolume)}`.green)
          }).join(''))
        }

        log(`---------- Using Kline Strategy ---------- `.green)
        let klineResult = await useKlineStrategy({newExtractedInfoList: extractedInfoList, lastPickedTrade, money, currentTime, PRODUCTION, exchange, whiteList})

        lastPickedTrade = klineResult.lastPickedTrade
        let newPlotDot = klineResult.newPlotDot
        console.log('newPlotDot', newPlotDot)
        if (!!newPlotDot) {
          plot.push(newPlotDot)
          if (newPlotDot.value !== money) {
            log(`BTC balance: ${money} -> ${newPlotDot.value}`)
          }
          console.log('plot', plot)
          saveJsonToCSV(plot, ['time', 'rate', 'BTCvolume', 'volDerive', 'klineDerive', 'event', 'price', 'sellPrice', 'value'], PLOT_CSV_FILE)
        }
        money = klineResult.money
        log(`---------- Using Kline Strategy ---------- \n`.green)

      } catch (error) {
        console.error('Major error', error)
        log(error.message.red)
        log('Stop trading. Await for admin to determine next step'.red)
        break
      }
    }
  }
  else {
    /**
     * TimeWalk simulation
     * */
    const extractedInfoList = require(`.${KLINE_FILE}`)
    try {
      await timeWalk(extractedInfoList)
    } catch (error) {
      console.error(error)
      log(error.message.red)
    }
  }
  process.exit()
})()

//module.exports =
