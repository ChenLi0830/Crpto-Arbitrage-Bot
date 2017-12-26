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
  let exchangeId = 'binance'
  let fetchingGoal = 30 * 24 * 60
  let symbol = 'LTC/USDT'
  let interval = '1m' // 1m,1h,1d,1M,1y
  let fileName = `${exchangeId}-${symbol.replace('/', '-')}`

  /** calc other params based on given ones */
  let fetchRecordNb // max=500
  let fetchSince = new Date()
  let data = []
  if (interval === '1m') {
    fetchRecordNb = 8 * 60
  }

  while (data.length < fetchingGoal) {
    fetchSince -= fetchRecordNb * 60 * 1000
    let fetchedData = await fetchData(exchangeId, symbol, interval, fetchSince,
      fetchRecordNb)
    data.push(...fetchedData)
    saveJsonToCSV(data, ['time', 'open', 'high', 'low', 'close', 'volume'], fileName)
    log(`${data.length} of record is fetched, ${Math.trunc(100 * data.length / fetchingGoal)}%`.green)
  }

  console.log('data', data)
  process.exit()
})()
