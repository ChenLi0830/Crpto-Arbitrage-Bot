const ccxt = require('ccxt')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const fs = require('fs')
const util = require('util')
const _ = require('lodash')
require('ansicolor').nice
const credentials = require('../credentials.js')
const {MinorError, MajorError} = require('./utils/errors')
const {simulate} = require('./utils')
let newBalance

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const handleError = (e) => {
  console.error(e)
  if (e instanceof ccxt.DDoSProtection) {
    log.bright.yellow('[DDoS Protection]')
  }
  else if (e instanceof ccxt.RequestTimeout) {
    log.bright.yellow('[Request Timeout]')
  }
  else if (e instanceof ccxt.AuthenticationError) {
    log.bright.yellow('[Authentication Error]')
  }
  else if (e instanceof ccxt.ExchangeNotAvailable) {
    log.bright.yellow('[Exchange Not Available]')
  }
  else if (e instanceof ccxt.ExchangeError) {
    log.bright.yellow('[Exchange Error]')
  }
  else if (e instanceof ccxt.NetworkError) {
    log.bright.yellow('[Network Error]')
  }
  else if (e instanceof MinorError) {
    log.bright.yellow('[Minor Trading Error]')
  }
  else {
    throw e
  }
}

const sortByPrice = (tickersBySymbol) => {
  let tickersSortedByPrice = {}
  Object.keys(tickersBySymbol).forEach(key => {
    let tickers = tickersBySymbol[key]
    tickers = tickers.filter(exchange => !isNaN(exchange.price)) // remove invalid ones
    tickersSortedByPrice[key] = _.sortBy(tickers, item => item.price)
  })
  return tickersSortedByPrice
}

const largePriceDiff = (a, b, percentage) => {
  if (a.price) {
    return ((a.price - b.price) / b.price) > percentage
  }
  else {
    return ((a - b) / b) > percentage
  }
}

const weightedPrice = (priceAmountList, BTCVol=0.01) => {
  let amount = 0
  let totalPrice = 0
  let accumulatedBTCVol = 0
  let tradePrice = 0
  for (let [price, vol] of priceAmountList) {
    accumulatedBTCVol += price * vol
    totalPrice += price * vol
    amount += vol

    if (accumulatedBTCVol > BTCVol) {
      tradePrice = price
      break
    }
  }
  let price = totalPrice / amount
  log(`price ${price}, accumulatedBTCVol ${accumulatedBTCVol}`.green)
  return {price, tradePrice, accumulatedBTCVol}
}

