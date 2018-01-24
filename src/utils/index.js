const ccxt = require('ccxt')
const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const json2csv = require('json2csv')
const fs = require('fs')
const promiseRetry = require('promise-retry')
const _ = require('lodash')
const {windows} = require('../config')
const {timeWalkCalcProfit} = require('../pickCoinMomentum')
const klineListGetDuringPeriod = require('../database/klineListGetDuringPeriod')

function resetConsole () {
  const readline = require('readline')
  const blank = '\n'.repeat(process.stdout.rows)
  console.log(blank)
  readline.cursorTo(process.stdout, 0, 0)
  readline.clearScreenDown(process.stdout)
}

async function checkTimeDiff (exchange) {
  let exchangeTime = (await exchange.publicGetTime())['serverTime']
  log(exchangeTime)
  let yourTime = exchange.milliseconds()
  log(yourTime)

  //  if (your_time !== exchange_time)
  log('Exchange UTC time:', exchangeTime, exchange.iso8601(exchangeTime))
  log('Your UTC time:', yourTime, exchange.iso8601(yourTime))
}

const getMarkets = async (exchangeId) => {
  const exchange = await new ccxt[exchangeId]()
  await exchange.loadMarkets()
  log(Object.keys(exchange.markets).join(' ').green)
}

const saveJsonToCSV = (json, fields = ['field1', 'field2'], fileName) => {
  try {
    let csv = json2csv({data: json, fields: fields})
    //    console.log(csv);
    if (fileName.indexOf('savedData') > -1) {
      fs.writeFileSync(fileName, csv)
    } else {
      fs.writeFileSync(`./savedData/${fileName}.csv`, csv)
    }
  } catch (err) {
    // Errors are thrown for bad options, or if the data is empty and no fields are provided.
    // Be sure to provide fields if it is possible that your data array will be empty.
    console.error(err)
  }
}

async function simulate (result, delay) {
  return new Promise(resolve => setTimeout(() => resolve(result), delay))
}

/**
 * 用来调用exchange的写入类方法, 比如买币，卖币等等，当timeout时，自动retry
 * */
async function retryMutationTaskIfTimeout (exchange, func, args = []) {
  return await promiseRetry(async (retry, number) => {
    try {
      return await exchange[func](...args)
    } catch (err) {
      if (err instanceof ccxt.RequestTimeout) {
        log.bright.yellow(`[Request Timeout], retry task - ${number} time`)
        retry(err)
      }
      throw err
    }
  })
}

/**
 * 用来调用exchange的读取类方法, 比如获取余额等等，当有任何错误时，自动retry
 * */
async function retryQueryTaskIfAnyError (exchange, func, args = []) {
  return await promiseRetry(async (retry, number) => {
    try {
      return await exchange[func](...args)
    } catch (err) {
      console.log(err)
      log.bright.yellow(`retry task - ${number} time`)
      retry(err)
    }
  })
}

/**
 * 为ExtractedInfoList 从开始处添加padding
 * */
function addPaddingExtractedInfoList (ohlcvMAsList, paddingLength = 1) {
  let paddingList = []
  for (let i = 0; i < paddingLength; i++) {
    paddingList.push(0)
  }

  let newExtractedInfoList = ohlcvMAsList.map(ohlcvMAs => {
    /** newKlines - length==lineLength */
    let newKlines = {}
    Object.keys(ohlcvMAs.klines).forEach(key => {
      newKlines[key] = [...paddingList, ...ohlcvMAs.klines[key]]
    })
    /** newVolumes */
    let newVolumes = [...paddingList, ...ohlcvMAs.volumeLine]
    /** newPrices */
    let newCloseLine = [...paddingList, ...ohlcvMAs.closeLine]
    let newOpenLine = [...paddingList, ...ohlcvMAs.openLine]
    let newHighLine = [...paddingList, ...ohlcvMAs.highLine]
    let newLowLine = [...paddingList, ...ohlcvMAs.lowLine]
    /** newTimes */
    let newTimes = [...paddingList, ...ohlcvMAs.timeLine]

    return {
      ...ohlcvMAs,
      klines: newKlines,
      volumeLine: newVolumes,
      closeLine: newCloseLine,
      openLine: newOpenLine,
      highLine: newHighLine,
      lowLine: newLowLine,
      timeLine: newTimes
    }
  })
  return newExtractedInfoList
}

