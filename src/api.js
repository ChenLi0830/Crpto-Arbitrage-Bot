const ccxt = require('ccxt')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const fs = require('fs')
const util = require('util')
const _ = require('lodash')
require('ansicolor').nice
const credentials = require('../credentials.js')

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
    return (a - b) / b > percentage
  }
}

const weightedPrice = (priceAmountList) => {
  let amount = 0
  let totalPrice = 0
  priceAmountList.forEach(priceAmountPair => {
    totalPrice += priceAmountPair[0] * priceAmountPair[1]
    amount += priceAmountPair[1]
  })
  return totalPrice / amount
}

async function getPotentialTrades (tickersSortedByPrice, PRICE_DIFF) {
  let worthTasks = []
  for (let tickerKey of Object.keys(tickersSortedByPrice)) {

    if (!tickerKey.endsWith('/BTC')) continue

    let exchangePrices = tickersSortedByPrice[tickerKey]
    let lowIndex = 0
    let highIndex = exchangePrices.length - 1

    while (highIndex > lowIndex &&
    largePriceDiff(exchangePrices[highIndex], exchangePrices[lowIndex],
      PRICE_DIFF)) {

      if (exchangePrices[highIndex].price >
        exchangePrices[lowIndex].price * 2) {
        lowIndex++
        highIndex--
        continue
      }

      worthTasks.push({
        symbol: tickerKey,
        buyFrom: exchangePrices[lowIndex].exchangeId,
        purchasePrice: exchangePrices[lowIndex].price,
        sellTo: exchangePrices[highIndex].exchangeId,
        sellPrice: exchangePrices[highIndex].price,
        profitePercent: (exchangePrices[highIndex].price -
          exchangePrices[lowIndex].price) / exchangePrices[lowIndex].price
      })
      break
      //      let buyExchange = new (ccxt)[exchangePrices[lowIndex].exchangeId]()
      //      let sellExchange = new (ccxt)[exchangePrices[highIndex].exchangeId]()
      //
      //      if (!buyExchange.hasFetchOrderBook) {
      //        lowIndex++
      //        continue
      //      }
      //
      //      if (!sellExchange.hasFetchOrderBook) {
      //        highIndex--
      //        continue
      //      }
      //
      //      console.log(buyExchange.id, sellExchange.id)
      //
      //      try{
      //        const buyFromOrders = await buyExchange.fetchOrderBook (tickerKey, {
      //          'limit_bids': 10, // max = 50
      //          'limit_asks': 10, // may be 0 in which case the array is empty
      //          'group': 1, // 1 = orders are grouped by price, 0 = orders are separate
      //        })
      //
      //        const sellToOrders = await sellExchange.fetchOrderBook (tickerKey, {
      //          'limit_bids': 10, // max = 50
      //          'limit_asks': 10, // may be 0 in which case the array is empty
      //          'group': 1, // 1 = orders are grouped by price, 0 = orders are separate
      //        })
      //
      //        console.log(`Fetched ${tickerKey} (${weightedPrice(buyFromOrders.asks)}) and (${weightedPrice(sellToOrders.bids)})`)
      ////        console.log(`Fetched ${tickerKey} from ${buyExchange.id}(${weightedPrice(buyFromOrders.asks)}) and ${sellExchange.id}(${weightedPrice(sellToOrders.bids)})`)
      //
      //        if (largePriceDiff(weightedPrice(buyFromOrders.asks), weightedPrice(sellToOrders.bids), PRICE_DIFF)) {
      //          // found task
      //          worthTasks.push({
      //            symbol: tickerKey,
      //            buyFrom: exchangePrices[lowIndex].exchangeId,
      //            purchasePrice: exchangePrices[lowIndex].price,
      //            sellTo: exchangePrices[highIndex].exchangeId,
      //            sellPrice: exchangePrices[highIndex].price,
      //            profitePercent: (exchangePrices[highIndex].price - exchangePrices[lowIndex].price) / exchangePrices[lowIndex].price
      //          })
      //          console.log('saving')
      //          break
      //        } else { // change index
      //          let buyPriceDiff = weightedPrice(buyFromOrders.asks) - exchangePrices[lowIndex].price
      //          let sellPriceDiff = exchangePrices[highIndex].price - weightedPrice(sellToOrders.bids)
      //          if (buyPriceDiff > sellPriceDiff) {
      //            lowIndex++
      //          } else {
      //            highIndex--
      //          }
      //        }
      //      }
      //      catch (e) {
      //        handleError(e)
      //      }
    }
  }
  let tasksSortByProfit = _.sortBy(worthTasks, task => -task.profitePercent)
  fs.writeFileSync('./savedData/temp_tasksSortByProfit.js', 'module.exports = ' +
    util.inspect(tasksSortByProfit), 'utf-8')
  console.log('tasksSortByProfit', tasksSortByProfit)
  return tasksSortByProfit
}