async function getPotentialTrades (tickersSortedByPrice, PRICE_DIFF, BTCVol=0.1) {
  let worthTasks = []
  for (let symbol of Object.keys(tickersSortedByPrice)) {

    if (!symbol.endsWith('/BTC')) continue

    let exchangePrices = tickersSortedByPrice[symbol]
    let lowIndex = 0
    let highIndex = exchangePrices.length - 1

    while (highIndex > lowIndex &&
    largePriceDiff(exchangePrices[highIndex], exchangePrices[lowIndex],
      PRICE_DIFF)) {

      if (exchangePrices[highIndex].dayVolInBTC < 50 || exchangePrices[lowIndex].dayVolInBTC < 50) {
        break
      }

      if (exchangePrices[highIndex].price >
        exchangePrices[lowIndex].price * 3) {
        lowIndex++
        highIndex--
        continue
      }

      /** simple strategy based on price only */

//      worthTasks.push({
//        symbol: symbol,
//        buyFrom: exchangePrices[lowIndex].exchangeId,
//        purchasePrice: exchangePrices[lowIndex].price,
//        sellTo: exchangePrices[highIndex].exchangeId,
//        sellPrice: exchangePrices[highIndex].price,
//        profitePercent: (exchangePrices[highIndex].price -
//          exchangePrices[lowIndex].price) / exchangePrices[lowIndex].price
//      })
//
//      break

      /** strategy based on order book */
      let buyExchange = new (ccxt)[exchangePrices[lowIndex].exchangeId]()
      let sellExchange = new (ccxt)[exchangePrices[highIndex].exchangeId]()

      if (!buyExchange.hasFetchOrderBook) {
        lowIndex++
        continue
      }

      if (!sellExchange.hasFetchOrderBook) {
        highIndex--
        continue
      }

//      console.log(buyExchange.id, sellExchange.id)

      try{
        let waitTime = Math.max(buyExchange.rateLimit, sellExchange.rateLimit)
        log(`waiting for ${waitTime}`.cyan)
        await sleep(waitTime)
        const buyFromOrders = await buyExchange.fetchOrderBook (symbol)
        const sellToOrders = await sellExchange.fetchOrderBook (symbol)

        let weightedBuy = weightedPrice(buyFromOrders.asks, BTCVol) //|| exchangePrices[lowIndex].price
        let weightedSell = weightedPrice(sellToOrders.bids, BTCVol) //|| exchangePrices[highIndex].price

        log(`Fetched ${symbol} weightedBuyPrice(${weightedBuy.price}) and weightedSellPrice(${weightedSell.price})`.cyan)

        let enoughVol = weightedBuy.accumulatedBTCVol >= BTCVol && weightedSell.accumulatedBTCVol >= BTCVol
//        console.log(`Fetched ${symbol} from ${buyExchange.id}(${weightedPrice(buyFromOrders.asks)}) and ${sellExchange.id}(${weightedPrice(sellToOrders.bids)})`)

        if (largePriceDiff(weightedSell, weightedBuy, PRICE_DIFF) && enoughVol) {
          // found task
          worthTasks.push({
            symbol: symbol,
            buyFrom: exchangePrices[lowIndex].exchangeId,
            buyPrice: exchangePrices[lowIndex].price,
            sellTo: exchangePrices[highIndex].exchangeId,
            sellPrice: exchangePrices[highIndex].price,
            asks: JSON.stringify(buyFromOrders.asks.slice(0,5)),
            askVol: weightedBuy.accumulatedBTCVol,
            profitPercent: (exchangePrices[highIndex].price - exchangePrices[lowIndex].price) / exchangePrices[lowIndex].price,
            weightedBuyPrice: weightedBuy.price,
            weightedSellPrice: weightedSell.price,
            weightedProfitPercent: (weightedSell.price - weightedBuy.price) / weightedBuy.price,
            bids: JSON.stringify(sellToOrders.bids.slice(0,5)),
            bidVol: weightedSell.accumulatedBTCVol,
          })
          console.log('saving')
          break
        } else { // change index
          // 哪个与实际销售价差的大，就变哪个index
          let buyPriceDiff = weightedBuy - exchangePrices[lowIndex].price
          let sellPriceDiff = exchangePrices[highIndex].price - weightedSell
          if (buyPriceDiff > sellPriceDiff) {
            lowIndex++
          } else {
            highIndex--
          }
        }
      }
      catch (e) {
        handleError(e)
        break
      }
    }
  }
  let tasksSortByProfit = _.sortBy(worthTasks, task => -task.weightedProfitPercent)
//  log(`worthTasks ${JSON.stringify(worthTasks)}`.red)
//  log(`tasksSortByProfit ${JSON.stringify(tasksSortByProfit)}`.red)
  return tasksSortByProfit
}

async function checkTradeBenefit(buyExchange, sellExchange, symbol, BTCVol){
  log(`------ Checking Current Benefit of the Trade ------`)

  let [buyFromOrders, sellToOrders] = await Promise.all([
    buyExchange.fetchOrderBook (symbol),
    sellExchange.fetchOrderBook (symbol),
  ])

  let weightedBuy = weightedPrice(buyFromOrders.asks, BTCVol)
  let weightedSell = weightedPrice(sellToOrders.bids, BTCVol)

  log(`---    Fetched ${symbol} weightedBuy(${JSON.stringify(weightedBuy)})`.green)
  log(`---    Fetched ${symbol} weightedSell(${JSON.stringify(weightedSell)})`.green)

  let weightedProfit = (weightedSell.price - weightedBuy.price) / weightedBuy.price
  if (weightedBuy.accumulatedBTCVol < BTCVol) {
    throw new MinorError(`weightedBuy doesn't have enough volume ${weightedBuy.accumulatedBTCVol} < ${BTCVol}`)
  }
  if (weightedSell.accumulatedBTCVol < BTCVol) {
    throw new MinorError(`weightedSell doesn't have enough volume ${weightedSell.accumulatedBTCVol} < ${BTCVol}`)
  }
  log(`---    weightedProfit ${weightedProfit}`.green)
  log(`------ Checking Current Benefit of the Trade ------`, '\n')
  return {
    sellPrice: weightedSell.tradePrice,
    buyPrice: weightedBuy.tradePrice,
    weightedProfit,
    weightedBuy: weightedBuy.price,
    weightedSell: weightedSell.price,
  }
}

