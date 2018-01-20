const ccxt = require('ccxt')
const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const json2csv = require('json2csv')
const fs = require('fs')
const promiseRetry = require('promise-retry')
const _ = require('lodash')
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
    }
    else {
      fs.writeFileSync(`./savedData/${fileName}.csv`, csv)
    }

  }
  catch (err) {
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
async function retryMutationTaskIfTimeout (exchange, func, args=[]) {
  return await promiseRetry(async (retry, number) => {
    try {
      return await exchange[func](...args)
    }
    catch (err) {
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
async function retryQueryTaskIfAnyError (exchange, func, args=[]) {
  return await promiseRetry(async (retry, number) => {
    try {
      return await exchange[func](...args)
    }
    catch (err) {
      console.log(err)
      log.bright.yellow(`retry task - ${number} time`)
      retry(err)
    }
  })
}

/**
 * 为ExtractedInfoList 从开始处添加padding
 * */
function addPaddingExtractedInfoList (extractedInfoList, paddingLength=1) {
  let paddingList = []
  for (let i=0; i<paddingLength; i++) {
    paddingList.push(0)
  }

  let newExtractedInfoList = extractedInfoList.map(extractedInfo => {
    /** newKlines - length==lineLength */
    let newKlines = {}
    Object.keys(extractedInfo.klines).forEach(key => {
      newKlines[key] = [...paddingList, ...extractedInfo.klines[key]]
    })
    /** newVolumes */
    let newVolumes = [...paddingList, ...extractedInfo.volumeLine]
    /** newPrices */
    let newCloseLine = [...paddingList, ...extractedInfo.closeLine]
    let newOpenLine = [...paddingList, ...extractedInfo.openLine]
    let newHighLine = [...paddingList, ...extractedInfo.highLine]
    let newLowLine = [...paddingList, ...extractedInfo.lowLine]
    /** newTimes */
    let newTimes = [...paddingList, ...extractedInfo.timeLine]

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


/**
 * 从ExtractedInfoList里截取出对应长度的
 * */
function cutExtractedInfoList (extractedInfoList, start, lineLength) {
  let newExtractedInfoList = extractedInfoList.map(extractedInfo => {
    /** newKlines - length==lineLength */
    let newKlines = {}
    Object.keys(extractedInfo.klines).forEach(key => {
      newKlines[key] = extractedInfo.klines[key].slice(start, start + lineLength)
    })
    /** newVolumes */
    let newVolumes = extractedInfo.volumeLine.slice(start, start + lineLength)
    /** newPrices */
    let newCloseLine = extractedInfo.closeLine.slice(start, start + lineLength)
    let newOpenLine = extractedInfo.openLine.slice(start, start + lineLength)
    let newHighLine = extractedInfo.highLine.slice(start, start + lineLength)
    let newLowLine = extractedInfo.lowLine.slice(start, start + lineLength)
    /** newTimes */
    let newTimes = extractedInfo.timeLine.slice(start, start + lineLength)

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

function addVibrateValue(extractedInfoList, observeLength) {
  for ( let extractedInfo of extractedInfoList ) {
    let meanClose = _.mean(extractedInfo.closeLine)
    let totalSquareError = 0
    let infoLength = extractedInfo.closeLine.length
    let vibrateValue = 0
//    for (let i=Math.max(infoLength - observeLength + 1, 0); i<infoLength; i++) {
    for (let i=infoLength - observeLength + 1; i<infoLength; i++) {
      /**
       * 只看增长部分
       * */
//      let increaseValue = (extractedInfo.closeLine[i] - extractedInfo.closeLine[i-1]) / extractedInfo.closeLine[i-1]
//      if (increaseValue > 0) {
//        vibrateValue += increaseValue
//      }
      /**
       * 均方差
       * */
//      console.log('meanClose', meanClose)
//      if (extractedInfo.closeLine[i] === undefined) {
//        console.log('i', i)
//      }
      totalSquareError = totalSquareError + Math.pow((extractedInfo.closeLine[i] - meanClose)/meanClose, 2)
    }
    extractedInfo.vibrateValue = vibrateValue
    extractedInfo.meanSquareError = totalSquareError/observeLength
//    console.log('extractedInfo.meanSquareError', extractedInfo.meanSquareError)
  }
  return extractedInfoList
}

function addWeightValue(extractedInfoList, observeLength) {
  for ( let extractedInfo of extractedInfoList ) {
    let profitLine = timeWalkCalcProfit([extractedInfo])

    let weight = 0
    let momentum = 0
    //    for (let i=Math.max(infoLength - observeLength + 1, 0); i<infoLength; i++) {
    for (let i=Math.max(profitLine.length - observeLength + 1, 0) ; i<profitLine.length; i++) {
      let priceDifPercent = (profitLine[i] - profitLine[i-1])/profitLine[i-1]
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

      if (isNaN(weight)){
        console.log('Math.sqrt(momentum)', Math.sqrt(momentum))
        console.log('diffAbs', diffAbs)
        console.log('momentum', momentum)
        process.exit()
      }
    }
    extractedInfo.weightValue = weight
  }
  return extractedInfoList
}

/**
 * 获得最高势能（稳增+阶跃）的几个币
 * */
function getTopWeighted(extractedInfoList, topWeightNo, observeWindow){
  extractedInfoList = addWeightValue(extractedInfoList, observeWindow)

  let sortedExtractedInfoList = _.sortBy(extractedInfoList, obj => -obj.weightValue)
  return sortedExtractedInfoList.slice(0, topWeightNo)
}

/**
 * Get top vibrated
 * */
function getTopVibrated(extractedInfoList, topVibratedNo, observeWindow = 50){
  extractedInfoList = addVibrateValue(extractedInfoList, observeWindow)

//  console.log('extractedInfoList', extractedInfoList.map(o => `${o.symbol} ${o.meanSquareError}`))

  let sortedExtractedInfoList = _.sortBy(extractedInfoList, obj => obj.meanSquareError)

//  console.log('sortedExtractedInfoList', sortedExtractedInfoList.map(o => `${o.symbol} ${o.meanSquareError}`))

  return sortedExtractedInfoList.slice(0, topVibratedNo)
}

function addBTCVolValue(extractedInfoList, observeWindow) {
  for ( let extractedInfo of extractedInfoList ) {
    let infoLength = extractedInfo.closeLine.length
    let totalVolume = 0
    for (let i=infoLength - observeWindow; i<infoLength; i++) {
      /**
       * 对应的BTCVolume = volume * price
       * */
      let BTCVolume = extractedInfo.closeLine[i] * extractedInfo.volumeLine[i]
      totalVolume += BTCVolume
    }
    extractedInfo.BTCVolume = totalVolume
  }
  return extractedInfoList
}

/**
 * Get Top Volume
 * */
function getTopVolume(extractedInfoList, topVolumeNo=undefined, observeWindow = 50, volumeThreshold=undefined){
  addBTCVolValue(extractedInfoList, observeWindow)
  let sortedExtractedInfoList = _.sortBy(extractedInfoList, obj => -obj.BTCVolume)
  if (volumeThreshold) {
    sortedExtractedInfoList = _.filter(sortedExtractedInfoList, obj => (obj.BTCVolume > volumeThreshold))
  }
  return sortedExtractedInfoList.slice(0, topVolumeNo)
}

function generateCutProfitList(extractedInfo, observeWindow, dynamicProfitList) {
  let totalChange = 0
  let highLine = extractedInfo.highLine.slice(-observeWindow)
  let lowLine = extractedInfo.lowLine.slice(-observeWindow)
  let openLine = extractedInfo.openLine.slice(-observeWindow)
  let closeLine = extractedInfo.closeLine.slice(-observeWindow)
  let accumulatedProfit = 0

  for (let i=0; i<openLine.length; i++) {
    totalChange += (100 * (highLine[i] - lowLine[i])/openLine[i])
    accumulatedProfit += (100 * (closeLine[i] - openLine[i])/openLine[i])
  }
  let avgChange = totalChange / observeWindow

  return dynamicProfitList.map(dynamicProfit=>({
    value: avgChange * dynamicProfit.multiplier,
    percent: dynamicProfit.percent,
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

function printLine(lineData){
  const chart = asciichart.plot(lineData, {height: 15})
  log.yellow('\n' + chart, '\n')
}

async function fetchNewPointAndAttach(extractedInfoList, exchangeId, windows) {
  let symbols = extractedInfoList.map(o => o.symbol)
  let newPoints = await klineListGetDuringPeriod(exchangeId, symbols, 1)
  let sliceEndIdx = extractedInfoList[0].timeLine.length - 1

  let updatedInfoList = extractedInfoList.map(extractedInfo => {
    let newPoint = _.find(newPoints, {symbol: extractedInfo.symbol})
    let updatedInfo = {
      ...extractedInfo,
      volumeLine: [...(extractedInfo.volumeLine.slice(0,sliceEndIdx)), newPoint.volumeLine.slice(-1)[0]],
      closeLine: [...(extractedInfo.closeLine.slice(0,sliceEndIdx)), newPoint.closeLine.slice(-1)[0]],
      openLine: [...(extractedInfo.openLine.slice(0,sliceEndIdx)), newPoint.openLine.slice(-1)[0]],
      highLine: [...(extractedInfo.highLine.slice(0,sliceEndIdx)), newPoint.highLine.slice(-1)[0]],
      lowLine: [...(extractedInfo.lowLine.slice(0,sliceEndIdx)), newPoint.lowLine.slice(-1)[0]],
      timeLine: [...(extractedInfo.timeLine.slice(0,sliceEndIdx)), newPoint.timeLine.slice(-1)[0]],
    }

    let newKlines = {}
    for (let window of windows) {
      let endIdx = updatedInfo.closeLine.length
      let startIdx = updatedInfo.closeLine.length - window
      let lastPoint = _.mean(updatedInfo.closeLine.slice(startIdx, endIdx))
      newKlines[window] = [...extractedInfo.klines[window].slice(0, sliceEndIdx), lastPoint]
    }

//    if (extractedInfo.symbol==='ETH/BTC') {
//      console.log('extractedInfo.timeLine.slice(-2)', extractedInfo.timeLine.slice(-2))
//      console.log('updatedInfo.timeLine.slice(-2)', updatedInfo.timeLine.slice(-2))
//      console.log('extractedInfo.closeLine.slice(-2)', extractedInfo.closeLine.slice(-2))
//      console.log('updatedInfo.closeLine.slice(-2)', updatedInfo.closeLine.slice(-2))
//      console.log('newKlines[4].slice(-2)', newKlines[4].slice(-2))
//      console.log('updatedInfo.klines[4].slice(-2)', updatedInfo.klines[4].slice(-2))
//    }

    updatedInfo.klines = newKlines
    return updatedInfo
  })

  return updatedInfoList
}

function getMovingAverage(extractedInfo, windows){
  let klines = {}
  for (let window of windows) {
    let endIdx = extractedInfo.timeLine.length - 1
    let startIdx = extractedInfo.timeLine.length - window
    let result = []

    for (let shift=0; shift<extractedInfo.timeLine.length - Math.max(...windows); shift++) {
      let value = 0
      for (let i=startIdx-shift; i<=endIdx-shift; i++) {
        value += (extractedInfo.closeLine[i] / window)
      }
      result.unshift(value)
    }

    klines[window] = result
  }

  return klines
}

function addMAToExtractedInfoList(extractedInfoList, windows) {
  let newExtractedInfoList = extractedInfoList.map(extractedInfo => {
    let klines = getMovingAverage(extractedInfo, windows)
    let MAlength = klines[windows[0]].length

    return {
      ...extractedInfo,
      klines,
      volumeLine: extractedInfo.volumeLine.slice(-MAlength),
      closeLine: extractedInfo.closeLine.slice(-MAlength),
      openLine: extractedInfo.openLine.slice(-MAlength),
      highLine: extractedInfo.highLine.slice(-MAlength),
      lowLine: extractedInfo.lowLine.slice(-MAlength),
      timeLine: extractedInfo.timeLine.slice(-MAlength),
    }
  })

  return newExtractedInfoList
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
  addMAToExtractedInfoList,
}
