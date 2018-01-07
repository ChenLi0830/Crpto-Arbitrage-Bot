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

const {
  lineLength,
  windows,
  topVibratedNo
} = require('./config')

const KLINE_FILE = './savedData/klines/klines.js' // todo production时使用不同的文件名 `...${production}.js`
const PICKED_TRADE = './savedData/pickedTrade.js'
const PLOT_CSV_FILE = './savedData/klines/plotCsv.csv'

//-----------------------------------------------------------------------------

/**
 * Get top vibrated
 * */
function getTopVibrated(extractedInfoList, topVibratedNo, observeLength = 50){
  for ( let extractedInfo of extractedInfoList ) {
    if (!extractedInfo) {
      console.log('undefined', extractedInfo)
//      console.log('extractedInfoList', extractedInfoList)
    }
    let meanClose = _.mean(extractedInfo.closeLine)
//    let meanSquareError = 0
//    for (let price of extractedInfo.closeLine) {
//      meanSquareError = meanSquareError + Math.pow((price - meanClose)/meanClose, 2)
//    }
    let infoLength = extractedInfo.closeLine.length
    let vibrateValue = 0
    for (let i=infoLength - observeLength + 1; i<infoLength; i++) {
      /**
       * 只看增长部分
       * */
      let increaseValue = (extractedInfo.closeLine[i] - extractedInfo.closeLine[i-1]) / extractedInfo.closeLine[i-1]
      if (increaseValue > 0) {
        vibrateValue += increaseValue
      }
    }
    extractedInfo.vibrateValue = vibrateValue
  }
  let sortedExtractedInfoList = _.sortBy(extractedInfoList, obj => -obj.vibrateValue)
  log(sortedExtractedInfoList.map(o => `${o.symbol}: ${o.vibrateValue}`).slice(0, topVibratedNo).join(' '))

  return sortedExtractedInfoList.map(o => `${o.symbol}`).slice(0, topVibratedNo)
//  return sortedExtractedInfoList.slice(topVibratedNo)
}

