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
function addPaddingExtractedInfoList (ohlcvMAList, paddingLength=1) {
  let paddingList = []
  for (let i=0; i<paddingLength; i++) {
    paddingList.push(0)
  }

  let newExtractedInfoList = ohlcvMAList.map(ohlcvMA => {
    /** newKlines - length==lineLength */
    let newKlines = {}
    Object.keys(ohlcvMA.klines).forEach(key => {
      newKlines[key] = [...paddingList, ...ohlcvMA.klines[key]]
    })
    /** newVolumes */
    let newVolumes = [...paddingList, ...ohlcvMA.volumeLine]
    /** newPrices */
    let newCloseLine = [...paddingList, ...ohlcvMA.closeLine]
    let newOpenLine = [...paddingList, ...ohlcvMA.openLine]
    let newHighLine = [...paddingList, ...ohlcvMA.highLine]
    let newLowLine = [...paddingList, ...ohlcvMA.lowLine]
    /** newTimes */
    let newTimes = [...paddingList, ...ohlcvMA.timeLine]

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

function addVibrateValue(ohlcvMAList, observeLength) {
  for ( let ohlcvMA of ohlcvMAList ) {
    let meanClose = _.mean(ohlcvMA.closeLine)
    let totalSquareError = 0
    let infoLength = ohlcvMA.closeLine.length
    let vibrateValue = 0
//    for (let i=Math.max(infoLength - observeLength + 1, 0); i<infoLength; i++) {
    for (let i=infoLength - observeLength + 1; i<infoLength; i++) {
      /**
       * 只看增长部分
       * */
//      let increaseValue = (ohlcvMA.closeLine[i] - ohlcvMA.closeLine[i-1]) / ohlcvMA.closeLine[i-1]
//      if (increaseValue > 0) {
//        vibrateValue += increaseValue
//      }
      /**
       * 均方差
       * */
//      console.log('meanClose', meanClose)
//      if (ohlcvMA.closeLine[i] === undefined) {
//        console.log('i', i)
//      }
      totalSquareError = totalSquareError + Math.pow((ohlcvMA.closeLine[i] - meanClose)/meanClose, 2)
    }
    ohlcvMA.vibrateValue = vibrateValue
    ohlcvMA.meanSquareError = totalSquareError/observeLength
//    console.log('ohlcvMA.meanSquareError', ohlcvMA.meanSquareError)
  }
  return ohlcvMAList
}

function addWeightValue(ohlcvMAList, observeLength) {
  for ( let ohlcvMA of ohlcvMAList ) {
    let profitLine = timeWalkCalcProfit([ohlcvMA])

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
    ohlcvMA.weightValue = weight
  }
  return ohlcvMAList
}

/**
 * 获得最高势能（稳增+阶跃）的几个币
 * */
function getTopWeighted(ohlcvMAList, topWeightNo, observeWindow = 7*24*60/5){
  ohlcvMAList = addWeightValue(ohlcvMAList, observeWindow)

  let sortedExtractedInfoList = _.sortBy(ohlcvMAList, obj => -obj.weightValue)
  return sortedExtractedInfoList.slice(0, topWeightNo)
}

/**
 * Get top vibrated
 * */
function getTopVibrated(ohlcvMAList, topVibratedNo, observeWindow = 50){
  ohlcvMAList = addVibrateValue(ohlcvMAList, observeWindow)

//  console.log('ohlcvMAList', ohlcvMAList.map(o => `${o.symbol} ${o.meanSquareError}`))

  let sortedExtractedInfoList = _.sortBy(ohlcvMAList, obj => obj.meanSquareError)

//  console.log('sortedExtractedInfoList', sortedExtractedInfoList.map(o => `${o.symbol} ${o.meanSquareError}`))

  return sortedExtractedInfoList.slice(0, topVibratedNo)
}

function addBTCVolValue(ohlcvMAList, observeWindow) {
  for ( let ohlcvMA of ohlcvMAList ) {
    let infoLength = ohlcvMA.closeLine.length
    let totalVolume = 0
    for (let i=infoLength - observeWindow; i<infoLength; i++) {
      /**
       * 对应的BTCVolume = volume * price
       * */
      let BTCVolume = ohlcvMA.closeLine[i] * ohlcvMA.volumeLine[i]
      totalVolume += BTCVolume
    }
    ohlcvMA.BTCVolume = totalVolume
  }
  return ohlcvMAList
}

/**
 * Get Top Volume
 * */
function getTopVolume(ohlcvMAList, topVolumeNo=undefined, observeWindow = 50, volumeThreshold=undefined){
  addBTCVolValue(ohlcvMAList, observeWindow)
  let sortedExtractedInfoList = _.sortBy(ohlcvMAList, obj => -obj.BTCVolume)
  if (volumeThreshold) {
    sortedExtractedInfoList = _.filter(sortedExtractedInfoList, obj => (obj.BTCVolume > volumeThreshold))
  }
  return sortedExtractedInfoList.slice(0, topVolumeNo)
}

function generateCutProfitList(ohlcvMA, observeWindow, dynamicProfitList) {
  let totalChange = 0
  let highLine = ohlcvMA.highLine.slice(-observeWindow)
  let lowLine = ohlcvMA.lowLine.slice(-observeWindow)
  let openLine = ohlcvMA.openLine.slice(-observeWindow)
  let closeLine = ohlcvMA.closeLine.slice(-observeWindow)
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

async function fetchNewPointAndAttach(ohlcvMAList, exchangeId, windows) {
  /**
   * fetch 两个新点，并更新ohlcvMAList
   * */
  let symbols = ohlcvMAList.map(o => o.symbol)
  let newPointsList = await klineListGetDuringPeriod(exchangeId, symbols, 2)
  let sliceEnd = ohlcvMAList[0].timeLine.length - 2

  let updatedInfoList = ohlcvMAList.map(ohlcvMA => {
    //更新2点，保证前面点的close值为exchange最终值
    let newPoints = _.find(newPointsList, {symbol: ohlcvMA.symbol})

    /**
     * 当ohlcvMA的最后一个点未更新完毕，则保留点 0 - length-3，最后两点更新
     * 当ohlcvMA的最后一个点更新完毕时，则保留点 1 - length-2
     * 利用shift完成
     * */
    let shift = ohlcvMA.timeLine.slice(-1)[0] !== newPoints.timeLine.slice(-1)[0] ? 1 : 0
//    console.log('ohlcvMA.closeLine.slice(-5)', ohlcvMA.closeLine.slice(-5))
//    console.log('ohlcvMA.closeLine.slice(shift, sliceEnd + shift).slice(-3))', ohlcvMA.closeLine.slice(shift, sliceEnd + shift).slice(-3))
//    console.log('newPoints.closeLine.slice(-2)', newPoints.closeLine.slice(-2))
//    process.exit()
    let updatedInfo = {
      ...ohlcvMA,
      volumeLine: [...(ohlcvMA.volumeLine.slice(shift, sliceEnd + shift)), ...newPoints.volumeLine.slice(-2)],
      closeLine: [...(ohlcvMA.closeLine.slice(shift, sliceEnd + shift)), ...newPoints.closeLine.slice(-2)],
      openLine: [...(ohlcvMA.openLine.slice(shift, sliceEnd + shift)), ...newPoints.openLine.slice(-2)],
      highLine: [...(ohlcvMA.highLine.slice(shift, sliceEnd + shift)), ...newPoints.highLine.slice(-2)],
      lowLine: [...(ohlcvMA.lowLine.slice(shift, sliceEnd + shift)), ...newPoints.lowLine.slice(-2)],
      timeLine: [...(ohlcvMA.timeLine.slice(shift, sliceEnd + shift)), ...newPoints.timeLine.slice(-2)],
    }

    let newKlines = {}
    for (let window of windows) {
      let endIdx = updatedInfo.closeLine.length
      let startIdx = updatedInfo.closeLine.length - window
      let secondToLastPoint = _.mean(updatedInfo.closeLine.slice(startIdx-1, endIdx-1))
      let lastPoint = _.mean(updatedInfo.closeLine.slice(startIdx, endIdx))
      newKlines[window] = [...ohlcvMA.klines[window].slice(shift, sliceEnd + shift), secondToLastPoint, lastPoint]
    }

    updatedInfo.klines = newKlines
    return updatedInfo
  })

  return updatedInfoList
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
}