async function checkPotentialProblems(srcExchange, buyFromExchange, sellToExchange){
  /** pre-check potential problems */
  if (!srcExchange.apiKey || !buyFromExchange.apiKey ||
    !sellToExchange.apiKey) {
    throw new MinorError('makeTrade initialization error')
  }

  /** Check if exchange has all methods */
  let requiredMethods = [
    srcExchange.withdraw,
    buyFromExchange.withdraw,
    sellToExchange.withdraw,
    buyFromExchange.createMarketBuyOrder,
    sellToExchange.createMarketSellOrder,
  ].map(item => !!item)

  if (!_.every(requiredMethods)) {
    let methods = [
      'srcExchange.withdraw',
      'buyFromExchange.withdraw',
      'sellToExchange.withdraw',
      'buyFromExchange.createMarketBuyOrder',
      'sellToExchange.createMarketSellOrder',
    ]
    methods.forEach((method, index) => log(`${method}: ${requiredMethods[index]}`))

    throw new MinorError(`buyFromExchange or sellToExchange lack methods: ${buyFromExchange.id}, ${sellToExchange.id}`)
  }
}

async function getAddress(exchange, currencySymbol) {
  if (!exchange.fetchDepositAddress && !exchange.currencyAddressList[currencySymbol]) {
    throw new MinorError(`${exchange.id} doesn't have ${currencySymbol} address!`)
  } else {
    return exchange.currencyAddressList[currencySymbol] || (await exchange.fetchDepositAddress(currencySymbol)).address
  }
}

async function fetchAddress(params){
  let {
    symbol,
    buyFrom,
    sellTo,
    profitePercent,
    currencySymbol,
    targetSymbol,
    srcId,
    buyFromId,
    sellToId,
    srcExchange,
    buyFromExchange,
    sellToExchange,
  } = params

  try{
    log(`------ Fetching Addresses ------`)
    let srcBTCAddress = await getAddress(srcExchange, currencySymbol)
    log(`---    srcBTCAddress: ${srcBTCAddress}`.green)
    let buyFromAddress = await getAddress(buyFromExchange, currencySymbol)
    log(`---    buyFromAddress: ${buyFromAddress}`.green)
    let sellToAddress = await getAddress(sellToExchange, targetSymbol)
    log(`---    sellToAddress: ${sellToAddress}`.green)
    if (!_.every([srcBTCAddress, buyFromAddress, sellToAddress])) {
      throw new MinorError(`Not all addresses acquired`)
    }
    log(`------ Fetching Addresses ------`, '\n')

    await step1({...params, srcBTCAddress, buyFromAddress, sellToAddress})

  } catch(e) {
    handleError(e)
    throw new MinorError(`Can't get all addresses`)
  }
}

