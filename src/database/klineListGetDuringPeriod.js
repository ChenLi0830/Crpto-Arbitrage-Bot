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
    let result = []

    const onQuery = (err, data) => {
      if (err) {
        console.error('Unable to get the klines. Error JSON:', JSON.stringify(err), err.stack)
        return reject(err)
      }

      result = result.concat(data.Items)

      // If there is more to query, then query again
      if (typeof data.LastEvaluatedKey !== 'undefined') {
        console.log('Querying for more...')
        params.ExclusiveStartKey = data.LastEvaluatedKey
        docClient.query(params, onQuery)
      } else {
        resolve(result)
      }
    }

    docClient.query(params, onQuery)
  })
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
     * Update numberOfPoints in case exchange lost part of the data
     */
    let bcdOhlcv = _.find(ohlcvList, ohlcv => ohlcv.symbol === 'BCD/BTC')
    let adxOhlcv = _.find(ohlcvList, ohlcv => ohlcv.symbol === 'ADX/BTC')
    if (ohlcvList.length > 1 && bcdOhlcv.data.length === adxOhlcv.data.length && bcdOhlcv.data.length < numberOfPoints) {
      numberOfPoints = bcdOhlcv.data.length
    }
    else if (ohlcvList.length === 1) {
      numberOfPoints = ohlcvList[0].data.length
    }
    /**
     * 去掉长度不够的币
     */
    ohlcvList = _.filter(ohlcvList, ohlcv => ohlcv.data && ohlcv.data.length >= numberOfPoints)
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
