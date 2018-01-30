const credentials = require('../credentials')
const Manager = require('./Manager')
const config = require('./config')
const ccxt = require('ccxt')
const {
  numberOfPoints,
  padding,
  windows,
  useVolAsCriteria,
  whiteList,
  blackList,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVol,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList,
  useLockProfit,
  isSimulation,
  simuBalance,
  simuTradingFee,
  simuDuration,
  simuEndTime,
  simuTimeStepSize,
  exchangeId,
  intervalInMillesec
} = config

let params = {
  numberOfPoints,
  padding,
  windows,
  useVolAsCriteria,
  whiteList,
  blackList,
  longVolSymbolNo,
  shortVolSymbolNo,
  longVolWindow,
  shortVolWindow,
  logTopVol,
  logTopVolWindow,
  logTopVolSymbolNumber,
  logTopVolThreshold,
  volWindow,
  buyLimitInBTC,
  dynamicProfitList,
  useLockProfit,
  isSimulation
}

async function main () {
  try {
    if (isSimulation) {
      throw new Error('isSimulation in config must be false to run in production')
    }
    let exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials[exchangeId]))
    let manager = new Manager(exchange, credentials[exchangeId], params)
    await manager.start()
  }
  catch (error) {
    console.log(error)
  }
}

main()
