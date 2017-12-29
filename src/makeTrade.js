const tasksSortByProfit = require('../savedData/temp_tasksSortByProfit')
const api = require('./api')
const fs = require('fs')
const util = require('util')

async function main(){
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

  let trade = { symbol: 'B2X/BTC',
    buyFrom: 'yobit',
    buyPrice: 0.025095625,
    sellTo: 'hitbtc2',
    sellPrice: 0.0319,
    asks: '[[0.0254144,0.03397364],[0.02541441,0.02750473],[0.02578601,0.137067],[0.0259,0.43851046],[0.02598441,1.17203244]]',
    profitPercent: 0.27113789754190215,
    weightedBuyPrice: 0.026557818756645517,
    weightedSellPrice: 0.029213896547795378,
    weightedProfitPercent: 0.10001114231134794,
    bids: '[[0.02973,0.001],[0.02972,0.122],[0.02971,0.763],[0.02969,0.6],[0.02968,0.1]]' }

  await api.makeTrade(trade)
  //  await api.getPotentialTrades(tickersSortedByPrice, PRICE_DIFF)
}

main()
