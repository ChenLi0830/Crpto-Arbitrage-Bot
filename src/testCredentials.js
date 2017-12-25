let ccxt = require('ccxt')
const credentials = require('../credentials.js')
const api = require('./api')

async function fetchBalance(exchangeId){
  let exchange = new ccxt[exchangeId] (ccxt.extend({enableRateLimit: true}, credentials[exchangeId]))

  let balance = await exchange.fetchBalance()
  console.log(`${exchangeId} credential is working: BTC balance is ${balance['free']['BTC']}`)
}

async function fetchAll(){
  let promises = Object.keys(credentials).map(exchangeId => {
    return fetchBalance(exchangeId)
  })
  await Promise.all(promises)
}

(async () => {
  try {
//    await fetchAll()
    await fetchBalance('quadrigacx')
  } catch (e) {
    api.handleError(e)
  }
}) ()
