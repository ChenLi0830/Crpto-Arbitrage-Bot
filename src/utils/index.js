const ccxt = require('ccxt')
const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const json2csv = require('json2csv')
const fs = require('fs')
const promiseRetry = require('promise-retry')
const _ = require('lodash')

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
 * 用来调用exchange的方法, 当timeout时，自动retry
 * */
async function retryExTaskIfTimeout (exchange, func, args=[]) {
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
    let infoLength = extractedInfo.closeLine.length
    let weight = 0
    let momentum = 0
    //    for (let i=Math.max(infoLength - observeLength + 1, 0); i<infoLength; i++) {
    for (let i=infoLength - observeLength + 1; i<infoLength; i++) {
      let priceDifPercent = (extractedInfo.closeLine[i] - extractedInfo.closeLine[i-1])/extractedInfo.closeLine[i-1]
//      console.log('priceDifPercent', priceDifPercent)
      let isIncreasing = priceDifPercent > 0
//      console.log('isIncreasing', isIncreasing)
      let diffAbs = Math.abs(priceDifPercent)
//      console.log('diffAbs', diffAbs)

      momentum = momentum + (isIncreasing ? 1 : -1)
//      console.log('momentum', momentum)

      /**
       * 当持续增加
       * */
      if (momentum > 0 && isIncreasing) {
        weight = weight + momentum * diffAbs // 增加weight
      }
      /**
       * 当持续减少
       * */
      else if (momentum < 0 && !isIncreasing) {
        weight = weight + momentum * diffAbs // 减少weight
      }
      /**
       * 当与势能momentum相反
       * */
      else {
        weight = weight + diffAbs * (isIncreasing ? 1 : -1) // 不记入势能
      }
    }
    extractedInfo.weightValue = weight
  }
  return extractedInfoList
}

/**
 * 获得最高势能（稳增+阶跃）的几个币
 * */
function getTopWeighted(extractedInfoList, topWeightNo, observeWindow = 7*24*60/5){
  console.log('observeWindow', observeWindow)
  extractedInfoList = addWeightValue(extractedInfoList, observeWindow)

  let sortedExtractedInfoList = _.sortBy(extractedInfoList, obj => -obj.weightValue)
  console.log('sortedExtractedInfoList', sortedExtractedInfoList.map(o => `${o.symbol} ${o.weightValue}`))

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
    for (let i=infoLength - observeWindow + 1; i<infoLength; i++) {
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
function getTopVolume(extractedInfoList, topVolumeNo, observeWindow = 50){
  addBTCVolValue(extractedInfoList, observeWindow)
  let sortedExtractedInfoList = _.sortBy(extractedInfoList, obj => -obj.BTCVolume)
  return sortedExtractedInfoList.slice(0, topVolumeNo)
}

module.exports = {
  getMarkets,
  saveJsonToCSV,
  simulate,
  resetConsole,
  retryExTaskIfTimeout,
  cutExtractedInfoList,
  getTopVibrated,
  getTopVolume,
  addVibrateValue,
  addBTCVolValue,
  getTopWeighted,
}
