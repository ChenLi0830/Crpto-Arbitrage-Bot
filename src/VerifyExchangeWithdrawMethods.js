let ccxt = require('ccxt')
const credentials = require('../credentials.js')
const api = require('./api')

async function fetchBalance (exchangeId) {
  let exchange = new ccxt[exchangeId](
    ccxt.extend({enableRateLimit: true}, credentials[exchangeId]))

  let balance = await exchange.fetchBalance()
  if (balance['free'] && !isNaN(balance['free']['BTC'])) {
    console.log(
      `${exchangeId} credential is working: BTC balance is ${balance['free']['BTC']}, hasFetchOrderBook: ${exchange.hasFetchOrderBook}`)
    //    console.log(`${exchangeId} hasFetchOrderBook: ${exchange.hasFetchOrderBook}`)
  }
  else {
    console.log(exchangeId, balance, 'hasFetchOrderBook: ',
      exchange.hasFetchOrderBook)
    //    console.log(`${exchangeId} credential abnormal: `, Object.keys(balance))
  }
}

async function fetchAll () {
  let promises = Object.keys(credentials).map(exchangeId => {
    return fetchBalance(exchangeId)
  })
  await Promise.all(promises)
}

(async () => {
  const credentials = require('../credentials')
  const exchangeAddressList = {}
  let exchanges = []

  /** generate exchanges */
  for (let id of Object.keys(credentials)) {
    let exchange = new ccxt[id](
      ccxt.extend({enableRateLimit: true, verbose: true}, credentials[id]))
    exchanges.push(exchange)
  }

  for (let exchange of exchanges) {
    let id = exchange.id
    exchangeAddressList[id] = {}

    let currency = 'BTC'
    let newAddress = {}
    try {
      newAddress[currency] = await api.getAddress(exchange, currency)
    }
    catch (e) {
      console.log(e)
    }
    console.log(id, newAddress[currency])
    exchangeAddressList[id] = {...exchangeAddressList[id], ...newAddress}
    //    break
  }

  console.log('\n\n')

  let currency = 'BTC'

  for (let exchange of exchanges) {
    let id1 = exchange.id

    if (id1 !== 'quadrigacx') continue
//      hitbtc2
//      quadrigacx

    for (let otherExchange of exchanges) {
      let id2 = otherExchange.id
      if (id2 !== 'binance') {
//      if (id2 !== 'quadrigacx') {
//        poloniex
        continue
      }

      try {
//        let btcBalance = (await hitbtc2.fetchBalance({type:'trading'}))['free'].BTC
//        let btcBalance = (await exchange.fetchBalance({type:'account'}))['free'].BTC
        let btcBalance = (await exchange.fetchBalance({type:'account'}))['free'].BTC
        console.log('btcBalance', btcBalance)
        let result = await exchange.withdraw(currency, btcBalance, exchangeAddressList[id2][currency], {name: `${id2} address`, chargefee: 0.000})
        console.log('result', result)
      }
      catch (e) {
        console.log(`Can't withdraw from ${id1} to ${id2}`)
        console.log(e)
      }
    }
  }

  //    credentials[id]
  //    kraken:
  //    {
  //      apiKey: 'Qwuorj+/DUf9aMWksVrP3U7S5YEHVNe83T/bn3iN5SlLM2MxjQ98rss7',
  //        secret: 'tYYvpI4Ul+1zSooV08uCnYBhwsVXcj1TFI0A79n25SUmJ4R0SZALkzbxKBnr+VNWBXDZ5csPKdV162zpYe0m7Q==',
  //      currencyAddressList: {},
  //      _fetchDepositAddress: true,
  //        _withdraw: true
  //    },

  //    await buyFromExchange.withdraw(targetSymbol, 0, sellToAddress, {name: `${buyFromId} address`, chargefee: 0.001, method: 'limit'})

  try {
    //    await fetchAll()
    //    await buyFromExchange.withdraw(targetSymbol, 0, sellToAddress, {name: `${buyFromId} address`, chargefee: 0.001, method: 'limit'})
    //    await fetchBalance('quadrigacx')
  }
  catch (e) {
    api.handleError(e)
  }
})()