async function makeTrade (trade) {
  /** Initialization */
  const {
    symbol,
    buyFrom,
    purchasePrice,
    sellTo,
    sellPrice,
    profitePercent
  } = trade

  let currencySymbol = 'BTC'
  let targetSymbol = symbol.split('/')[0]
  let srcId = 'binance'
  let buyFromId = buyFrom
  let sellToId = sellTo

  const enableRateLimit = true
  const verbose = false

  let srcExchange = new ccxt[srcId](
    ccxt.extend({enableRateLimit, verbose}, credentials[srcId]))

  let buyFromExchange = new ccxt[buyFromId](
    ccxt.extend({enableRateLimit, verbose}, credentials[buyFromId]))

  let sellToExchange = new ccxt[sellToId](
    ccxt.extend({enableRateLimit, verbose}, credentials[sellToId]))

  /** pre-check potential problems */
  if (!srcExchange.apiKey || !buyFromExchange.apiKey ||
    !sellToExchange.apiKey) {
    throw new Error('makeTrade initialization error')
  }

  let requiredMethods = [
    srcExchange.fetchDepositAddress,
    buyFromExchange.fetchDepositAddress,
    sellToExchange.fetchDepositAddress,
    srcExchange.withdraw,
    buyFromExchange.withdraw,
    sellToExchange.withdraw,
    buyFromExchange.createMarketBuyOrder,
    sellToExchange.createMarketSellOrder,
  ]

  if (!_.every(requiredMethods, item => !!item)) {
    console.log(`buyFromExchange or sellToExchange lack methods: ${buyFromId}, ${sellToId}`)
    return
  }

  let srcBTCAddress = (await srcExchange.fetchDepositAddress(currencySymbol)).address
  console.log('srcBTCAddress', srcId, srcBTCAddress)
  let buyFromAddress = (await buyFromExchange.fetchDepositAddress(currencySymbol)).address
  console.log('buyFromAddress', buyFromId, buyFromAddress)
  let sellToAddress = (await sellToExchange.fetchDepositAddress(targetSymbol)).address
  console.log('sellToAddress', sellToId, sellToAddress)

  /** Start trading */
  try {

    /** Check BTC balance - source exchange */
    let balance = await srcExchange.fetchBalance()
    let srcBtcAmount = balance['free'][currencySymbol]
    console.log(srcExchange.id, `${currencySymbol} balance ${srcBtcAmount}`)

    /** Transfer BTC from source exchange to buyFrom exchange */
    if (buyFromId !== srcId) {
      console.log(`transfer ${currencySymbol} from ${srcId} to ${buyFromId}`)
      let srcWithdrawResult = await srcExchange.withdraw(currencySymbol, srcBtcAmount, buyFromAddress, {name: `${buyFromId} address`})
      console.log('transfer BTC result', srcWithdrawResult)
    }

    /** Wait for the transfer to complete */
    let buyFromBTCAmount = await waitForWithdrawComplete(buyFromExchange, srcBtcAmount, currencySymbol)
    console.log(`Withdraw BTC from ${srcId} to ${buyFromId} complete`)
    console.log(`${srcBtcAmount} transferred, ${buyFromBTCAmount} received`)

    /** Buy target currency at buyFrom exchange*/
    let maxAmount = buyFromBTCAmount / purchasePrice
    console.log('symbol', symbol, 'maxAmount', maxAmount)
//    let purchaseResult = await buyFromExchange.createMarketBuyOrder(symbol, maxAmount * 0.2)
//    console.log('purchaseResult', purchaseResult)
    /** Todo handle buy fail or not filled */

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

    /** Sell target currency for BTC at sellTo exchange */
    console.log('symbol', symbol, 'targetAmount', sellToTargetAmount)
    let sellResult = await sellToExchange.createMarketSellOrder(symbol, sellToTargetAmount)
    console.log('sellResult', sellResult)

    /** Check BTC balance at sellTo exchange */
    await sleep(2000)
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
  catch (e) {
    handleError(e)
  }
}

async function waitForWithdrawComplete (exchange, amount, symbol='BTC') {
  log('waiting for withdraw to complete'.green)
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
    return reject('max try exceeded')
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

