let ccxt = require('ccxt')
const credentials = require('../credentials.js')
const api = require('./api')

async function fetchBalance(exchangeId){
  let exchange = new ccxt[exchangeId] (ccxt.extend({enableRateLimit: true}, credentials[exchangeId]))

  let balance = await exchange.fetchBalance()
  if (balance['free'] && !isNaN(balance['free']['BTC'])) {
    console.log(`${exchangeId} credential is working: BTC balance is ${balance['free']['BTC']}, hasFetchOrderBook: ${exchange.hasFetchOrderBook}`)
    if (exchange.id === 'hitbtc2') {
      console.log(`${exchangeId} main account BTC balance is ${(await exchange.fetchBalance({'type':'account'}))['free']['BTC']}`)
    }
//    console.log(`${exchangeId} hasFetchOrderBook: ${exchange.hasFetchOrderBook}`)
  } else {
    console.log(exchangeId, balance, 'hasFetchOrderBook: ', exchange.hasFetchOrderBook)
//    console.log(`${exchangeId} credential abnormal: `, Object.keys(balance))
  }
}

async function fetchAll(){
  let promises = Object.keys(credentials).map(exchangeId => {
    return fetchBalance(exchangeId)
  })
  await Promise.all(promises)
}

(async () => {
  try {
    await fetchAll()
//    await fetchBalance('quadrigacx')
  } catch (e) {
    api.handleError(e)
  }
}) ()