async function step1(params){
  let {
    symbol,
    buyFrom,
    sellTo,
    profitePercent,
    currencySymbol,
    targetSymbol,
    srcId,
    buyFromId,
    sellToId,
    srcExchange,
    buyFromExchange,
    sellToExchange,
    srcBTCAddress,
    buyFromAddress,
    sellToAddress
  } = params

  const ExpectedMinProfit = 0.01
//  const ExpectedMinProfit = -0.1

  log(`------ Step1: Check Src Exchange Balance ------`)
  let srcBtcAmount = params.simulate
    ? await simulate(params.simulateBalance, 3*1000)
    : (await srcExchange.fetchBalance({'recvWindow': 60*10*1000}))['free'][currencySymbol]
  log(`---    ${srcExchange.id}: ${currencySymbol} balance ${srcBtcAmount}`.green)
  log(`------ Step1: Check Src Exchange Balance ------`, '\n')

  /** checkTradeBenefit */
  let {sellPrice, buyPrice, weightedProfit} = await checkTradeBenefit(buyFromExchange, sellToExchange, symbol, srcBtcAmount)
  if (weightedProfit < ExpectedMinProfit) {
    throw new MinorError('weightedProfit too small, check next trade')
  }
  /** checkTradeBenefit */

  await step2({...params, srcBtcAmount})
}

/** Transfer BTC from source exchange to buyFrom exchange */
async function step2(params){
  let {
    symbol,
    buyFrom,
    sellTo,
    profitePercent,
    currencySymbol,
    targetSymbol,
    srcId,
    buyFromId,
    sellToId,
    srcExchange,
    buyFromExchange,
    sellToExchange,
    srcBTCAddress,
    buyFromAddress,
    sellToAddress,
    balance,
    srcBtcAmount
  } = params

  log(`------ Step2: Transfer BTC from Source to BuyFrom ------`)
  let buyFromBTCAmount = srcBtcAmount
  if (buyFromId !== srcId) {
    log(`---    transfer ${srcBtcAmount} ${currencySymbol} from ${srcId} to ${buyFromId}`.green)

    let srcWithdrawResult = params.simulate
      ? await simulate({info: {success: true}}, 20 * 60 /*3*/ *1000)
      : await srcExchange.withdraw(currencySymbol, srcBtcAmount, buyFromAddress, {name: `${buyFromId} address`})

    let step2SuccessStatus = srcWithdrawResult.info.success
//    log(srcWithdrawResult)
    log(`---    transfer BTC success: ${step2SuccessStatus}`.green)
    if (!step2SuccessStatus) {
      log(`---    error`.green, srcWithdrawResult)
      console.log(new MinorError('Withdraw balance from src failed! Retry step 2'))
      await step2(params)
      return
    }

    buyFromBTCAmount = params.simulate
      ? (srcBtcAmount - 0.001)
      : await waitForWithdrawComplete(buyFromExchange, srcBtcAmount, currencySymbol)

    log(`---    Withdraw BTC from ${srcId} to ${buyFromId} complete`.green)
    log(`---    ${srcBtcAmount} transferred, buyFrom new balance ${buyFromBTCAmount}`.green)
  } else {
    log(`---    Buy from ${srcId}, no need to transfer`.green)
  }
  log(`------ Step2: Transfer BTC from Source to BuyFrom ------`, '\n')

  await step3({...params, buyFromBTCAmount})
}

