const credentials = require('../../credentials')
const Manager = require('../Manager')
const Worker = require('../Worker')
const SimulatedExchange = require('../SimulatedExchange')
const config = require('../config')
const _ = require('lodash')
const api = require('../api')
const klineListGetDuringPeriod = require('../database/klineListGetDuringPeriod')
const ccxt = require('ccxt')
const fs = require('fs')
const util = require('util')
const {
  checkMemory,
  retryMutationTaskIfTimeout
} = require('../utils')
const moment = require('moment')

let {
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
  useLockProfit,
  isSimulation,
  simuBalance,
  simuTradingFee,
  simuDuration,
  simuEndTime,
  simuTimeStepSize,
  exchangeId,
  intervalInMillesec
} = config

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
  useLockProfit,
  isSimulation
}

async function testWorker () {
  let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials))
  let manager = new Manager(exchange, credentials[exchangeId], params)
  await manager.fetchData()
  let worker = new Worker('123', 'ETH/BTC', manager.exchange, manager.dynamicProfitList, 0.005, {})
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
  let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials))
  let manager = new Manager(exchange, credentials[exchangeId], params)

  /**
   * 测试logMarket
   */
  // await manager.fetchData()
  // manager._pickSymbolsFromMarket()
  // while (true) {
  //   // manager._logMarket()
  //   manager._hotReloadParams()
  //   console.log('manager.windows', manager.windows)
  //   await api.sleep(200)
  // }

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
  // await manager.fetchData()
  // await manager._buySymbols(['ETH/BTC', 'ADA/BTC', 'EVX/BTC'])
  // await manager._buySymbols(['ADA/BTC'])
  // let ethWorker = _.find(manager.workerList, o => o.symbol === 'ETH/BTC')
  // await manager._workersSellAndRemove([ethWorker])
  // await manager._buySymbols(['EVX/BTC'])
  // let adaWorker = _.find(manager.workerList, o => o.symbol === 'ADA/BTC')
  // await manager._workersSellAndRemove([adaWorker])
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
  await manager.start()
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

async function testSimulatedExchange () {
  /**
   * 从SimulatedExchange外部获取数据源，好处是可以重复使用
   */
  let totalNumberOfPoints = Math.trunc(simuDuration / intervalInMillesec)
  let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}))
  await exchange.loadMarkets()
  let symbols = _.filter(exchange.symbols, symbol => symbol.endsWith('BTC'))
  let dataSource = await klineListGetDuringPeriod(exchangeId, symbols, totalNumberOfPoints, simuEndTime)

  let params = {
    numberOfPoints,
    padding,
    intervalInMillesec,
    ohlcvMAsListSource: dataSource
  }

  let simulatedExchange = new SimulatedExchange(
    exchangeId,
    simuBalance,
    simuTradingFee,
    simuDuration,
    simuEndTime,
    simuTimeStepSize,
    params
  )

  /**
   * 测试基础methods
   */
  await simulatedExchange.initExchange()
  simulatedExchange.nextStep()
  console.log('simulatedExchange.symbols', simulatedExchange.symbols)

  let symbol = 'ETH/BTC'
  let worker = new Worker('123', symbol, simulatedExchange, dynamicProfitList, 0.1, {})
  let ohlcvMAs = _.find(simulatedExchange.ohlcvMAsList, {symbol: 'ETH/BTC'})
  console.log('ohlcvMA', ohlcvMAs.data.slice(-2))

  await worker.marketBuy(ohlcvMAs)
  await worker.createCutProfitOrders(ohlcvMAs)

  await worker.cancelCutProfitOrders()
  await worker.marketSell(ohlcvMAs)
  console.log('finished')
  // await worker.createCutProfitOrders(ohlcvMAs)
  // await worker.updateRemainingBTCAmount()
  // console.log(worker.remainingBTC)
  // markets
}

async function testSimulation () {
  let SimuParams = {
    numberOfPoints,
    padding,
    intervalInMillesec
    // ohlcvMAsListSource: dataSource
  }

  let simulatedExchange = new SimulatedExchange(
    exchangeId,
    simuBalance,
    simuTradingFee,
    simuDuration,
    simuEndTime,
    simuTimeStepSize,
    SimuParams
  )
  await simulatedExchange.initExchange()

  let manager = new Manager(simulatedExchange, credentials[exchangeId], params)
  let BTCResult = await manager.start()
  console.log('BTCResult', BTCResult)
}

