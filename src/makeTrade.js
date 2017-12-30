const tasksSortByProfit = require('../savedData/temp_tasksSortByProfit')
const api = require('./api')
const fs = require('fs')
const util = require('util')

function logToFile(initialSimulateBalance, content) {
  fs.appendFileSync(
    `../savedData/simuResult/${initialSimulateBalance}.txt`,
    content
  )
}

async function main(simulateBalance, logFile){
  delete require.cache[require.resolve('../savedData/temp_tasksSortByProfit')]//Clear require cache
  const trades = require('../savedData/temp_tasksSortByProfit')

  // todo: 比特币数量由键盘输入确定（0.05, 0.15, 0.5, 1.5, 5, 10, 30, 100, 300, 1000）
  // todo: 重复这个过程24小时

  //  let trade = {
  //    symbol: 'AST/BTC',
  //    buyFrom: 'huobipro',
  //    purchasePrice: 0.000030435000000000003,
  //    sellTo: 'binance',
  //    sellPrice: 0.000030935,
  //    profitePercent: 0.016428454082470793
  //  }

  //  let trade = {
  //    symbol: 'BAT/BTC',
  //    buyFrom: 'binance',
  //    purchasePrice: 0.000030725,
  //    sellTo: 'huobipro',
  //    sellPrice: 0.000031320000000000005,
  //    profitePercent: 0.01936533767290492
  //  }

  for (let trade of trades) {
    try{
      console.log('\n\n')

      fs.appendFileSync(
        logFile,
        `\n\n ${new Date()} \n simulateBalance ${simulateBalance} \n trade ${JSON.stringify(trade)} \n`
      )

      simulateBalance = await api.makeTrade({...trade, simulate: true, simulateBalance}) || simulateBalance

      fs.appendFileSync(
        logFile,
        `${new Date()} \n new balance ${simulateBalance} \n\n`
      )
    } catch (error) {
      console.error('unusual error', error)
      log('Stop trading immediately'.red)
      break
    }
  }
  return simulateBalance
  //  await api.getPotentialTrades(tickersSortedByPrice, PRICE_DIFF)
}

(async () => {
//  Initial balance
//  let initialSimulateBalance = 0.5
  let initialSimulateBalance = process.env.INITIAL_SIMULATE_BALANCE
  let simulateBalance = initialSimulateBalance
  let logFile = `./savedData/simuResult/${initialSimulateBalance}.txt`
  fs.writeFileSync(
    logFile,
    `${new Date()} \n initialSimulateBalance ${initialSimulateBalance} \n\n`
  )
//  fs.writeFileSync(`./savedData/${fileName}.csv`, csv)

  while (true) {
    simulateBalance = await main(simulateBalance, logFile)
  }
})()