/**
 * 从ExtractedInfoList里截取出对应长度的
 * */
function cutExtractedInfoList (ohlcvMAsList, start, lineLength) {
  let newExtractedInfoList = ohlcvMAsList.map(ohlcvMAs => {
    /** newKlines - length==lineLength */
    let newKlines = {}
    Object.keys(ohlcvMAs.klines).forEach(key => {
      newKlines[key] = ohlcvMAs.klines[key].slice(start, start + lineLength)
    })
    /** newVolumes */
    let newVolumes = ohlcvMAs.volumeLine.slice(start, start + lineLength)
    /** newPrices */
    let newCloseLine = ohlcvMAs.closeLine.slice(start, start + lineLength)
    let newOpenLine = ohlcvMAs.openLine.slice(start, start + lineLength)
    let newHighLine = ohlcvMAs.highLine.slice(start, start + lineLength)
    let newLowLine = ohlcvMAs.lowLine.slice(start, start + lineLength)
    /** newTimes */
    let newTimes = ohlcvMAs.timeLine.slice(start, start + lineLength)

    return {
      ...ohlcvMAs,
      klines: newKlines,
      volumeLine: newVolumes,
      closeLine: newCloseLine,
      openLine: newOpenLine,
      highLine: newHighLine,
      lowLine: newLowLine,
      timeLine: newTimes
    }
  })
  return newExtractedInfoList
}

function addVibrateValue (ohlcvMAsList, observeLength) {
  for (let ohlcvMAs of ohlcvMAsList) {
    let meanClose = _.mean(ohlcvMAs.closeLine)
    let totalSquareError = 0
    let infoLength = ohlcvMAs.closeLine.length
    let vibrateValue = 0
//    for (let i=Math.max(infoLength - observeLength + 1, 0); i<infoLength; i++) {
    for (let i = infoLength - observeLength + 1; i < infoLength; i++) {
      /**
       * 只看增长部分
       * */
//      let increaseValue = (ohlcvMAs.closeLine[i] - ohlcvMAs.closeLine[i-1]) / ohlcvMAs.closeLine[i-1]
//      if (increaseValue > 0) {
//        vibrateValue += increaseValue
//      }
      /**
       * 均方差
       * */
//      console.log('meanClose', meanClose)
//      if (ohlcvMAs.closeLine[i] === undefined) {
//        console.log('i', i)
//      }
      totalSquareError = totalSquareError + Math.pow((ohlcvMAs.closeLine[i] - meanClose) / meanClose, 2)
    }
    ohlcvMAs.vibrateValue = vibrateValue
    ohlcvMAs.meanSquareError = totalSquareError / observeLength
//    console.log('ohlcvMAs.meanSquareError', ohlcvMAs.meanSquareError)
  }
  return ohlcvMAsList
}

function addWeightValue (ohlcvMAsList, observeLength) {
  for (let ohlcvMAs of ohlcvMAsList) {
    let profitLine = timeWalkCalcProfit([ohlcvMAs])

    let weight = 0
    let momentum = 0
    //    for (let i=Math.max(infoLength - observeLength + 1, 0); i<infoLength; i++) {
    for (let i = Math.max(profitLine.length - observeLength + 1, 0); i < profitLine.length; i++) {
      let priceDifPercent = (profitLine[i] - profitLine[i - 1]) / profitLine[i - 1]
      if (isNaN(priceDifPercent)) { // 当priceDif为0时，处理特殊情况
        priceDifPercent = 0
      }
      let isIncreasing = priceDifPercent > 0
      let diffAbs = Math.abs(priceDifPercent)

      momentum = momentum + (isIncreasing ? 1 : -1)
//      console.log('momentum', momentum)

      /**
       * 当持续增加
       * */
      if (momentum > 0 && isIncreasing) {
        weight = weight + Math.sqrt(momentum) * diffAbs // 增加weight
//        weight = weight + momentum * diffAbs // 增加weight
      }
      /**
       * 当持续减少
       * */
      else if (momentum < 0 && !isIncreasing) {
        weight = weight - Math.sqrt(-momentum) * diffAbs // 减少weight
//        weight = weight + momentum * diffAbs // 增加weight
      }
      /**
       * 当与势能momentum相反
       * */
      else {
        let prevWeight = weight
        weight = weight + diffAbs * (isIncreasing ? 1 : -1) // 不记入势能
        if (prevWeight * weight < 0) { // 新的点把势能反转
          momentum = 0
        }
      }

      if (isNaN(weight)) {
        console.log('Math.sqrt(momentum)', Math.sqrt(momentum))
        console.log('diffAbs', diffAbs)
        console.log('momentum', momentum)
        process.exit()
      }
    }
    ohlcvMAs.weightValue = weight
  }
  return ohlcvMAsList
}

