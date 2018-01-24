const credentials = require('../../credentials')
const Manager = require('../Manager')
const Worker = require('../Worker')
const config = require('../config')
const _ = require('lodash')
const api = require('../api')

const {
  numberOfPoints,
  padding,
  windows,
  useVolAsCriteria,
  whiteList,
  blackList,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVol,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList,
  useLockProfit
} = config

let exchangeId = 'binance'

let params = {
  numberOfPoints,
  padding,
  windows,
  useVolAsCriteria,
  whiteList,
  blackList,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVol,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList,
  useLockProfit
}

async function testWorker () {
  let manager = new Manager(exchangeId, credentials[exchangeId], params)
  await manager.fetchData()

  let worker = new Worker('123', 'ETH/BTC', manager.exchange, manager.updateWorkerList, manager.dynamicProfitList, 0.005, {})
  let ohlcvMAs = _.find(manager.ohlcvMAsList, {symbol: 'ETH/BTC'})
  console.log('ohlcvMA', ohlcvMAs.data.slice(-2))
  await worker.marketBuy(ohlcvMAs)
  await worker.createCutProfitOrders(ohlcvMAs)
  await worker.updateRemainingBTCAmount()
  console.log(worker.remainingBTC)
  // await worker.cancelCutProfitOrders()
  // await worker.marketSell(ohlcvMAs, 0.0013)

  // let getWorkerHoldedBTCPromises = [worker].map(worker => worker.getRemainingBTCAmount())
  // let workerHoldedBTCList = await Promise.all(getWorkerHoldedBTCPromises)
  // let totalWorkersHoldedBTC = workerHoldedBTCList.reduce((sum, BTC) => sum + BTC, 0)
  // console.log('totalWorkersHoldedBTC', totalWorkersHoldedBTC)

  // console.log(worker.filledAmount)
  // await worker.updateCutProfitFilledAmount()
  console.log(worker.filledAmount)
  let remainingAmount = await worker.getRemainingBTCAmount()
  console.log('remainingAmount', remainingAmount)
  // await worker.cancelCutProfitOrders()
}

async function testManager () {
  let manager = new Manager(exchangeId, credentials[exchangeId], params)

  /**
   * 测试fetch数据
   */
  // while (true) {
  //   await api.sleep(10000)
  //   await manager.fetchData()
  //   let ethOhlcvMAs = _.find(manager.ohlcvMAsList, o => o.symbol === 'ETH/BTC')
  //   console.log(ethOhlcvMAs.data.slice(-10))
  // }

  /**
   * 测试买卖，取消和创建orders
   */
  await manager.fetchData()
  // await manager._buySymbols(['ETH/BTC', 'ADA/BTC', 'EVX/BTC'])
  await manager._buySymbols(['ADA/BTC'])
  // let ethWorker = _.find(manager.workerList, o => o.symbol === 'ETH/BTC')
  // await manager._workersSellAndRemove([ethWorker])
  // await manager._buySymbols(['EVX/BTC'])
  let adaWorker = _.find(manager.workerList, o => o.symbol === 'ADA/BTC')
  await manager._workersSellAndRemove([adaWorker])
  // let evxWorker = _.find(manager.workerList, o => o.symbol === 'EVX/BTC')
  // await manager._workersSellAndRemove([adaWorker, evxWorker])
  // // await manager._buySymbols(['ADA/BTC'])

  /**
   * 测试hotReload
   */
  // manager._hotReloadParams()
  // manager.blackList = manager.blackList

  /**
   * 测试运行
   */
  // await manager.start()
  // await manager.loadBalance()
  // await manager.fetchData()
  // console.log('manager.ohlcvMAList.length', manager.ohlcvMAList.length)
  // await manager.fetchData()
  // console.log('manager.ohlcvMAList.length', manager.ohlcvMAList.length)
  // await manager.fetchData()
  // console.log('manager.ohlcvMAList.length', manager.ohlcvMAList.length)

  // await manager.fetchData()
  // console.log('manager.ohlcvMAsList[0].slice(-3)', JSON.stringify(manager.ohlcvMAsList[0].data.slice(-3)))
  // await manager.fetchData()
  // console.log('manager.ohlcvMAsList[0].slice(-3)', manager.ohlcvMAsList[0].data.slice(-3))
  // await manager.fetchData()
  // console.log('manager.ohlcvMAsList[0].slice(-3)', manager.ohlcvMAsList[0].data.slice(-3))

  /**
   * test whitelist
   */
  // let long = ['MANA/BTC', 'HTC/BTC', 'HTC2/BTC', 'ETH/BTC']
  // let short = ['MANA/BTC', 'Hello/BTC', 'Hey/BTC']
  // manager._getWhiteList(['ADA/BTC', 'LTC/BTC'], long, short, ['ETH/BTC'])
}

async function main () {
  try {
    // await testWorker()
    await testManager()
  }
  catch (error) {
    console.log(error)
  }
}

main()
