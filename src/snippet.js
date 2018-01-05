let ccxt = require('ccxt')
const api = require('./api')
const credentials = require('../credentials')

async function placeholder(){

}

(async () => {
  try {
    let hitbtc2 = new ccxt['hitbtc2'](
      ccxt.extend({enableRateLimit: true, verbose: true}, credentials['hitbtc2']))

    let btcBalance = (await hitbtc2.fetchBalance())['free'].BTC
    console.log(btcBalance)

    let symbol =
    await hitbtc2.createMarketBuyOrder(symbol, maxAmount)
//    let result = await hitbtc2.withdraw('BTC', 0.004, '1FcFhHpoj6ugrxK9LaJwZcsiMH8kWxNFAP', {name: `address`, chargefee: 0.000})
//    console.log('result', result)
  }
  catch(e) {
    console.log(e)
  }
})()
