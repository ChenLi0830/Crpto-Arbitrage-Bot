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
  retryMutationTaskIfTimeout,
  retryQueryTaskIfAnyError,
  cutExtractedInfoList,
  getTopVibrated,
  getTopVolume,
  getTopWeighted,
  addVibrateValue,
  addBTCVolValue,
  generateCutProfitList,
  addPaddingExtractedInfoList,
  fetchNewPointAndAttach,
} = utils

const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')

let {
  lineLength,
  windows,
  KLINE_FILE,
  PLOT_CSV_FILE,
  intervalInMillesec,
  whiteList,
  blackList,
  dynamicProfitList,
} = require('./config')

/**
 * 测试用，lineLength是用来获得24小时vol时用的
 * */
lineLength = 1 * 24 * 60 / 5//
KLINE_FILE = `./savedData/klines/klines-5m-1d-Jan-21.js`

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

let useVolumeToChooseCurrency = true
let tempBuy = '' // used for debugging, 比如设置成 ETH/BTC，production就会马上买入BTC

let cutProfitList = []
let numberOfPoints = 24 * 60 / 5
let marketIsGood = false
let lastBoughtSymbol = null
let prevBuyingPoolList = []
//-----------------------------------------------------------------------------

function checkValueCriteria(klines, closeLine, openLine) {
  let isFastKlineLarger = (klines[windows[0]][klineIndex] >= klines[windows[1]][klineIndex]) && (klines[windows[0]][klineIndex] >= klines[windows[2]][klineIndex])
  let isMiddleKlineLarger = klines[windows[1]][klineIndex] >= klines[windows[2]][klineIndex]
  let priceGreaterThanFastKline = closeLine[klineIndex] > klines[windows[0]][klineIndex]
  let isFastKlineIncreasing = klines[windows[0]][klineIndex] > klines[windows[0]][klineIndex-1]
  let isMiddleKlineIncreasing = klines[windows[1]][klineIndex] > klines[windows[1]][klineIndex-1]
  let isSlowKlineIncreasing = klines[windows[2]][klineIndex] > klines[windows[2]][klineIndex-1]

  return isFastKlineLarger && isMiddleKlineLarger && priceGreaterThanFastKline && isFastKlineIncreasing && isMiddleKlineIncreasing && isSlowKlineIncreasing
}

function checkVolCriteria(volumeLine){
  let isVolumeIncreaseFast = (volumeLine[klineIndex] / volumeLine[klineIndex-1]) > 1
  let volumeAvg = _.mean(volumeLine.slice(-48))
  let isVolumeHigherThanAvg = volumeLine[klineIndex] > volumeAvg
  return isVolumeIncreaseFast && isVolumeHigherThanAvg
}