function checkValueCriteria(klines, index, closeLine) {
  let isFastKlineLarger = (klines[windows[0]][index] > klines[windows[1]][index]) && (klines[windows[0]][index] > klines[windows[2]][index])
  let isMiddleKlineLarger = klines[windows[1]][index] > klines[windows[2]][index]
  let priceGreaterThanFastKline = closeLine[index] > klines[windows[0]][index]

//  let accumatedIncrease = 0
//  let accumulatedInterval = 0
//  for (let i=index-1; i>0; i--) {
//    if (klines[windows[0]][i-1] > klines[windows[0]][i]) {
//      accumatedIncrease = (klines[windows[0]][index] - klines[windows[0]][i-1]) / klines[windows[0]][i-1]
//      accumulatedInterval = index - i
//      break
//    }
//  }
//  let previousIncreaseNotTooBig = accumatedIncrease < 0.2 || accumulatedInterval < 5

  return isFastKlineLarger && isMiddleKlineLarger && priceGreaterThanFastKline /*&& previousIncreaseNotTooBig*/
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
//  if (isPricesHigherThanPrevPoint) {
//    log(closeLine[lineLength - 1], closeLine[lineLength - 2], openLine[lineLength - 1], openLine[lineLength - 2])
//  }
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

function rateAndSort(extractedInfoList, whiteList) {
  let buyingPool = []

  for (let extractedInfo of extractedInfoList) {
    /**
    * 白名单过滤 - 选择振动最强的
    * */
    if (whiteList && whiteList.length > 0 && !whiteList.includes(extractedInfo.symbol)) {
      continue
    }

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

////  /** determine if change */
//  let newTradeIsBetter = pickedTrade
//    ? noCurrentTradeOrNewTradeBetter(pickedTrade, lastPickedTrade)
//    : false

  let newPlotDot = null

  /** make changes */
  if ((!lastPickedTrade && pickedTrade) || earnedEnough || dropThroughKline /*lostTooMuch || bigChangeInPrice || noLongerGoodTrade*/ ) {
    log(`--- earnedEnough ${earnedEnough} dropThroughKline ${dropThroughKline}`.yellow)

    if (PRODUCTION) {
      newPlotDot = {
        time: currentTime,
        rate: lastPickedTrade ? lastPickedTrade.rate : 'n/a',
        BTCvolume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] * lastPickedTrade.closeLine[lineLength-1] : 'n/a',
        volume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] : 'n/a',
        volDerive: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] / lastPickedTrade.volumeLine[lineLength-2] : 'n/a',
        klineDerive: lastPickedTrade ? lastPickedTrade.klines[windows[0]][lineLength-1] / lastPickedTrade.klines[windows[0]][lineLength-2] : 'n/a',
      }

      if (earnedEnough || dropThroughKline) {
        /*
        * 卖币
        * */
        log(`--- Selling ${lastPickedTrade.symbol}`.blue)

        let symbol = lastPickedTrade.symbol
        let targetCurrency = symbol.split('/')[0]
        let targetBalance = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free'][targetCurrency]
        log(`--- ${targetCurrency} balance ${targetBalance}`.green)

        log(`--- Start Selling`.blue)
        let sellResult = await exchange.createMarketSellOrder(symbol, targetBalance)
        log(`--- Selling Result`.blue, sellResult)

        let newBTCBalance = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
        log(`--- newBTCBalance ${newBTCBalance}`)

        newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
        let askPrice = (await exchange.fetchL2OrderBook(symbol)).asks[0]
        newPlotDot.sellPrice = askPrice[0]
        newPlotDot.value = newBTCBalance

        lastPickedTrade = null
      }
      else {
        /*
        * 买币
        * */
        let symbol = pickedTrade.symbol
        let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
        let orderBook = await exchange.fetchL2OrderBook(symbol)

        let weightedBuyPrice = api.weightedPrice(orderBook.asks, BTCAmount).tradePrice

        log(`--- Buy in ${pickedTrade.symbol} at ${weightedBuyPrice} with BTCAmount ${BTCAmount}`.blue)

        /**
         * 买两次，避免买不到
         * */
        let maxAmount = BTCAmount * 0.999 / weightedBuyPrice
        let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
        console.log('buyResult', buyResult)
        if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
          throw new Error('Purchase error!')
        }

        let boughtAmount = Number(buyResult.info.executedQty)
//        todo get order Id and clientOrderId

        try {
          let BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
          let maxAmount = BTCAmount * 0.999 / weightedBuyPrice
          let buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
          log(`Second buy result`, buyResult)
          if (!buyResult || !buyResult.info || buyResult.info.status !== 'FILLED') {
            throw new Error('Second purchase error!')
          }

          boughtAmount += Number(buyResult.info.executedQty)

          BTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
          maxAmount = BTCAmount * 0.999 / weightedBuyPrice
          buyResult = await exchange.createMarketBuyOrder(symbol, maxAmount * 0.7)
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

        let newBTCAmount = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
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
        BTCvolume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] * lastPickedTrade.closeLine[lineLength-1] : 'n/a',
        volume: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] : 'n/a',
        price: lastPickedTrade ? lastPickedTrade.closeLine[lineLength-1] : 'n/a',
        volDerive: lastPickedTrade ? lastPickedTrade.volumeLine[lineLength-1] / lastPickedTrade.volumeLine[lineLength-2] : 'n/a',
        klineDerive: lastPickedTrade ? lastPickedTrade.klines[windows[0]][lineLength-1] / lastPickedTrade.klines[windows[0]][lineLength-2] : 'n/a',
      }

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
        log(`Sell ${lastPickedTrade.symbol}`.green)
        newPlotDot.event = `Sell ${lastPickedTrade.symbol}`
        newPlotDot.sellPrice = lastTradeCurrentState.closeLine[lineLength-1]
        lastPickedTrade = null
      } else {
        lastPickedTrade = pickedTrade
        log(`Buy in ${lastPickedTrade.symbol}`)
        newPlotDot.event = `Buy in ${pickedTrade.symbol}`
      }
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

function cutExtractedInfoList (extractedInfoList, shift, lineLength) {
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
  return newExtractedInfoList
}

