const ccxt = require('ccxt')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const fs = require('fs')
const util = require('util')
const _ = require('lodash')
require('ansicolor').nice
const credentials = require('../credentials.js')
const {MinorError} = require('./utils/errors')

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

  const buyFromOrders = await buyExchange.fetchOrderBook (symbol)
  const sellToOrders = await sellExchange.fetchOrderBook (symbol)

  let weightedBuy = weightedPrice(buyFromOrders.asks, BTCVol)
  let weightedSell = weightedPrice(sellToOrders.bids, BTCVol)

  log(`---    Fetched ${symbol} tradeBuy(${JSON.stringify(weightedBuy)})`.green)
  log(`---    Fetched ${symbol} weightedSell(${JSON.stringify(weightedSell)})`.green)

  let weightedProfit = (weightedSell.price - weightedBuy.price) / weightedBuy.price
  if (weightedBuy.accumulatedBTCVol < BTCVol) {
    throw new MinorError(`weightedBuy doesn't have enough volume ${weightedBuy.accumulatedBTCVol} < ${BTCVol}`)
  }
  if (weightedSell.accumulatedBTCVol < BTCVol) {
    throw new MinorError(`weightedSell doesn't have enough volume ${weightedSell.accumulatedBTCVol} < ${BTCVol}`)
  }
  log(`------ Checking Current Benefit of the Trade ------`, '\n')
  return {sellPrice: weightedSell.tradePrice, buyPrice: weightedBuy.tradePrice, weightedProfit}
}

async function checkPotentialProblems(srcExchange, buyFromExchange, sellToExchange){
  /** pre-check potential problems */
  if (!srcExchange.apiKey || !buyFromExchange.apiKey ||
    !sellToExchange.apiKey) {
    throw new Error('makeTrade initialization error')
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

    throw new Error(`buyFromExchange or sellToExchange lack methods: ${buyFromExchange.id}, ${sellToExchange.id}`)
  }
}

