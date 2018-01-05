async function checkMarket(exchangeId){
  const {getMarkets} = require('./utils')
  await getMarkets(exchangeId)
}

let exchangeId = 'binance'

checkMarket(exchangeId)
