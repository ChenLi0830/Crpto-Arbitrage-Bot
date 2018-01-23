const credentials = require('../../credentials')
const Manager = require('../Manager')
const Worker = require('../Worker')
const {
  windows,
  numberOfPoints,
  padding,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList
} = require('../config')
const _ = require('lodash')

let exchangeId = 'binance'
let params = {
  numberOfPoints,
  padding,
  windows,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList
}

async function testWorker () {
  let manager = new Manager(exchangeId, credentials[exchangeId], params)
  await manager.fetchData()

  let worker = new Worker('123', 'ETH/BTC', manager.exchange, manager.updateWorkerList, manager.dynamicProfitList, 0.003)
  let ohlcvMAs = _.find(manager.ohlcvMAsList, {symbol: 'ETH/BTC'})
  console.log('ohlcvMA', ohlcvMAs.data.slice(-2))
  worker.createCutProfitOrders(ohlcvMAs)
}

async function main () {
  await testWorker()
  // await manager.start()
  // await manager.loadBalance()
  // await manager.fetchData()
  // console.log('manager.ohlcvMAList.length', manager.ohlcvMAList.length)
  // await manager.fetchData()
  // console.log('manager.ohlcvMAList.length', manager.ohlcvMAList.length)
  // await manager.fetchData()
  // console.log('manager.ohlcvMAList.length', manager.ohlcvMAList.length)
}

main()