/**
 * 获得最高势能（稳增+阶跃）的几个币
 * */
function getTopWeighted (ohlcvMAsList, topWeightNo, observeWindow = 7 * 24 * 60 / 5) {
  ohlcvMAsList = addWeightValue(ohlcvMAsList, observeWindow)

  let sortedExtractedInfoList = _.sortBy(ohlcvMAsList, obj => -obj.weightValue)
  return sortedExtractedInfoList.slice(0, topWeightNo)
}

/**
 * Get top vibrated
 * */
function getTopVibrated (ohlcvMAsList, topVibratedNo, observeWindow = 50) {
  ohlcvMAsList = addVibrateValue(ohlcvMAsList, observeWindow)

//  console.log('ohlcvMAsList', ohlcvMAsList.map(o => `${o.symbol} ${o.meanSquareError}`))

  let sortedExtractedInfoList = _.sortBy(ohlcvMAsList, obj => obj.meanSquareError)

//  console.log('sortedExtractedInfoList', sortedExtractedInfoList.map(o => `${o.symbol} ${o.meanSquareError}`))

  return sortedExtractedInfoList.slice(0, topVibratedNo)
}

function addBTCVolValue (ohlcvMAsList, observeWindow) {
  for (let ohlcvMAs of ohlcvMAsList) {
    // console.log('ohlcvMAs', ohlcvMAs)
    let infoLength = ohlcvMAs.data.length
    let totalVolume = 0
    for (let i = infoLength - observeWindow; i < infoLength; i++) {
      /**
       * 对应的BTCVolume = volume * price
       * */
      let BTCVolume = ohlcvMAs.data[i].close * ohlcvMAs.data[i].volume
      totalVolume += BTCVolume
    }
    ohlcvMAs.BTCVolume = totalVolume
  }
  return ohlcvMAsList
}

/**
 * 显示过去时间，除了已经在exceptList里vol活跃度最高的币
 * @param {*} ohlcvMAsList
 * @param {number} observeWindow 用多少个k线点来判断最高流量
 * @param {integer} symbolNumber 显示多少个币
 * @param {number} [threshold] 超过这个threshold才会显示
 * @param {[*]} [exceptList] 如果有exceptList，则只会显示排除exceptList之外的
 */
function logSymbolsBasedOnVolPeriod (ohlcvMAsList, observeWindow, symbolNumber, threshold, exceptList) {
    /*
    * 显示除了已经在whiteList里，vol最高的前10
    * */
  let topVolumeList = getTopVolume(ohlcvMAsList, undefined, observeWindow, threshold)
  if (exceptList && exceptList.length > 0) {
    topVolumeList = _.filter(topVolumeList, o => exceptList.indexOf(o.symbol) === -1)
  }
  topVolumeList = topVolumeList.slice(0, symbolNumber)

  log(`Top volume ${observeWindow * 5} mins: `.yellow + topVolumeList.map(o => (
      `${o.symbol}: `.yellow + `${Math.round(o.BTCVolume)}`.green
    )).join(' '))
}

/**
 * Get Top Volume
 * */
