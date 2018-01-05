//(async function () {
//  let ccxt = require('ccxt')
//
//  let kraken = new ccxt.kraken({
//    apiKey: 'z6Fon3p748SA5DItl4JxdPT8bMwUZAjybuoHFeuk+vYyOPxsvJyfvHUf',
//    secret: '5HkrvHTggbK/FtF/cgza+fPhkXmBPQy4vvjuNBJn7J/yHO1hXqLw7JFkpLkio6bebhT/HL/SiX49E7y751gkHA=='
//  })
//  let bitfinex = new ccxt.bitfinex({verbose: true})
//  let huobi = new ccxt.huobi()
//  let okcoinusd = new ccxt.okcoinusd()
//
//  await bitfinex.loadMarkets ()
//
//  console.log(bitfinex.symbols)
////  console.log(bitfinex.markets['BTC/USD']['id'])
//
////  console.log(kraken.id, await kraken.loadMarkets())
////  console.log(bitfinex.id, await bitfinex.loadMarkets())
////  console.log(huobi.id, await huobi.loadMarkets())
//
////  console.log(kraken.id, await kraken.fetchOrderBook(kraken.symbols[0]))
////  console.log(bitfinex.id, await bitfinex.fetchTicker('BTC/USD'))
////  console.log(huobi.id, await huobi.fetchTrades('ETH/CNY'))
////
////  console.log(okcoinusd.id, await kraken.fetchBalance())
////
////  //  // sell 1 BTC/USD for market price, sell a bitcoin for dollars immediately
////  //  console.log (okcoinusd.id, await kraken.createMarketSellOrder ('BTC/USD', 1))
////
////  // buy 1 BTC/USD for $2500, you pay $2500 and receive ฿1 when the order is closed
////  console.log(kraken.id, await kraken.createLimitBuyOrder('BTC/USD', 1, 2500.00))
////
////  // pass/redefine custom exchange-specific order params: type, amount, price or whatever
////  // use a custom order type
//////  bitfinex.createLimitSellOrder('BTC/USD', 1, 10, {'type': 'trailing-stop'})
//})()
//

//const _ = require('lodash')
//
//let arr = [{a:1}, {a:3}, {a:2}, {a:0}];
//
//let sorted = _.sortBy(arr, item => item.a)
//
//console.log('sorted', sorted)
//

const tickersSortedByPrice = require('../savedData/temp_tickersSortedByPrice')
const api = require('./api')
const fs = require('fs')
const util = require('util')
const PRICE_DIFF = 0.01
const credentials = require('../credentials.js')
const ccxt = require('ccxt')

//async function main(){
//  let exchangeId = 'hitbtc2'
//  let exchange = new ccxt[exchangeId](ccxt.extend(credentials[exchangeId]))
//  let sellToId = 'binance'
//  let sellExchange = new ccxt[sellToId](ccxt.extend(credentials[sellToId]))
//    //
////  let result = await exchange.privatePostNewAddress('BTC')
////
//////  let result = await huobipro.fetchBalance()
////  console.log(result)
//
//  /** trading account to account */
////  let amount = 0.01008149
////  let transferResult = await exchange.private_post_account_transfer({'currency': 'BTC', 'amount': amount, 'type': 'exchangeToBank'})
////  console.log(`transferResult`, transferResult)
//
////  /** wait for withdraw*/
////  let srcBtcAmount = 0.00858149
////  let currencySymbol = 'BTC'
////  let BTCAmount = await api.waitForWithdrawComplete(exchange, srcBtcAmount, currencySymbol)
////  console.log(`hitbtc2 transfer finished! BTCAmount ${BTCAmount}`)
////
////  /** buy coin */
////  let transferResult = await exchange.private_post_account_transfer({'currency': 'BTC', 'amount': BTCAmount, 'type': 'bankToExchange'})
////  console.log(`transferResult`, transferResult)
//
//  /** buy target */
////  let symbol = 'BTG/BTC'
////  let maxAmount = 0.4
////  let result = await exchange.createMarketBuyOrder(symbol, maxAmount)
////  console.log('result', result)
//
////  /** transfer target currency from main account to trading account */
//  let targetSymbol = 'BTG'
//  let boughtAmount = (await exchange.fetchBalance())['free'][targetSymbol]
//  console.log('boughtAmount', boughtAmount)
//
//  let sellToAddress = await api.getAddress(sellExchange, targetSymbol)
//  console.log(`sellToAddress`, sellToAddress)
//
//  let transferResult = await exchange.private_post_account_transfer({'currency': targetSymbol, 'amount': boughtAmount, 'type': 'exchangeToBank'})
//  console.log(`---    transferResult${JSON.stringify(transferResult)}`)
//
//  let fee = 0
//  if (exchange.fees && exchange.fees.funding && exchange.fees.funding.withdraw) {
//    fee = exchange.fees.funding.withdraw[targetSymbol] || 0
//  }
//
//  exchange.withdraw(targetSymbol, boughtAmount - fee, sellToAddress, {name: `${sellToId} address`})
//
////  let targetAmount = await api.waitForWithdrawComplete(sellExchange, boughtAmount, targetSymbol)
////  console.log('targetAmount', targetAmount)
//
//}

async function main() {
  let exchange = new ccxt.binance()
  await exchange.loadMarkets()
  let result = exchange.currencies
  console.log(exchange.currencies)
  console.log(exchange.markets)
}

//console.log('tickersSortedByPrice', tickersSortedByPrice)
//getPotentialTrades(tickersSortedByPrice)


//console.log('tickersSortedByPrice', tickersSortedByPrice)
main()
//getPotentialTrades(tickersSortedByPrice)
