'use strict'
const KlineTable = require('./config').KlineTable
let AWS = require('./config').AWS
let docClient = new AWS.DynamoDB.DocumentClient()
const _ = require('lodash')
const {windows, intervalInMillesec} = require('../config')

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
  let ohlcvMAList = []
  klineListOfSymbols.forEach((klineList, i)=>{
    let symbol = symbols[i]
    if (klineList.length < numberOfPoints - 1){
//      console.log(`symbol ${symbol} doesn't have that much history data, skipping it`)
    } else {
      let ohlcvMA = extractOHLCVInfo(klineList, symbol)

      ohlcvMAList.push(ohlcvMA)
    }
  })
  return ohlcvMAList
}

function formatKlines (klines) {
  if (klines.length === 0) return {}

  let ohlcv = {}
  ohlcv.symbol = klines[0].symbol
  ohlcv.exchange = klines[0].exchange
  ohlcv.data = klines.map(kline => {
    return {
      open: kline.open,
      high: kline.high,
      low: kline.low,
      close: kline.close,
      volume: kline.volume,
      timeStamp: kline.timeStamp
    }
  })
  return ohlcv
}

async function klineListGetDuringPeriod (exchangeId, symbols, numberOfPoints, endTo) {
  try {
    if (typeof endTo !== 'number') endTo = new Date().getTime()
    /**
     * 保证endTo不会正好等于要获取点的timeStamp，避免多获取一个点
     * */
    if (endTo % intervalInMillesec === 0) endTo += 1
    let startFrom = endTo - numberOfPoints * intervalInMillesec // 每个点5分钟
    /**
     * 整5分钟时，有时数据库还没有获得最新的点，为避免获得的点数不足，因此多fetch一个点，如果多了后面再截掉
     * */
    startFrom -= intervalInMillesec

    let promises = symbols.map(symbol => {
      return klineGetDuringPeriod(exchangeId, symbol, startFrom, endTo)
      .then(klines => {
        return formatKlines(klines)
      })
    })

    let ohlcvList = await Promise.all(promises)
    /**
     * 去掉长度不够的币
     */
    ohlcvList = _.filter(ohlcvList, ohlcv => ohlcv.data.length >= numberOfPoints)

    /**
     * 如果多获取了一个点，则截掉
     * */
    if (ohlcvList[0].data.length > numberOfPoints) {
      ohlcvList.forEach(symbolKlines => { symbolKlines.data = symbolKlines.data.slice(-numberOfPoints) })
    }

    // let ohlcvMAList = formatKlineList(ohlcvList, symbols, numberOfPoints)
    return ohlcvList
  } catch (error) {
    console.log(error)
    return []
  }
}

module.exports = klineListGetDuringPeriod
