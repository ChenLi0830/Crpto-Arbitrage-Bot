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
    return ((a - b) / b) > percentage
  }
}

const weightedPrice = (priceAmountList, BTCVol=0.01) => {
  let amount = 0
  let totalPrice = 0
  let accumulatedBTCVol = 0
  for (let [price, vol] of priceAmountList) {
    accumulatedBTCVol += price * vol
    totalPrice += price * vol
    amount += vol

    if (accumulatedBTCVol > BTCVol) break
  }
  log(`accumulatedBTCVol ${accumulatedBTCVol}, totalPrice / amount ${totalPrice / amount}`.green)
  return totalPrice / amount
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

        let weightedBuy = weightedPrice(buyFromOrders.asks, BTCVol) || exchangePrices[lowIndex].price
        let weightedSell = weightedPrice(sellToOrders.bids, BTCVol) || exchangePrices[highIndex].price

        log(`Fetched ${symbol} weightedBuy(${weightedBuy}) and weightedSell(${weightedSell})`.cyan)
//        console.log(`Fetched ${symbol} from ${buyExchange.id}(${weightedPrice(buyFromOrders.asks)}) and ${sellExchange.id}(${weightedPrice(sellToOrders.bids)})`)

        if (largePriceDiff(weightedSell, weightedBuy, PRICE_DIFF)) {
          // found task
          worthTasks.push({
            symbol: symbol,
            buyFrom: exchangePrices[lowIndex].exchangeId,
            buyPrice: exchangePrices[lowIndex].price,
            sellTo: exchangePrices[highIndex].exchangeId,
            sellPrice: exchangePrices[highIndex].price,
            asks: JSON.stringify(buyFromOrders.asks.slice(0,5)),
            profitPercent: (exchangePrices[highIndex].price - exchangePrices[lowIndex].price) / exchangePrices[lowIndex].price,
            weightedBuyPrice: weightedBuy,
            weightedSellPrice: weightedSell,
            weightedProfitPercent: (weightedSell - weightedBuy) / weightedBuy,
            bids: JSON.stringify(sellToOrders.bids.slice(0,5)),
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

  /** Check if exchange has all methods */
  let requiredMethods = [
    srcExchange.withdraw,
    buyFromExchange.withdraw,
    sellToExchange.withdraw,
    buyFromExchange.createMarketBuyOrder,
    sellToExchange.createMarketSellOrder,
  ].map(item => !!item)

  if (!_.every(requiredMethods)) {
    console.log(`buyFromExchange or sellToExchange lack methods: ${buyFromId}, ${sellToId}`)
    let methods = [
      'srcExchange.withdraw',
      'buyFromExchange.withdraw',
      'sellToExchange.withdraw',
      'buyFromExchange.createMarketBuyOrder',
      'sellToExchange.createMarketSellOrder',
    ]
    methods.forEach((method, index) => log(`${method}: ${requiredMethods[index]}`))
    return
  }

  let exchanges = [srcExchange, buyFromExchange, sellToExchange]
  let addresses = await Promise.all(exchanges.map(async exchange => {
    if (!exchange.fetchDepositAddress && !exchange.currencyAddressList[currencySymbol]) {
      log(`${exchange.id} doesn't have ${currencySymbol} address!`.red)
      return
    } else {
      return exchange.currencyAddressList[currencySymbol] || exchange.fetchDepositAddress && (await exchange.fetchDepositAddress(currencySymbol)).address
    }
  }))

  if (!_.every(addresses, address => !!address)) {
    log(`Stopping trading - Fetching addresses error!`.red)
    return
  }

  let [srcBTCAddress, buyFromAddress, sellToAddress] = addresses
  log('addresses: ', [srcBTCAddress, buyFromAddress, sellToAddress].join(' ').yellow)

  /** Start trading */
  //  try {
  //
  //    /** Check BTC balance - source exchange */
  //    let balance = await srcExchange.fetchBalance()
  //    let srcBtcAmount = balance['free'][currencySymbol]
  //    console.log(srcExchange.id, `${currencySymbol} balance ${srcBtcAmount}`)
  //
  //    /** Transfer BTC from source exchange to buyFrom exchange */
  //    if (buyFromId !== srcId) {
  //      console.log(`transfer ${currencySymbol} from ${srcId} to ${buyFromId}`)
  //      let srcWithdrawResult = await srcExchange.withdraw(currencySymbol, srcBtcAmount, buyFromAddress, {name: `${buyFromId} address`})
  //      console.log('transfer BTC result', srcWithdrawResult)
  //    }
  //
  //    /** Wait for the transfer to complete */
  //    let buyFromBTCAmount = await waitForWithdrawComplete(buyFromExchange, srcBtcAmount, currencySymbol)
  //    console.log(`Withdraw BTC from ${srcId} to ${buyFromId} complete`)
  //    console.log(`${srcBtcAmount} transferred, ${buyFromBTCAmount} received`)
  //
  //    /** Buy target currency at buyFrom exchange*/
  //    let maxAmount = buyFromBTCAmount / purchasePrice
  //    console.log('symbol', symbol, 'maxAmount', maxAmount)
  //    let purchaseResult = await buyFromExchange.createMarketBuyOrder(symbol, maxAmount * 0.3)
  //    console.log('purchaseResult', purchaseResult)
  //    /** Todo handle buy fail or not filled */
  //
  //    /** Check target currency balance at buyFrom exchange*/
  //    let boughtAmount = (await buyFromExchange.fetchBalance())['free'][targetSymbol]
  //    console.log('boughtAmount', boughtAmount)
  //
  //    /** Transfer target currency to sellToExchange */
  //    let buyFromWithdrawResult = await buyFromExchange.withdraw(targetSymbol, boughtAmount, sellToAddress, {name: `${sellToId} address`})
  //    console.log('Transfer target currency to sellToExchange', buyFromWithdrawResult)
  //
  //    /** Wait for the transfer to complete */
  //    let sellToTargetAmount = await waitForWithdrawComplete(sellToExchange, boughtAmount, targetSymbol)
  //    console.log(`Withdraw ${targetSymbol} from ${buyFromId} to ${sellToId} complete`)
  //    console.log(`${boughtAmount} transferred, ${sellToTargetAmount} received`)
  //
  //    /** Sell target currency for BTC at sellTo exchange */
  //    console.log('symbol', symbol, 'targetAmount', sellToTargetAmount)
  //    let sellResult = await sellToExchange.createMarketSellOrder(symbol, sellToTargetAmount)
  //    console.log('sellResult', sellResult)
  //
  //    /** Check BTC balance at sellTo exchange */
  //    await sleep(2000)
  //    let sellToBTCAmount = (await sellToExchange.fetchBalance())['free']['BTC']
  //    console.log('sellToBTCAmount', sellToBTCAmount)
  //
  //    /** transfer BTC back to source exchange */
  //    if (sellToId !== srcId) {
  //      console.log(`transfer ${currencySymbol} from ${sellToId} to ${srcId}`)
  //      let sellToWithdrawResult = await sellToExchange.withdraw(currencySymbol, sellToBTCAmount, srcBTCAddress, {name: `${sellToId} address`})
  //      console.log('sellToWithdrawResult', sellToWithdrawResult)
  //    }
  //
  //    /** Wait for the transfer to complete */
  //    let srcBTCAmountNew = await waitForWithdrawComplete(srcExchange, sellToBTCAmount, currencySymbol)
  //    console.log(`Withdraw BTC from ${sellToId} to ${srcId} complete`)
  //    console.log(`${sellToBTCAmount} transferred, ${srcBTCAmountNew} received`)
  //  }
  //  catch (e) {
  //    handleError(e)
  //  }
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

