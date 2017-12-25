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
  fs.writeFileSync('./temp_tasksSortByProfit.js', 'module.exports = ' +
    util.inspect(tasksSortByProfit), 'utf-8')
  console.log('worthTasks', worthTasks)
  return tasksSortByProfit
}

async function makeTrade (trade) {
  const {
    symbol,
    buyFrom,
    purchasePrice,
    sellTo,
    sellPrice,
    profitePercent
  } = trade
  let targetSymbol = symbol.split('/')[0]
  const enableRateLimit = true
  const verbose = false
  let srcId = 'binance'
  let buyFromId = buyFrom
  let sellToId = sellTo
  let srcExchange = new ccxt[srcId](
    ccxt.extend({enableRateLimit, verbose}, credentials[srcId]))

  let buyFromExchange = new ccxt[buyFromId](
    ccxt.extend({enableRateLimit, verbose}, credentials[buyFromId]))

  let sellToExchange = new ccxt[sellToId](
    ccxt.extend({enableRateLimit, verbose}, credentials[sellToId]))

  try {
    // check the balance
    if (!srcExchange.apiKey || !buyFromExchange.apiKey ||
      !sellToExchange.apiKey) {
      throw new Error('makeTrade initialization error')
    }
    let balance = await srcExchange.fetchBalance()
    let currency = 'BTC'
    console.log(srcExchange.id, `${currency} balance ${balance['free'][currency]}`)

    //    // withdraw - BTC from binance to wherever
    let withdrawBTCAmount = 0.005
    let toBTCAddress = '149Zhnmertkcwzt6UVRnwcna2fCT1z49E9'
    //    let result = await srcExchange.withdraw('BTC', withdrawBTCAmount, toBTCAddress, {name: `${buyFromId} address`})
    //
    //    console.log('withDrawResult', result)

//    //  fetchBalance
//    await waitForWithdrawComplete(buyFromExchange, withdrawBTCAmount)
//    console.log(
//      `Withdraw ${withdrawBTCAmount} BTC from ${srcId} to ${buyFromId} complete`)

//    let buyFromBalance = await buyFromExchange.fetchBalance()
//    console.log('buyFromBalance balance', buyFromBalance)

//    //  createOrder - buy
//    let maxAmount = withdrawBTCAmount / purchasePrice
//    console.log('symbol', symbol, 'maxAmount', maxAmount)
//    let purchaseResult = await buyFromExchange.createMarketBuyOrder(symbol, maxAmount*0.1)
//    console.log('purchaseResult', purchaseResult)

//    // get address to send coin for selling
//    console.log('sellSymbol', targetSymbol)
//    let sellToAddress = await sellToExchange.fetchDepositAddress(targetSymbol)
//    console.log('sellToAddress', sellToAddress)
//
//    if (sellToAddress.status !== 'ok') {
//      throw new Error(`Can not get coin address for ${targetSymbol}`)
//    }

    // check filled balance
//    console.log('buyFromExchange', Object.keys(buyFromExchange))
//    console.log('buyFromExchange', buyFromExchange)
    let boughtBalance = await buyFromExchange.fetchBalance()//['free'][targetSymbol]
    console.log('boughtBalance', boughtBalance)

    // Transfer target symbol currency to sellToExchange
//    let result = await buyFromExchange.withdraw(targetSymbol, withdrawBTCAmount, toBTCAddress, {name: `${buyFromId} address`})


//    console.log(srcExchange.id, `${currency} balance ${balance['free'][currency]}`)
//
//    let result = await buyFromExchange.withdraw(sellSymbol, withdrawBTCAmount, toBTCAddress, {name: `${buyFromId} address`})
//
//    console.log('withDrawResult', result)

    //  createOrder - sell
    //  createOrder (symbol, type, side, amount[, price[, params]])

    //  fetchOpenOrders

    //  exchange.withdraw (currency, amount, address, params = {})
  }
  catch (e) {
    handleError(e)
  }
}

async function waitForWithdrawComplete (exchange, amount) {
  return new Promise(async (resolve, reject) => {
    let maxTry = 1000
    let counter = 0
    while (counter < maxTry) {
      counter++
      await sleep(10 * 1000)
      let balance = await exchange.fetchBalance()
      if (balance['free']['BTC'] >= amount - 0.001) {
        return resolve()
      }
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

