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
  /**
   * 从SimulatedExchange外部获取数据源，好处是可以重复使用
   */
  let totalNumberOfPoints = Math.trunc(simuDuration / intervalInMillesec)
  let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}))
  await exchange.loadMarkets()
  let symbols = _.filter(exchange.symbols, symbol => symbol.endsWith('BTC'))
  let dataSource = await klineListGetDuringPeriod(exchangeId, symbols, totalNumberOfPoints, simuEndTime)

  let SimuParams = {
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
    SimuParams
  )

  let bestBalance = 0
  let bestParams = {}

  function numberRange (start, end) {
    return new Array(end - start).fill().map((d, i) => i + start)
  }

  await simulatedExchange.initExchange()
  for (let window0 of numberRange(3, 8)) {
    for (let window1 of [9, 16, 25]) {
      for (let dynamicProfit1 of [0.4, 0.6, 0.8, 1, 1.2, 1.5]) {
        params.windows = [window0, window1, 99]
        params.dynamicProfitList = [
          {
            multiplier: dynamicProfit1,
            percent: 90
          }
        ]
        simulatedExchange.resetSimulation()
        let manager = new Manager(simulatedExchange, credentials[exchangeId], params)
        let BTCResult = await manager.start()

        if (BTCResult > bestBalance) {
          bestBalance = BTCResult
          bestParams = params
          console.log(`bestBalance ${bestBalance}`, 'bestParams', bestParams)
          fs.appendFileSync('./savedData/klines/bestParams.js', util.inspect({bestBalance, bestParams}), 'utf-8')
        }
      }
    }
  }
}

async function main () {
  try {
    // await testWorker()
    // await testManager()
    // await testSimulatedExchange()
    // await testSimulation()
    await testParamsInSimulation()
  } catch (error) {
    console.log(error)
  }
}

main()
