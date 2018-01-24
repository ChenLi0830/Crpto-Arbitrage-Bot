const credentials = require('../credentials')
const Manager = require('./Manager')
const config = require('./config')

const {
  windows,
  numberOfPoints,
  padding,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList,
  logTopVol,
  useLockProfit
} = config

let exchangeId = 'binance'
let params = {
  numberOfPoints,
  padding,
  windows,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList,
  logTopVol,
  useLockProfit
}

async function main () {
  try {
    let manager = new Manager(exchangeId, credentials[exchangeId], params)
    await manager.start()
  }
  catch (error) {
    console.log(error)
  }
}

main()
