"use strict";

const ccxt = require ('ccxt')
const asTable = require ('as-table')
const log = require ('ololog')

require ('ansicolor').nice;

(async function test () {

    const exchange = new ccxt.bitfinex ()
    const orders = await exchange.fetchOrderBook ('LTC/BTC', {
        'limit_bids': 10, // max = 50
        'limit_asks': 10, // may be 0 in which case the array is empty
        'group': 1, // 1 = orders are grouped by price, 0 = orders are separate
    })
//  const orders = await exchange.fetchL2OrderBook ('BTC/USD', {
//    'limit_bids': 5, // max = 50
//    'limit_asks': 5, // may be 0 in which case the array is empty
//    'group': 1, // 1 = orders are grouped by price, 0 = orders are separate
//  })

    log (orders)
}) ()
