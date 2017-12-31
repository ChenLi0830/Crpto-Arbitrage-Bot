const ccxt = require('ccxt')
const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const json2csv = require('json2csv');
const fs = require('fs')
const credentials = require('../../credentials')
const util = require('util')

async function checkExchangePublicMethods(exchangeId){
  const exchange = await new ccxt[exchangeId]()
//  await exchange.loadMarkets()
//  log(Object.keys(exchange.markets).join(' ').green)
  log(exchange)
}

//let exchangeId = 'binance'
let exchangeId = 'gateio'
checkExchangePublicMethods(exchangeId)
