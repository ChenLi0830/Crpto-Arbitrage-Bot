'use strict'
const KlineTable = require('./config').KlineTable
let AWS = require('./config').AWS
let docClient = new AWS.DynamoDB.DocumentClient()
const _ = require('lodash')
const api = require('../api')
const {windows} = require('../config')

async function klineGetDuringPeriod (exchangeId, symbol, startFrom, endTo) {
  const params = {
    TableName: KlineTable,
    KeyConditionExpression: 'exchangeSymbol = :exchangeSymbol and #timeStamp BETWEEN :startFrom and :endTo',
    ExpressionAttributeNames: {
      '#timeStamp': 'timeStamp'
    },
    ExpressionAttributeValues: {
      ':exchangeSymbol': `${exchangeId}-${symbol}`,
      ':startFrom': `${startFrom}`,
      ':endTo': `${endTo}`
    }
  }

  return new Promise((resolve, reject) => {
    docClient.query(params, (err, data) => {
      if (err) {
        console.error('Unable to get the feedbackEvents. Error JSON:',
          JSON.stringify(err), err.stack)
        return reject(err)
      }
      let klines = data.Items
      resolve(klines)
    })
  })
}

function getAverage(klineList, window){
  let endIdx = klineList.length - 1
  let startIdx = klineList.length - window
  let result = []

  for (let shift=0; shift<klineList.length - Math.max(...windows); shift++) {
    let value = 0
    for (let i=startIdx-shift; i<=endIdx-shift; i++) {
      value += (klineList[i].close / window)
    }
    result.unshift(value)
  }

  return result
}

function extractOHLCVInfo(klineList, symbol) {
  let klines = {} // 其实应该是avgs，这是个历史遗留问题，暂时先叫klines

  /** get klines */
  for (let window of windows) {
    klines[window] = getAverage(klineList, window)
  }

  let totalKlinelength = klines[windows[0]].length

  let timeLine = klineList.slice(-totalKlinelength).map(x => x.timeStamp)
  let openLine = klineList.slice(-totalKlinelength).map(x => x.open)
  let highLine = klineList.slice(-totalKlinelength).map(x => x.high)
  let lowLine = klineList.slice(-totalKlinelength).map(x => x.low)
  let closeLine = klineList.slice(-totalKlinelength).map(x => x.close)
  let volumeLine = klineList.slice(-totalKlinelength).map(x => x.volume)

  return {
    symbol,
    klines,
    volumeLine,
    closeLine,
    openLine,
    highLine,
    lowLine,
    timeLine,
  }

}

function formatKlineList(klineListOfSymbols, symbols, numberOfPoints) {
  let extractedInfoList = []
  klineListOfSymbols.forEach((klineList, i)=>{
    let symbol = symbols[i]
    if (klineList.length < numberOfPoints - 1){
      console.log(`symbol ${symbol} doesn't have that much history data, skipping it (klineList.length=${klineList.length} < numberOfPoints=${numberOfPoints})`)
    }
    else {
      let extractedInfo = extractOHLCVInfo(klineList, symbol)

      extractedInfoList.push(extractedInfo)
    }
  })
  return extractedInfoList
}

async function klineListGetDuringPeriod (exchangeId, symbols, numberOfPoints, endTo) {
  try {

    if (typeof endTo !== 'number') endTo = new Date().getTime()
    let startFrom = endTo - numberOfPoints * 5 * 60 * 1000 // 每个点5分钟

    let promises = symbols.map(symbol => {
      return klineGetDuringPeriod(exchangeId, symbol, startFrom, endTo)
    })

    let klineList = await Promise.all(promises)

    let extractedInfoList = formatKlineList(klineList, symbols, numberOfPoints)

    return extractedInfoList
  }
  catch (error) {
    console.log(error)
    return []
  }
}

module.exports = klineListGetDuringPeriod