async function timeWalk(extractedInfoList){
  let shift = 0
  let money = 100
  let lastPickedTrade = null // for kline strategy
  let lastPickedTradeList = [] // for volume strategy
  let plot = []//{time, value, event, profit, rate, BTCvolume}

  while (shift + lineLength < extractedInfoList[0].volumeLine.length) {
    let newExtractedInfoList = cutExtractedInfoList (extractedInfoList, shift, lineLength)
    fs.writeFileSync(`${KLINE_FILE}-${shift}.js`, 'module.exports = ' + JSON.stringify(newExtractedInfoList), 'utf-8')
    let timeEpoch = newExtractedInfoList[0].timeLine[lineLength-1]
    let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
    log(`${currentTime} ->`.green)

    let whiteList = getTopVibrated(newExtractedInfoList, topVibratedNo, 30)
    console.log('topVibrated', whiteList)

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

function checkInfoChanged(prevExtractedInfoList, extractedInfoList) {
  if (!prevExtractedInfoList) {
    return false
  }

  for (let info of prevExtractedInfoList){
    let newInfo = _.find(extractedInfoList, {symbol: info.symbol})
    if (!newInfo || !info) {
      return true
    }
    if (info.timeLine.slice(-1)[0] !== newInfo.timeLine.slice(-1)[0]) {
      return false
    }
  }

  return true
}

(async function main () {
  let PRODUCTION = process.env.PRODUCTION
  log(`PRODUCTION ${PRODUCTION}`.red)
  if (PRODUCTION) {
    /**
     * Production
     * */
    let lastPickedTrade = null // for kline strategy
    let lastPickedTradeList = [] // for volume strategy
    let plot = []//{time, value, event, profit, rate, BTCvolume}
    let prevExtractedInfoList = null
    let exchangeId = 'binance'
    let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials[exchangeId]))

    utils.resetConsole()

    log(`---------- Running in Production ----------`.blue)
    await api.sleep(3000)

    log(`---        lineLength ${lineLength}`)
    log(`---        windows ${windows}`)
    log(`---        topVibratedNo ${topVibratedNo}`)

    log(`---------- Fetching Balance ----------`.green)
    let money = (await exchange.fetchBalance({'recvWindow': 60*10*1000}))['free']['BTC']
    log(`---        BTC Balance - ${money}`.green)
    log(`---------- Fetching Balance ---------- \n`.green)

    while (true) {
      try {
        await api.sleep(5000)
        /**
         * Read data and get currentTime
         * */

        let extractedInfoList = null
        /**
         * 用 while 读取，防止出现文件更新时读取的情况
         * */
        while (!extractedInfoList || !extractedInfoList[0]) {
          let cachedModule = require.cache[require.resolve('../savedData/klines/klines')]
          if (cachedModule) {
            delete require.cache[require.resolve('../savedData/klines/klines')].parent.children//Clear require cache
            delete require.cache[require.resolve('../savedData/klines/klines')]
          }

          await api.sleep(100)
          extractedInfoList = require('../savedData/klines/klines')
        }

        let newExtractedInfoList = cutExtractedInfoList(extractedInfoList, extractedInfoList[0].timeLine.length - lineLength, lineLength)

        /**
        * Determine memory leak
        * */
        try {
          global.gc();
        } catch (e) {
          console.log("You must run program with 'node --expose-gc index.js' or 'npm start'");
          process.exit();
        }
        var heapUsed = process.memoryUsage().heapUsed;
        console.log("Program is using " + heapUsed + " bytes of Heap.")

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

        /**
         * 只看topVibrated的那几个
         * */
//        let whiteList = getTopVibrated(extractedInfoList, topVibratedNo)
        let whiteList = getTopVibrated(newExtractedInfoList, topVibratedNo, 30)
        console.log('topVibrated', whiteList)

        let timeEpoch = newExtractedInfoList[0].timeLine[lineLength-1]
        let currentTime = moment(timeEpoch).format('MMMM Do YYYY, h:mm:ss a')
        log(`${currentTime}: ->`.green)

        log(`---------- Using Kline Strategy ---------- `.green)
        let klineResult = await useKlineStrategy({newExtractedInfoList, lastPickedTrade, money, currentTime, PRODUCTION, exchange, whiteList})

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
    const extractedInfoList = require('../savedData/klines/klines')
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