/** Buy target currency at buyFrom exchange */
async function step3(params){
  let {
    symbol,
    buyFrom,
    sellTo,
    profitePercent,
    currencySymbol,
    targetSymbol,
    srcId,
    buyFromId,
    sellToId,
    srcExchange,
    buyFromExchange,
    sellToExchange,
    srcBTCAddress,
    buyFromAddress,
    sellToAddress,
    balance,
    srcBtcAmount,
    buyFromBTCAmount,
  } = params

  /** checkTradeBenefit */
//  const ExpectedMinProfit = 0.005
  const ExpectedMinProfit = 0.01
  let maxTry = 10
  let sellPrice, buyPrice, weightedProfit, weightedBuy, weightedSell

  for (let i=0 ; i<maxTry; i++){
    let result = await checkTradeBenefit(buyFromExchange, sellToExchange, symbol, srcBtcAmount)
    sellPrice = result.sellPrice
    buyPrice = result.buyPrice
    weightedProfit = result.weightedProfit
    weightedBuy = result.weightedBuy
    weightedSell = result.weightedSell
    if (weightedProfit < ExpectedMinProfit) {
      log(`---   Trial ${i}: weightedProfit ${weightedProfit} < ExpectedMinProfit ${ExpectedMinProfit}`.green)
    } else {
      break
    }
    await sleep(10*1000)
  }

  if (weightedProfit < ExpectedMinProfit) {
    throw new MinorError('weightedProfit too small')
    //  Todo Transfer BTC back to SRC, and check for next trade
  }
  /** checkTradeBenefit */

  try {
    log(`------ Step3: Buy target currency at buyFrom exchange ------`)
    log(`---    buy price ${buyPrice}, weighted buy ${weightedBuy}`.green)
    let maxAmount = buyFromBTCAmount * 0.999 / buyPrice
    log(`---    1st time purchase ${symbol} ${maxAmount} - `.green)
    let purchaseResult = params.simulate
      ? await simulate({status: 'filled'}, 3*1000)
      : await buyFromExchange.createMarketBuyOrder(symbol, maxAmount)
    log(`---    1st time purchase result - `.green, purchaseResult)

    log(`---    fetching buyFrom btc balance - `.green)
    buyFromBTCAmount = params.simulate
      ? buyFromBTCAmount * 0.1
      : (await buyFromExchange.fetchBalance({'recvWindow': 60*10*1000}))['free'][currencySymbol]
    log(`-      balance result ${currencySymbol} ${buyFromBTCAmount}`.green)
    log(`---    fetching buyFrom btc balance - `.green)

    maxAmount = buyFromBTCAmount * 0.999 / buyPrice
    log(`---    2nd time purchase ${symbol} ${maxAmount} - `.green)
    purchaseResult = params.simulate
      ? await simulate({status: 'filled'}, 3*1000)
      : await buyFromExchange.createMarketBuyOrder(symbol, maxAmount)
    log(`---    2nd time purchase result - `.green, purchaseResult)

    try{
      log(`---    fetching buyFrom btc balance - `.green)
      buyFromBTCAmount = params.simulate
        ? buyFromBTCAmount * 0.1
        : (await buyFromExchange.fetchBalance({'recvWindow': 60*10*1000}))['free'][currencySymbol]
      log(`-      balance result ${currencySymbol} ${buyFromBTCAmount}`.green)
      log(`---    fetching buyFrom btc balance - `.green)

      maxAmount = buyFromBTCAmount * 0.999 / buyPrice
      log(`---    3rd time purchase ${symbol} ${maxAmount} - `.green)
      purchaseResult = params.simulate
        ? await simulate({status: 'filled'}, 3*1000)
        : await buyFromExchange.createMarketBuyOrder(symbol, maxAmount)
      log(`---    3rd time purchase result - `.green, purchaseResult)
    } catch (e) {
      log(`ignored error ${e.message}`)
//      Ignore any error here
    }
    log(`------ Step3: Buy target currency at buyFrom exchange ------`, '\n')

    await step4({...params, sellPrice, buyPrice, weightedProfit, weightedBuy, weightedSell})
  } catch (e) {
//    todo handle recover from purchase
    handleError(e)
  }
}

/** transfer from buyFrom to sellTo */
async function step4(params){
  let {
    symbol,
    buyFrom,
    sellTo,
    profitePercent,
    currencySymbol,
    targetSymbol,
    srcId,
    buyFromId,
    sellToId,
    srcExchange,
    buyFromExchange,
    sellToExchange,
    srcBTCAddress,
    buyFromAddress,
    sellToAddress,
    balance,
    srcBtcAmount,
    buyFromBTCAmount,
    sellPrice,
    buyPrice,
    weightedProfit,
    weightedBuy,
    weightedSell,
  } = params

  log(`------ Step4: Transfer target currency to sellToExchange ------`)

  let boughtAmount
  let buyFromWithdrawResult
  let sellToTargetAmount

  try {
    /** Check target currency balance at buyFrom exchange*/
    boughtAmount = params.simulate
      //转账费0.001BTC, 卖出了99.9% (还剩0.1%没卖出去), 手续费0.1%,
      ? (buyFromBTCAmount / weightedBuy) * 0.999 * 0.999
      : (await buyFromExchange.fetchBalance())['free'][targetSymbol]
    log(`boughtAmount ${boughtAmount}`.green)
  }
  catch (e) {
    log(`retry fetching balance`)
  }

  try {
    buyFromWithdrawResult = params.simulate
      //转账费0.001BTC, 卖出了99.9% (还剩0.1%没卖出去), 手续费0.1%,
      ? await simulate({info: {success: true}}, 20 * 60 /*3*/ *1000)
      : await buyFromExchange.withdraw(targetSymbol, boughtAmount, sellToAddress, {name: `${sellToId} address`})
    log(`---    Transfer target currency to sellToExchange`.green, buyFromWithdrawResult)
    /** Wait for the transfer to complete */
    sellToTargetAmount = params.simulate
      ? boughtAmount - 0.001 / buyPrice // 转账费为0.001BTC对应的target货币
      : await waitForWithdrawComplete(sellToExchange, boughtAmount, targetSymbol)
    log(`---    ${boughtAmount} transferred, ${sellToTargetAmount} received`.green)
  }
  catch (e) {
    // todo handle error if transfer failed
//    handleError(e)
  }

  log(`------ Step4: Transfer target currency to sellToExchange ------`, '\n')
  await step5({...params, sellToTargetAmount})
}