function getTopVolume (ohlcvMAsList, topVolumeNo = undefined, observeWindow = 50, volumeThreshold = undefined) {
  ohlcvMAsList = addBTCVolValue(ohlcvMAsList, observeWindow)
  let sortedExtractedInfoList = _.sortBy(ohlcvMAsList, obj => -obj.BTCVolume)
  if (volumeThreshold) {
    sortedExtractedInfoList = _.filter(sortedExtractedInfoList, obj => (obj.BTCVolume > volumeThreshold))
  }
  return sortedExtractedInfoList.slice(0, topVolumeNo)
}

function generateCutProfitList (ohlcvMAs, observeWindow, dynamicProfitList) {
  let totalChange = 0
  let end = ohlcvMAs.data.length - 1
  let start = ohlcvMAs.data.length - observeWindow
  for (let i = start; i <= end; i++) {
    let {high, low, open} = ohlcvMAs.data[i]
    totalChange += (100 * (high - low) / open)
  }
  let avgChange = totalChange / observeWindow

  return dynamicProfitList.map(dynamicProfit => ({
    value: avgChange * dynamicProfit.multiplier,
    percent: dynamicProfit.percent
  }))

//    return [
//    {
//      value: 4,
//      percent: 20,
//    },
//    {
//      value: 9,
//      percent: 40,
//    },
//    {
//      value: 15,
//      percent: 5,
//    },
//  ]
}

function printLine (lineData) {
  const chart = asciichart.plot(lineData, {height: 15})
  log.yellow('\n' + chart, '\n')
}

async function fetchNewPointAndAttach (ohlcvMAsList, exchangeId, windows) {
  /**
   * fetch 两个新点，并更新ohlcvMAList
   * */
  let symbols = ohlcvMAsList.map(o => o.symbol)
  let newPointsList = await klineListGetDuringPeriod(exchangeId, symbols, 2)
  let sliceEnd = ohlcvMAsList[0].data.length - 2

  let updatedInfoList = ohlcvMAsList.map(ohlcvMAs => {
    // 更新2点，保证前面点的close值为exchange最终值
    let newPoints = _.find(newPointsList, {symbol: ohlcvMAs.symbol})

    /**
     * 当ohlcvMA的最后一个点未更新完毕，则保留点 0 - length-3，最后两点更新
     * 当ohlcvMA的最后一个点更新完毕时，则保留点 1 - length-2，最后添加两点
     * */
    let shift = ohlcvMAs.data.slice(-1)[0].timeStamp !== newPoints.data.slice(-1)[0].timeStamp ? 1 : 0
    let updatedInfo = {
      ...ohlcvMAs,
      data: [ ...ohlcvMAs.data.slice(shift, sliceEnd + shift), ...newPoints.data.slice(-2) ]
    }
    return updatedInfo
  })

  return updatedInfoList
}

/**
 * 计算MA, 并返回添加MA后的ohlcvMAList
 * @param {*} ohlcvList
 * @param {[Integer]} windows
 */
function calcMovingAverge (ohlcvList, windows) {
  ohlcvList.forEach(ohlcvs => {
    let closeList = ohlcvs.data.map(ohlcv => ohlcv.close)
    for (let i = 0; i < closeList.length; i++) {
      for (let window of windows) {
        if (i >= window - 1) {
          let MA = _.mean(closeList.slice(i - window + 1, i + 1))
          ohlcvs.data[i][`MA${window}`] = MA
        }
      }
    }
  })
  return ohlcvList
}

function checkMemory () {
  /**
   * Determine memory leak
   * */
  try {
    global.gc()
  } catch (e) {
    console.log("You must run program with 'node --expose-gc index.js' or 'npm start'");
    process.exit()
  }
  var heapUsed = process.memoryUsage().heapUsed
  console.log('Program is using ' + heapUsed + ' bytes of Heap.')
}

module.exports = {
  getMarkets,
  saveJsonToCSV,
  simulate,
  resetConsole,
  retryMutationTaskIfTimeout,
  retryQueryTaskIfAnyError,
  cutExtractedInfoList,
  getTopVibrated,
  getTopVolume,
  addVibrateValue,
  addBTCVolValue,
  getTopWeighted,
  generateCutProfitList,
  printLine,
  addPaddingExtractedInfoList,
  fetchNewPointAndAttach,
  calcMovingAverge,
  logSymbolsBasedOnVolPeriod,
  checkMemory
}