async function getAddress(exchange, currencySymbol) {
  if (!exchange.fetchDepositAddress && !exchange.currencyAddressList[currencySymbol]) {
    throw new Error(`${exchange.id} doesn't have ${currencySymbol} address!`)
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

  log(`------ Fetching Addresses ------`)
  let srcBTCAddress = await getAddress(srcExchange, currencySymbol)
  log(`---    srcBTCAddress: ${srcBTCAddress}`.green)
  let buyFromAddress = await getAddress(buyFromExchange, currencySymbol)
  log(`---    buyFromAddress: ${buyFromAddress}`.green)
  let sellToAddress = await getAddress(sellToExchange, targetSymbol)
  log(`---    sellToAddress: ${sellToAddress}`.green)
  log(`------ Fetching Addresses ------`, '\n')

  await step1({...params, srcBTCAddress, buyFromAddress, sellToAddress})
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

  const ExpectedMinProfit = 0.03

  log(`------ Step1: Check Src Exchange Balance ------`)
  let balance = await srcExchange.fetchBalance({'recvWindow': 60*10*1000})
  let srcBtcAmount = balance['free'][currencySymbol]
  log(`---    ${srcExchange.id}: ${currencySymbol} balance ${srcBtcAmount}`.green)
  log(`------ Step1: Check Src Exchange Balance ------`, '\n')

  srcBtcAmount = 50
  /** checkTradeBenefit */
  let {sellPrice, buyPrice, weightedProfit} = await checkTradeBenefit(buyFromExchange, sellToExchange, symbol, srcBtcAmount)
  if (weightedProfit < ExpectedMinProfit) {
    throw new MinorError('weightedProfit too small')
  }
  /** checkTradeBenefit */

  await step2({...params, balance, srcBtcAmount})
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
    log(`---    transfer ${currencySymbol} from ${srcId} to ${buyFromId}`.green)
    let srcWithdrawResult = await srcExchange.withdraw(currencySymbol, srcBtcAmount, buyFromAddress, {name: `${buyFromId} address`})
    let step2SuccessStatus = srcWithdrawResult.info.success
    log(`---    transfer BTC result ${step2SuccessStatus}`.green)
    if (!step2SuccessStatus) {
      log(`---    error`.green, srcWithdrawResult)
      throw new MinorError('Withdraw balance failed!')
    }

    buyFromBTCAmount = await waitForWithdrawComplete(buyFromExchange, srcBtcAmount, currencySymbol)
    log(`---    Withdraw BTC from ${srcId} to ${buyFromId} complete`.green)
    log(`---    ${srcBtcAmount} transferred, buyFrom new balance ${buyFromBTCAmount}`.green)
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
  const ExpectedMinProfit = 0.03
  let {sellPrice, buyPrice, weightedProfit} = await checkTradeBenefit(buyFromExchange, sellToExchange, symbol, srcBtcAmount)
  if (weightedProfit < ExpectedMinProfit) {
    throw new MinorError('weightedProfit too small')
    //  Todo Transfer BTC back to SRC, and check for next trade
  }
  /** checkTradeBenefit */

  try {
    log(`------ Step3: Buy target currency at buyFrom exchange ------`)
    let maxAmount = buyFromBTCAmount / buyPrice
    log(`---    1st time purchase ${symbol} ${maxAmount} - `.green)
    let purchaseResult = await buyFromExchange.createMarketBuyOrder(symbol, maxAmount)
    log(`---    1st time purchase result - `.green, purchaseResult)

    log(`---    fetching buyFrom btc balance - `.green)
    let balance = await buyFromExchange.fetchBalance({'recvWindow': 60*10*1000})
    buyFromBTCAmount = balance['free'][currencySymbol]
    log(`-      balance result ${currencySymbol} ${buyFromBTCAmount}`)
    log(`---    fetching buyFrom btc balance - `.green)

    maxAmount = buyFromBTCAmount / buyPrice
    log(`---    2nd time purchase ${symbol} ${maxAmount} - `.green)
    purchaseResult = await buyFromExchange.createMarketBuyOrder(symbol, maxAmount)
    log(`---    2nd time purchase result - `.green, purchaseResult)

    log(`------ Step3: Buy target currency at buyFrom exchange ------`, '\n')
  } catch (e) {
    handleError(e)
  }

  await step4({...params})
}

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
  } = params

  /** Check target currency balance at buyFrom exchange*/
  let boughtAmount = (await buyFromExchange.fetchBalance())['free'][targetSymbol]
  console.log('boughtAmount', boughtAmount)

  /** Transfer target currency to sellToExchange */
  let buyFromWithdrawResult = await buyFromExchange.withdraw(targetSymbol, boughtAmount, sellToAddress, {name: `${sellToId} address`})
  console.log('Transfer target currency to sellToExchange', buyFromWithdrawResult)

  /** Wait for the transfer to complete */
  let sellToTargetAmount = await waitForWithdrawComplete(sellToExchange, boughtAmount, targetSymbol)
  console.log(`Withdraw ${targetSymbol} from ${buyFromId} to ${sellToId} complete`)
  console.log(`${boughtAmount} transferred, ${sellToTargetAmount} received`)

  await step5({...params, sellToTargetAmount})
}

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

  /** checkTradeBenefit */
  const ExpectedMinProfit = -0.03
  let {sellPrice, buyPrice, weightedProfit} = await checkTradeBenefit(buyFromExchange, sellToExchange, symbol, srcBtcAmount)
  if (weightedProfit < ExpectedMinProfit) {
    throw new MinorError('weightedProfit too small')
    // Todo: wait for better profit
  }
  /** checkTradeBenefit */

  /** Sell target currency for BTC at sellTo exchange */
  console.log('symbol', symbol, 'targetAmount', sellToTargetAmount)
  let sellResult = await sellToExchange.createMarketSellOrder(symbol, sellToTargetAmount)
  console.log('sellResult', sellResult)
  await step6({...params})
}

async function step6(params) {

  /** Check BTC balance at sellTo exchange */
  let sellToBTCAmount = (await sellToExchange.fetchBalance())['free']['BTC']
  console.log('sellToBTCAmount', sellToBTCAmount)

  /** transfer BTC back to source exchange */
  if (sellToId !== srcId) {
    console.log(`transfer ${currencySymbol} from ${sellToId} to ${srcId}`)
    let sellToWithdrawResult = await sellToExchange.withdraw(currencySymbol, sellToBTCAmount, srcBTCAddress, {name: `${sellToId} address`})
    console.log('sellToWithdrawResult', sellToWithdrawResult)
  }

  /** Wait for the transfer to complete */
  let srcBTCAmountNew = await waitForWithdrawComplete(srcExchange, sellToBTCAmount, currencySymbol)
  console.log(`Withdraw BTC from ${sellToId} to ${srcId} complete`)
  console.log(`${sellToBTCAmount} transferred, ${srcBTCAmountNew} received`)
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
  log(`---    target currency: ${targetSymbol}`.green)
  log(`---    buy from: ${buyFromId}`.green)
  log(`---    sell to: ${sellToId}`.green)
  log(`------ Preparing trade ------`, '\n')

  let srcExchange = new ccxt[srcId](
    ccxt.extend({enableRateLimit, verbose}, credentials[srcId]))

  let buyFromExchange = new ccxt[buyFromId](
    ccxt.extend({enableRateLimit, verbose}, credentials[buyFromId]))

  let sellToExchange = new ccxt[sellToId](
    ccxt.extend({enableRateLimit, verbose}, credentials[sellToId]))

  await checkPotentialProblems(srcExchange, buyFromExchange, sellToExchange)

  /** Start trading */
    try {
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
      }
      await fetchAddress(params)

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