async function testParamsInSimulation () {
  checkMemory('debug')
  /**
   * 从SimulatedExchange外部获取数据源，好处是可以重复使用
   */
  params.padding = 180 // maximum potential value of the windows in the loop below
  
  let totalNumberOfPoints = Math.trunc(simuDuration / intervalInMillesec) + params.padding
  let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}))
  await retryMutationTaskIfTimeout(exchange, 'loadMarkets', [])
  let symbols = _.filter(exchange.symbols, symbol => symbol.endsWith('BTC'))
  
  console.time('LoadData')
  let dataSource = await klineListGetDuringPeriod(exchangeId, symbols, totalNumberOfPoints, simuEndTime)
  console.timeEnd('LoadData')

  let SimuParams = {
    numberOfPoints,
    padding: params.padding,
    intervalInMillesec,
    ohlcvMAsListSource: dataSource
  }

  let bestBalance = 0
  let bestParams = {}
  
  console.time('Simulation')
  let counter = 0
  // for (let window0 of [4, 5, 7, 8, 9, 10]) {
  // for (let window1 of [16, 21, 25]) {
  // for (let window2 of [180, 99, 120, 150]) {
  for (let window0 of [10]) {
  for (let window1 of [25]) {
  for (let window2 of [99]) {
    if (window0 >= window1 || window1 >= window2) {
      continue
    }
  for (let dynamicProfit1 of [1, 2, 3, 4, 5, 6]) {
  for (let dynamicProfit2 of [1, 2, 3, 4, 5, 6]) {
  // // // for (let dynamicProfit3 of [1, 2, 3, 4, 5, 6, 7]) {
  for (let dynamicPercent1 of [10, 30, 50, 70, 90]) {
  for (let dynamicPercent2 of [10, 30, 50, 70, 90]) {
  // // // for (let dynamicPercent3 of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    params.windows = [window0, window1, window2]
    if (dynamicProfit1 >= dynamicProfit2 /* || dynamicProfit2 >= dynamicProfit3 */) {
      continue
    }
    if (dynamicPercent1 + dynamicPercent2 /* + dynamicPercent3 */ >= 100) {
      continue
    }
    params.dynamicProfitList = [
      {
        multiplier: dynamicProfit1,
        percent: dynamicPercent1
      },
      {
        multiplier: dynamicProfit2,
        percent: dynamicPercent2
      },
      // {
      //   multiplier: dynamicProfit3,
      //   percent: dynamicPercent3
      // }
    ]
    let simulatedExchange = new SimulatedExchange(
      exchangeId,
      simuBalance,
      simuTradingFee,
      simuDuration,
      simuEndTime,
      simuTimeStepSize,
      SimuParams
    )
    await simulatedExchange.initExchange()

    checkMemory('debug')
    let manager = new Manager(simulatedExchange, credentials[exchangeId], params)
    let BTCResult = await manager.start()

    counter++
    if (BTCResult > bestBalance) {
      bestBalance = BTCResult
      bestParams = params
      console.log(`bestBalance ${bestBalance}`, 'bestParams', bestParams)
      fs.appendFileSync(`./savedData/klines/bestParams-3.js`, JSON.stringify({bestBalance, bestParams}) + '\n', 'utf-8')
    }
  }
  }
  }
  }
  }
  }
  }
  // }
  // }
  console.log('counter', counter)
  console.timeEnd('Simulation')
}

async function testParamsInSimulationOverTime () {
  let overallSimulationDuration = 16 * 24 * 60 * 60 * 1000
  durationInterval = 16 * 24 * 60 * 60 * 1000 // how long for each simulate
  let initialEndTime = new Date().getTime() // Jan 31 10:00am
  // let initialEndTime = 1517335213307 // Jan 30 10:00am
  // let initialEndTime = 1516861379991 // Jan 25 10pm
    // let initialEndTime = 1515306179991 // Jan 6 10pm
  let counter = 0
  let totalCount = Math.trunc(overallSimulationDuration / durationInterval)
  while (counter < totalCount) {
    simuEndTime = initialEndTime - (counter * durationInterval) // Jan 30 10:00am
    simuDuration = durationInterval + numberOfPoints * intervalInMillesec
    fs.appendFileSync(`./savedData/klines/bestParams-3.js`, `${moment(Number(simuEndTime) - durationInterval).format('MMMM Do YYYY, h:mm a')} - ${moment(Number(simuEndTime)).format('MMMM Do YYYY, h:mm a')}\n`, 'utf-8')
    await testParamsInSimulation()
    counter++
  }
}

async function main () {
  try {
    // await testWorker()
    // await testManager()
    // await testSimulatedExchange()
    // await testSimulation()
    // await testParamsInSimulation()
    await testParamsInSimulationOverTime()
  } catch (error) {
    console.log(error)
    console.log(error.stack)
  }
}

main()
