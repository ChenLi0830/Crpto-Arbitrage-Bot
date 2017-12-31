const tasksSortByProfit = require('../savedData/temp_tasksSortByProfit')
const api = require('./api')
const fs = require('fs')
const util = require('util')
let losingCount = 0
const log = require('ololog').configure({locate: false})
//require('ansicolor').nice

function logToFile(initialSimulateBalance, content) {
  fs.appendFileSync(
    `../savedData/simuResult/${initialSimulateBalance}.txt`,
    content
  )
}

async function main(BtcBalance, logFile, losingCountLimit, losingPercentLimit){
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
    console.log('\n\n')

    fs.appendFileSync(
      logFile,
      `\n\n ${new Date()} \n BtcBalance ${BtcBalance} \n trade ${JSON.stringify(trade)} \n`
    )

    let newBtcBalance = await api.makeTrade({
      ...trade,
      simulate: true,
      simulateBalance: BtcBalance
    }) || BtcBalance

    /** check for balance result */
    if (newBtcBalance < BtcBalance) {
      let lostPercent = Math.trunc(((BtcBalance - newBtcBalance) / BtcBalance) * 100)
      if (lostPercent > losingPercentLimit){
        throw new Error(`Exceeded losingPercentLimit ${losingPercentLimit}%: Lost ${lostPercent}% BTC in last trade, current balance ${newBtcBalance} BTC`)
      }
      losingCount ++
    } else {
      losingCount = 0
    }
    if (losingCount >= losingCountLimit) {
      throw new Error(`losing BTC ${losingCount} times in a row`)
    }

    BtcBalance = newBtcBalance

    fs.appendFileSync(
      logFile,
      `${new Date()} \n new balance ${BtcBalance} \n\n`
    )

    await api.sleep(3*1000)
  }
  return BtcBalance
  //  await api.getPotentialTrades(tickersSortedByPrice, PRICE_DIFF)
}

(async () => {
//  Initial balance
  /** simulation */
  let initialSimulateBalance = process.env.INITIAL_SIMULATE_BALANCE
  let BtcBalance = isNaN(initialSimulateBalance)
    ? 0
    : initialSimulateBalance
  /** simulation */

  /** production */
//  Todo: fetch balance and sign to 'BtcBalance'
  /** production */

  let losingCountLimit = 3
  let losingPercentLimit = 10
  let logFile = `./savedData/simuResult/${initialSimulateBalance}.txt`
  fs.writeFileSync(
    logFile,
    `${new Date()} \n initialSimulateBalance ${initialSimulateBalance} \n\n`
  )
//  fs.writeFileSync(`./savedData/${fileName}.csv`, csv)

  while (true) {
    try {
      simulateBalance = await main(BtcBalance, logFile, losingCountLimit, losingPercentLimit)
    }
    catch (error) {
      console.error('Major error', error)
      log(error.message.red)
      log('Stop trading. Await for admin to determine next step'.red)
      break
    }
  }
})()