/** sell targetCurrency for BTC at sellTo */
async function step5 (params) {
  let {
    symbol,
    buyFrom,
    sellTo,
    profitePercent,
    currencySymbol,
    targetSymbol,
    srcId,
    buyFromId,
    sellToId,
    srcExchange,
    buyFromExchange,
    sellToExchange,
    srcBTCAddress,
    buyFromAddress,
    sellToAddress,
    balance,
    srcBtcAmount,
    buyFromBTCAmount,
    sellToTargetAmount,
  } = params

  log(`------ Step5: Sell Target Currency for BTC at sellToExchange ------`)

  /** checkTradeBenefit */
    //  const ExpectedMinProfit = 0.005
  const ExpectedMinProfit = -0.03
  let maxTry = 1000
  let sellPrice, buyPrice, weightedProfit, weightedBuy, weightedSell

  for (let i=0 ; i<maxTry; i++){
    let result = await checkTradeBenefit(buyFromExchange, sellToExchange, symbol, srcBtcAmount)
    sellPrice = result.sellPrice
    buyPrice = result.buyPrice
    weightedProfit = result.weightedProfit
    weightedBuy = result.weightedBuy
    weightedSell = result.weightedSell
    if (weightedProfit < ExpectedMinProfit) {
      log(`---   Trial ${i}: weightedProfit ${weightedProfit} < ExpectedMinProfit ${ExpectedMinProfit}`.green)
    } else {
      break
    }
    await sleep(10*1000)
  }

  if (weightedProfit < ExpectedMinProfit) {
    throw new MajorError(`weightedProfit too small in the last step: ${sellToId} ${targetSymbol}`)
  }
  /** checkTradeBenefit */

  /** Sell target currency for BTC at sellTo exchange */
  try {
    log(`---    symbol ${symbol}, targetAmount ${sellToTargetAmount}`.green)
    let sellResult = params.simulate
      ? await simulate({status: 'filled'}, 3000)
      : await sellToExchange.createMarketSellOrder(symbol, sellToTargetAmount)
    log(`---    sellResult`.green, sellResult)

//  Todo  if (something is wrong with sellResult) {
////      handle it
//    }
  }
  catch(e) {
    handleError(e)
  }

  log(`------ Step5: Sell Target Currency for BTC at sellToExchange ------`, '\n')
  await step6({...params, weightedSell})
}
/** transfer BTC back to src exchange */
async function step6(params) {
  let {
    symbol,
    buyFrom,
    sellTo,
    profitePercent,
    currencySymbol,
    targetSymbol,
    srcId,
    buyFromId,
    sellToId,
    srcExchange,
    buyFromExchange,
    sellToExchange,
    srcBTCAddress,
    buyFromAddress,
    sellToAddress,
    balance,
    srcBtcAmount,
    buyFromBTCAmount,
    sellToTargetAmount,
    weightedSell,
  } = params

  log(`------ Step6: Transfer BTC Back to Source Exchange ------`, '\n')
  /** Check BTC balance at sellTo exchange */
  let sellToBTCAmount = params.simulate
    ? await simulate((sellToTargetAmount * weightedSell) * 0.999, 3000) // 0.1%手续费
    : (await sellToExchange.fetchBalance())['free']['BTC']
  log(`---    sellToBTCAmount ${sellToBTCAmount}`.green)

  /** transfer BTC back to source exchange */
  if (sellToId !== srcId) {
    log(`---    Transfer ${sellToBTCAmount} ${currencySymbol} from ${sellToId} to ${srcId}`.green)
    let sellToWithdrawResult = params.simulate
      ? await simulate({info: {success: true}}, 20 * 60 *1000)
      : await sellToExchange.withdraw(currencySymbol, sellToBTCAmount, srcBTCAddress, {name: `${sellToId} address`})
    log(`---    sellToWithdrawResult `.green, sellToWithdrawResult)
  }

  /** Wait for the transfer to complete */
  let srcBTCAmountNew = params.simulate
    ? await simulate(sellToBTCAmount - 0.001, 3 *1000)
    : await waitForWithdrawComplete(srcExchange, sellToBTCAmount, currencySymbol)
  log(`---    ${sellToBTCAmount} transferred, ${srcBTCAmountNew} received`.green)
  log(`Original srcBtcAmount ${srcBtcAmount}, new srcBTCAmount ${srcBTCAmountNew}`.cyan)
  log(`------ Step6: Transfer BTC Back to Source Exchange ------`, '\n')

  newBalance = srcBTCAmountNew
}

