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

const tickersSortedByPrice = require('../temp_tickersSortedByPrice')
const api = require('./api')
const fs = require('fs')
const util = require('util')
const PRICE_DIFF = 0.01

async function main(){
//  let trade = {
//    symbol: 'AST/BTC',
//    buyFrom: 'huobipro',
//    purchasePrice: 0.000030435000000000003,
//    sellTo: 'binance',
//    sellPrice: 0.000030935,
//    profitePercent: 0.016428454082470793
//  }
  let trade = {
    symbol: 'ETH/BTC',
    buyFrom: 'quadrigacx',
    purchasePrice: 0.048658325,
    sellTo: 'binance',
    sellPrice: 0.048752500000000004,
    profitePercent: 0.0019354344811499757
  }

  await api.makeTrade(trade)
//  await api.getPotentialTrades(tickersSortedByPrice, PRICE_DIFF)
}

//console.log('tickersSortedByPrice', tickersSortedByPrice)
main()
//getPotentialTrades(tickersSortedByPrice)



//(async () => {
//  let ccxt = require('ccxt')
//  const credentials = require('../credentials.js')
//  let buyFromId = 'quadrigacx'
////  let quadrigacx = new ccxt.quadrigacx ({'uid':'2951523', 'apiKey':'zfEKFeRDnq', 'secret': 'db08537dee388393d2555c2b9cf57bad'})
//  let quadrigacx = new ccxt[buyFromId] (ccxt.extend({enableRateLimit: true}, credentials[buyFromId]))
//  console.log (await quadrigacx.fetchBalance ());
//}) ()