function checkBuyingCriteria(ohlcvMA) {
  const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = ohlcvMA
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

function getWhiteList(whiteList, volumeWhiteList24H, volumeWhiteList4H, blackList) {
  let whiteListSet = new Set([...whiteList, ...volumeWhiteList24H.slice(0, topVolumeNo), ...volumeWhiteList4H.slice(0, 2)])
  /*
  * 删除黑名单中的部分
  * */
  blackList && blackList.forEach(symbol => whiteListSet.delete(symbol))
  return [...whiteListSet]
}

function rateAndSort(ohlcvMAList, whiteList) {
  let buyingPool = []

  for (let ohlcvMA of ohlcvMAList) {

    /**
     * 上个刚刚买入的symbol如果和这个一样，则跳过，不连续买入同一个symbol
     * */
    //    if (lastBoughtSymbol === ohlcvMA.symbol) {
    //      continue
    //    }

    /**
     * 白名单过滤
     * */
    let newWhiteList = getWhiteList(whiteList, volumeWhiteList24H, volumeWhiteList4H, blackList)

    if (newWhiteList && newWhiteList.length > 0) {
      if (!newWhiteList.includes(ohlcvMA.symbol)) {
        continue
      }
    }
    /**
     * 若无白名单，则选择振动最强的
     * */
    else if (vibrateWhiteList && vibrateWhiteList.length > 0 && !vibrateWhiteList.includes(ohlcvMA.symbol)) {
      continue
    }
    else if (weightWhiteList && weightWhiteList.length > 0 && !weightWhiteList.includes(ohlcvMA.symbol)) {
      continue
    }

    /**
     * 过滤已经进行到一半的行情
     * */
    let isHalfGoingDeal = false
    for (let {time, pool} of prevBuyingPoolList) {
      // 如果在5分钟以外出现过，则判断为是进行到一般的行情
      let now = ohlcvMA.timeLine.slice(-1)[0]
      if ((now - time) > 5 * 60 * 1000 && (now - time) < 20 * 60 * 1000 && pool.indexOf(ohlcvMA.symbol) > -1) {
        isHalfGoingDeal=true
        break
      }
    }
    if (isHalfGoingDeal) {
      continue
    }

    const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = ohlcvMA
    let matchBuyingCriteria = checkBuyingCriteria(ohlcvMA)
    let isNewKline = process.env.PRODUCTION ? ((new Date().getTime() - ohlcvMA.timeLine.slice(-1)[0]) < 45 * 1000) : false
    if (matchBuyingCriteria || ohlcvMA.symbol===tempBuy) {
      tempBuy = ''
      let rate = rateCurrency(klines, volumeLine)
      buyingPool.push({...ohlcvMA, rate})
    }
    /*
    * 如果是刚刚生成的k线，判断它之前的k线是否满足条件，如果是则买入
    * */
    else if (isNewKline) {
      let prevExtractedInfo = cutExtractedInfoList([ohlcvMA], 0, ohlcvMA.timeLine.length-1)[0]
      /**
       * Add padding 保证prevExtractedInfo和ohlcvMA一样长
       * */
      prevExtractedInfo = addPaddingExtractedInfoList([prevExtractedInfo], 1)[0]
      let prevPointMatchBuyingCriteria = checkBuyingCriteria(prevExtractedInfo)

      if (prevPointMatchBuyingCriteria) {
        const {klines, volumeLine, closeLine, openLine, highLine, lowLine} = prevExtractedInfo
        let rate = rateCurrency(klines, volumeLine)
        buyingPool.push({...ohlcvMA, rate})
      }
    }
  }

  let sortedPool = _.sortBy(buyingPool, item => -item.rate)
  return sortedPool
}

function pickTradeFromList(newExtractedInfoList, whiteList){
  let sortedPool = rateAndSort(newExtractedInfoList, whiteList)
  if (sortedPool.length > 0) {
    let now = sortedPool[0].timeLine.slice(-1)[0]
    prevBuyingPoolList.push({
      time: now,
      pool: sortedPool.map(o => o.symbol)
    })
    /**
     * 如果超过10分钟的，就去掉
     * */
    if (now - prevBuyingPoolList[0].time > 15 * 60 * 1000) {
      console.log('prevBuyingPoolList.unshift()')
      prevBuyingPoolList.shift()
    }

    log('Picking from list: '.green, sortedPool.map(o => o.symbol).join(' '))
    let pickedTrade
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

  /**
   * 用volume来获得volumeWhiteList
   * */
  if (useVolumeToChooseCurrency) {
    let topVolume = getTopVolume(newExtractedInfoList, undefined, numberOfPoints)
    volumeWhiteList24H = (topVolume).map(o => `${o.symbol}`)
    //        log(topVolume.map(o => `${o.symbol}: ${o.BTCVolume}`).join(' '))

    topVolume = getTopVolume(newExtractedInfoList, undefined, numberOfPoints / 6)
    volumeWhiteList4H = (topVolume).map(o => `${o.symbol}`)
//    topVolume = getTopVolume(newExtractedInfoList, undefined, numberOfPoints / 6, 5000 / 6)
//    volumeWhiteList4H = (topVolume).map(o => `${o.symbol}`)

    let overallWhiteList = getWhiteList(whiteList, volumeWhiteList24H, volumeWhiteList4H, blackList)
    log(`WhiteList: ${overallWhiteList}`.yellow)

    /*
    * 显示1小时内，除了已经在whiteList里，vol最高的前10
    * */
    topVolume = getTopVolume(newExtractedInfoList, undefined, numberOfPoints / 24 / 4)
    topVolume = _.filter(topVolume, o => overallWhiteList.indexOf(o.symbol) === -1).slice(0,10)
    log(`Top volume 15m: `.yellow + topVolume.map(o => (
      `${o.symbol}: `.yellow + `${Math.round(o.BTCVolume)}`.green
    )).join(' '))
  }

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

  /**
   * 潜在盈利值
   * */
  let potentialProfit = lastPickedTrade ? calcProfitPercent(lastPickedTrade, lastTradeCurrentState) : 0

  /**
   * 是否锁定收益：止盈线被触发，且价格小于等于成本价 (lastPickedTrade.buyPrice) ?
   * */
  let shouldLockProfit = false
  let priceDropThroughCost = lastTradeCurrentState ? lastTradeCurrentState.closeLine.slice(-1)[0] <= lastPickedTrade.buyPrice: false
  if (priceDropThroughCost) { // 判断止盈线是否被触发
    let fetchedOrders = await retryQueryTaskIfAnyError(exchange, 'fetchOrders', [lastTradeCurrentState.symbol])
    log(`Current price ${lastTradeCurrentState.closeLine.slice(-1)[0]} <= Purchase price ${lastPickedTrade.buyPrice}`.green)
    for (let limitOrder of lastPickedTrade.limitOrders) {
      let currentOrderStatus = _.find(fetchedOrders, {id: limitOrder.id})
      console.log('currentOrderStatus.status', currentOrderStatus.status)
      if (currentOrderStatus.status==='closed') {
        /**
         * 至少一个止盈线被触发了
         * */
        shouldLockProfit = true
        log('ShouldLockProfit becomes true'.yellow)
      }
    }
  }
  shouldLockProfit = false // 停掉止盈保本

  let dropThroughKline = false
  let fastMADropThroughMiddleMA = false
  let volumeLessThanPrevPoint = false
  /*
  * 如果是在当前kline买入，需要等kline结束才判断是否dropThroughKline
  * */
  if (lastTradeCurrentState && (lastTradeCurrentState.timeLine[klineIndex] > lastPickedTrade.timeLine[klineIndex])) {
    /**
     * 生产环境中，卖出是用前一根kline判断
     * */
    let sellKline = process.env.PRODUCTION ? klineIndex-1 : klineIndex
    dropThroughKline = lastTradeCurrentState.closeLine[sellKline] < lastTradeCurrentState.klines[windows[0]][sellKline]
    fastMADropThroughMiddleMA = (lastTradeCurrentState.klines[windows[0]][sellKline] < lastTradeCurrentState.klines[windows[1]][sellKline] && lastTradeCurrentState.klines[windows[0]][sellKline-1] > lastTradeCurrentState.klines[windows[1]][sellKline-1])
    volumeLessThanPrevPoint = (lastTradeCurrentState.volumeLine[sellKline] / lastTradeCurrentState.volumeLine[sellKline - 1]) < 0.5
  }

  let targetValue = lastPickedTrade ? Math.sqrt(lastTradeCurrentState.meanSquareError) : 0
  let earnedEnough = false//lastPickedTrade ? (potentialProfit >= targetValue) : false

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
  if ((!lastPickedTrade && pickedTrade) || earnedEnough || dropThroughKline || fastMADropThroughMiddleMA || volumeLessThanPrevPoint || shouldLockProfit) {
    log(`--- earnedEnough ${earnedEnough} dropThroughKline ${dropThroughKline} fastMADropThroughMiddleMA ${fastMADropThroughMiddleMA} volumeLessThanPrevPoint ${volumeLessThanPrevPoint}  shouldLockProfit ${shouldLockProfit}`.yellow)

    if (PRODUCTION) {
      newPlotDot = {
        time: currentTime,
        rate: lastPickedTrade ? lastPickedTrade.rate : 'n/a',
        BTCvolume: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] * lastPickedTrade.closeLine[klineIndex] : 'n/a',
        volume: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] : 'n/a',
        volDerive: lastPickedTrade ? lastPickedTrade.volumeLine[klineIndex] / lastPickedTrade.volumeLine[klineIndex-1] : 'n/a',
        klineDerive: lastPickedTrade ? lastPickedTrade.klines[windows[0]][klineIndex] / lastPickedTrade.klines[windows[0]][klineIndex-1] : 'n/a',
      }

      if (earnedEnough || dropThroughKline || fastMADropThroughMiddleMA || volumeLessThanPrevPoint || shouldLockProfit) {
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

        /*
        * 查看limit order的filled amount
        * */
        let fetchedOrders = await retryQueryTaskIfAnyError(exchange, 'fetchOrders', [symbol])
        let filledAmount = 0
        for (let limitOrder of lastPickedTrade.limitOrders) {
          let currentOrderStatus = _.find(fetchedOrders, {id: limitOrder.id})
          console.log('currentOrderStatus', currentOrderStatus)
          if (currentOrderStatus.status==='closed') { //止盈order被filled了
            filledAmount += limitOrder.amount
          }
          else if (currentOrderStatus.status==='open') { //止盈order未被filled，或被filled一部分
            filledAmount += Math.min(currentOrderStatus.filled, limitOrder.amount) // filled是safeFloat，可能跟实际值有出入
          }
        }
        console.log('filledAmount', filledAmount)
        /**
         * 取消被程序创建且当前为open的order
         * */
        let orderIds = []
        fetchedOrders.forEach(obj => obj.status === 'open' && orderIds.push(obj.id))
        orderIds = _.filter(orderIds, id => lastPickedTrade.limitOrders.map(order=>order.id).indexOf(id) > -1)

        let cancelPromiseList = orderIds.map(orderId => retryMutationTaskIfTimeout(exchange, 'cancelOrder', [orderId, symbol, {'recvWindow': 60*10*1000}]))

        let results = await Promise.all(cancelPromiseList)

        /**
         * 开始卖
         * */

        let targetBalance = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free'][targetCurrency]
        let sellAmount = Math.min(targetBalance, (lastPickedTrade.boughtAmount - filledAmount))
        log(`--- ${targetCurrency} balance ${targetBalance}, bought amount ${lastPickedTrade.boughtAmount}, sell amount ${sellAmount}`.green)

        log(`--- Start Selling`.blue)

        player.play('./src/Purr.aiff', (err) => {
          if (err) throw err
        })

        let minSellAmount = exchange.markets[lastPickedTrade.symbol].limits.amount.min
        if (sellAmount < minSellAmount) {
          /**
           * 如果小于所能卖出的最小值，则认为是已经被用户或止盈卖光了
           * */
          newPlotDot.event = `${lastPickedTrade.symbol} is sold by user or limitOrders`
          log(`${lastPickedTrade.symbol} has already been sold by user or limit orders`.yellow)
          let newBTCBalance = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
          log(`--- newBTCBalance ${newBTCBalance}`)
          newPlotDot.value = newBTCBalance
        }
        else {
          /**
           * 否则卖币
           * */
          let sellResult = await retryMutationTaskIfTimeout(exchange, 'createMarketSellOrder', [symbol, sellAmount, {'recvWindow': 60*10*1000}])
          log(`--- Selling Result`.blue, sellResult)
          let newBTCBalance = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
          log(`--- newBTCBalance ${newBTCBalance}`)
          newPlotDot.value = newBTCBalance
          newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
          let askPrice = (await retryQueryTaskIfAnyError(exchange, 'fetchL2OrderBook', [symbol])).asks[0]
          newPlotDot.sellPrice = askPrice[0]
        }

        lastBoughtSymbol = lastPickedTrade.symbol
        lastPickedTrade = null
      }
      else {
        /*
        * 买币
        * */
        let symbol = pickedTrade.symbol

        let BTCAmount = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
        //        let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
        let orderBook = await retryQueryTaskIfAnyError(exchange, 'fetchL2OrderBook', [symbol])
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

        let buyResult = await retryMutationTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
        //        let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
        console.log('buyResult', buyResult)
        if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
          throw new Error('Purchase error!')
        }

        let boughtAmount = Number(buyResult.info.executedQty)

        try {
          let BTCAmount = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
          //          let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
          let maxAmount = BTCAmount * 0.999 / weightedBuyPrice
          let buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7
          let buyResult = await retryMutationTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
          //          let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
          log(`Second buy result`, buyResult)
          if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
            throw new Error('Second purchase error!')
          }

          boughtAmount += Number(buyResult.info.executedQty)

          BTCAmount = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
          //          let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
          maxAmount = BTCAmount * 0.999 / weightedBuyPrice
          buyInAmount = maxAmount * 0.7 > 1 ? Math.trunc(maxAmount * 0.7) : maxAmount * 0.7
          buyResult = await retryMutationTaskIfTimeout(exchange, 'createMarketBuyOrder', [symbol, buyInAmount, {'recvWindow': 60*10*1000}])
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

        let newBTCAmount = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
        let spentBTC = BTCAmount - newBTCAmount
        let buyPrice = (spentBTC / boughtAmount)
        log(`---    spent ${spentBTC} BTC -  ${Math.trunc(100 * spentBTC/BTCAmount)}% in purchase, average purchase price ${buyPrice}`)
        lastPickedTrade.buyPrice = buyPrice

        newPlotDot.event = `Buy in ${pickedTrade.symbol}`
        newPlotDot.price = (spentBTC / boughtAmount)
        newPlotDot.value = BTCAmount

        /**
         * 设置止赢
         * */

        console.log('orderBook.asks[0]', orderBook.asks[0])
        console.log('lastPickedTrade.boughtAmount', lastPickedTrade.boughtAmount)
        cutProfitList = generateCutProfitList(lastPickedTrade, 60 / 5, dynamicProfitList)

        let createLimitOrderPromises = cutProfitList.map(cutProfit => {
          let cutAmount = boughtAmount * cutProfit.percent / 100
          return retryMutationTaskIfTimeout(exchange, 'createLimitSellOrder', [symbol, cutAmount, orderBook.asks[0][0] * (100+cutProfit.value)/100, {'recvWindow': 60*10*1000}])
        })

        /**
         * 创建limit orders
         * */
        let limitOrders = []
        await Promise.all(createLimitOrderPromises.map(async (createOrderPromise, i) => {
          try {
            let limitOrderResult = await createOrderPromise
            if (limitOrderResult && limitOrderResult.id) {
              limitOrders.push({
                id: limitOrderResult.id,
                amount: limitOrderResult.amount
              })
            }
          }
          catch (error) {
            console.log(error)
            log(`createLimitOrdersResult error, often because of not enough balance, ignored`.red)
          }
        }))
        console.log('limitOrders', limitOrders)
        lastPickedTrade.limitOrders = limitOrders
      }

    }
    else {
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

      money = money * (1 + potentialProfit) * 0.999 // 0.0005 * 2 的手续费
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
      if (earnedEnough || dropThroughKline || fastMADropThroughMiddleMA || volumeLessThanPrevPoint || shouldLockProfit) {
        log(`Sell ${lastPickedTrade.symbol}`.blue)
        newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
        newPlotDot.sellPrice = lastTradeCurrentState.closeLine[klineIndex]

        lastBoughtSymbol = lastPickedTrade.symbol
        lastPickedTrade = null
      } else {
        lastPickedTrade = pickedTrade
        cutProfitList = generateCutProfitList(lastPickedTrade, 60 / 5, dynamicProfitList)
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

async function timeWalk(ohlcvMAList){
  let shift = 0
//  let shift = 8901 - 2016 - 1
  let money = 100
  let lastPickedTrade = null // for kline strategy
  let lastPickedTradeList = [] // for volume strategy
  let plot = []//{time, value, event, profit, rate, BTCvolume}

  while (shift + lineLength < ohlcvMAList[0].volumeLine.length) {
    let newExtractedInfoList = cutExtractedInfoList (ohlcvMAList, shift, lineLength)
//    fs.writeFileSync(`${KLINE_FILE}-${shift}.js`, 'module.exports = ' + JSON.stringify(newExtractedInfoList), 'utf-8')
    let timeEpoch = newExtractedInfoList[0].timeLine[klineIndex]
    let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
    log(`${currentTime} ->`.green)

    /** useKlineStrategy */
    let klineResult = await useKlineStrategy({newExtractedInfoList, lastPickedTrade, money, currentTime, whiteList})
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
    let money = (await retryQueryTaskIfAnyError(exchange, 'fetchBalance', [{'recvWindow': 60*10*1000}]))['free']['BTC']
    log(`---        BTC Balance - ${money}`.green)
    log(`---------- Fetching Balance ---------- \n`.green)

//    /**
//     * 初始化读取 numberOfPoints+padding 个数据
//     * */
    let padding = 100
    let nowStamp = new Date().getTime()
    let ohlcvMAList = await klineListGetDuringPeriod(exchangeId, symbols, numberOfPoints + padding)
    log(`Initialized fetch of ohlcvMAList takes ${((new Date().getTime() - nowStamp)/1000)}s`)

    while (true) {
      try {
        /**
         * Read data and get currentTime
         * */
        let fetchStamp = new Date().getTime()
        ohlcvMAList = await fetchNewPointAndAttach(ohlcvMAList, exchangeId, windows)
//        console.log('ohlcvMAList[0].symbol', ohlcvMAList[0].symbol)
//        console.log('ohlcvMAList[0].closeLine.length', ohlcvMAList[0].closeLine.length)
//        console.log('ohlcvMAList[0].closeLine.slice(-3)', ohlcvMAList[0].closeLine.slice(-3))
//        console.log('ohlcvMAList[0].timeLine.slice(-3)', ohlcvMAList[0].timeLine.slice(-3))
//        console.log('ohlcvMAList[0].klines[windows[0]].slice(-3)', ohlcvMAList[0].klines[windows[0]].slice(-3))
//        console.log('ohlcvMAList[0].klines[windows[1]].slice(-3)', ohlcvMAList[0].klines[windows[1]].slice(-3))
//        log(`It takes ${((new Date().getTime() - fetchStamp)/1000)}s to finish fetching new data`)

        klineIndex = ohlcvMAList[0].timeLine.length - 1
        if (klineIndex !== numberOfPoints) {
          throw new Error(`klineIndex ${klineIndex} !==${numberOfPoints}`)
        }

        /**
         * 用 while 读取白名单，并删除config记录
         * */
        try {
          let cachedModule = require.cache[require.resolve('./config')]
          if (cachedModule) {
            delete require.cache[require.resolve('./config')].parent.children//Clear require cache
            delete require.cache[require.resolve('./config')]
          }

          await api.sleep(100)
          whiteList = require('./config').whiteList
          blackList = require('./config').blackList
          dynamicProfitList = require('./config').dynamicProfitList
        }
        catch (error) {
          console.log(error)
        }
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
         * Skip if ohlcvMAList hasn't changed
         * */
        if (JSON.stringify(prevExtractedInfoList) === JSON.stringify(ohlcvMAList)) {
          //        if (checkInfoChanged(prevExtractedInfoList, ohlcvMAList)) {
//          log('No new data, Skip'.green)
          continue
        }
        else {
          prevExtractedInfoList = ohlcvMAList
        }

        let timeEpoch = Number(ohlcvMAList[0].timeLine[klineIndex])
        let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
        log(`${moment().format('MMMM Do YYYY, h:mm:ss a')}, Data time: ${currentTime} ->`.green)

        log(`---------- Using Kline Strategy ---------- `.green)
        let klineResult = await useKlineStrategy({newExtractedInfoList: ohlcvMAList, lastPickedTrade, money, currentTime, PRODUCTION, exchange, whiteList})

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
    const ohlcvMAList = require(`.${KLINE_FILE}`)
    whiteList = require('./config').whiteList
    dynamicProfitList = require('./config').dynamicProfitList
    try {
      await timeWalk(ohlcvMAList)
    } catch (error) {
      console.error(error)
      log(error.message.red)
    }
  }
  process.exit()
})()

//module.exports =
