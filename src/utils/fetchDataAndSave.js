const {intervalInMillesec, exchangeId} = require('../config')
const {saveJsonToCSV} = require('./index')
const klineListGetDuringPeriod = require('../database/klineListGetDuringPeriod')

async function main () {
  let simuEndTime = new Date().getTime() - 5 * 60 * 1000
  let simuDuration = 5 * 30 * 24 * 60 * 60 * 1000
  // let simuDuration = 500 * 5 * 60 * 1000
  let totalNumberOfPoints = Math.trunc(simuDuration / intervalInMillesec)
  let symbol = 'BTC/USDT'

  console.log('Loading data')
  let dataSource = await klineListGetDuringPeriod(exchangeId, [symbol], totalNumberOfPoints, simuEndTime)
  console.log('Writing data')
  saveJsonToCSV(dataSource[0].data, ['timeStamp', 'open', 'high', 'low', 'close', 'volume'], './binance-BTC')
  console.log('Success')
}

main()
