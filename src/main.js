const credentials = require('../credentials')
const Manager = require('./Manager')
const config = require('./config')

const {
    numberOfPoints,
    padding,
    windows,
    volWindow,
    whiteList,
    blackList,
    buyLimitInBTC,
    dynamicProfitList,
    useLockProfit,
    useVolAsCriteria,
    longVolSymbolNo,
    shortVolSymbolNo,
    longVolWindow,
    shortVolWindow,
    logTopVol,
    logTopVolWindow,
    logTopVolSymbolNumber,
    logTopVolThreshold,
} = config

let exchangeId = 'binance'
let params = {
  numberOfPoints,
  padding,
  windows,
  volWindow,
  whiteList,
  blackList,
  buyLimitInBTC,
  dynamicProfitList,
  useLockProfit,
  useVolAsCriteria,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVol,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
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
