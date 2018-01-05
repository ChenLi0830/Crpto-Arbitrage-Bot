'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
require('ansicolor').nice;
const fs = require('fs')
const {saveJsonToCSV} = require('./utils')

//-----------------------------------------------------------------------------

async function fetchData (exchangeId, symbol, interval = '1m', since = undefined, recordNb = 500) {
  //  timestamp, open, high, low, close, volume
  const exchange = new ccxt[exchangeId]()
  await api.sleep(exchange.rateLimit)

  let ohlcv = await exchange.fetchOHLCV(symbol, interval, since, recordNb)

  let dataArray = ohlcv.map(record => ({
      time: new Date(record[0]).toString(),
      open: record[1],
      high: record[2],
      low: record[3],
      close: record[4],
      volume: record[5]
    })
  )
  return dataArray
}

(async function main () {
  /** params */
//  let exchangeId = 'huobipro'
//  let fetchingGoal = 30 * 24
//  let symbol = 'LTC/USDT'
//  let interval = '1h' // 1m,1h,1d,1M,1y
  let exchangeId = 'binance'
  let fetchingGoal = 30 * 24
  let symbol = 'ETH/BTH'
  let interval = '1h' // 1m,1h,1d,1M,1y
  let fileName = `${exchangeId}-${symbol.replace('/', '-')}`

  /** calc other params based on given ones */
  let fetchRecordNb // 获取多少个数据点 max=500
  let fetchSince = new Date() // 时间
  let data = []
  let milsecPerRecord
  if (interval === '1m') {
    fetchRecordNb = 8 * 60
    milsecPerRecord = 60 * 60 * 1000
  } else if (interval === '1h') {
    fetchRecordNb = 30*24
    milsecPerRecord = 60 * 60 * 1000
  }

  while (data.length < fetchingGoal) {
    fetchSince -= fetchRecordNb * milsecPerRecord
    let fetchedData = await fetchData(exchangeId, symbol, interval, fetchSince,
      fetchRecordNb)
    data.push(...fetchedData)
    saveJsonToCSV(data, ['time', 'open', 'high', 'low', 'close', 'volume'], fileName)
    log(`${data.length} of record is fetched, ${Math.trunc(100 * data.length / fetchingGoal)}%`.green)
  }

  console.log('data', data)
  process.exit()
})()