async function makeTrade (trade) {
  /** Initialization */
  const {
    symbol,
    buyFrom,
    sellTo,
    profitePercent
  } = trade

  const enableRateLimit = true
  const verbose = false
  let currencySymbol = 'BTC'
  let targetSymbol = symbol.split('/')[0]
  let srcId = 'binance'
  let buyFromId = buyFrom
  let sellToId = sellTo

  log(`------ Preparing trade ------`)
  log(`---    target currency: ${targetSymbol}`.cyan)
  log(`---    buy from: ${buyFromId}`.cyan)
  log(`---    sell to: ${sellToId}`.cyan)
  log(`------ Preparing trade ------`, '\n')

  let srcExchange = new ccxt[srcId](
    ccxt.extend({enableRateLimit, verbose}, credentials[srcId]))

  let buyFromExchange = new ccxt[buyFromId](
    ccxt.extend({enableRateLimit, verbose}, credentials[buyFromId]))

  let sellToExchange = new ccxt[sellToId](
    ccxt.extend({enableRateLimit, verbose}, credentials[sellToId]))

  /** Start trading */
    try {
      await checkPotentialProblems(srcExchange, buyFromExchange, sellToExchange)

      let params = {
        symbol,
        buyFrom,
        sellTo,
        profitePercent,
        currencySymbol,
        targetSymbol,
        srcId,
        buyFromId,
        sellToId,
        srcExchange,
        buyFromExchange,
        sellToExchange,
        simulate: trade.simulate,
        simulateBalance: trade.simulateBalance,
      }
      await fetchAddress(params)
      return newBalance
    }
    catch (e) {
      handleError(e)
    }
}

async function waitForWithdrawComplete (exchange, amount, symbol='BTC') {
  log(`---    Waiting for withdraw to complete...`.green)
  return new Promise(async (resolve, reject) => {
    let maxTry = 1000
    let counter = 0
    while (counter < maxTry) {
      counter++
      let balance = await exchange.fetchBalance()
      if (!balance['free']){
        throw new MinorError(`exchange ${exchange.id} fetch balance error, ${JSON.stringify(balance)}`)
      }
      if (balance['free'][symbol] >= amount * 0.8) {
        return resolve(balance['free'][symbol])
      }
      await sleep(10 * 1000)
    }
    return reject('Transfer taking too long')
  })
}

module.exports = {
  sleep,
  handleError,
  largePriceDiff,
  sortByPrice,
  getPotentialTrades,
  makeTrade
}

