module.exports = {
  //const interval = '1d'
  //const intervalInMillesec = 24 * 60 * 60 * 1000
  //const recordNb = 30 // default = 500, use less for large intervals
  //const numberOfFetch = 1 // min = 1, 获取多少次500个点，数字越大，获得的历史数据越多
  //const windows = [2] // 必须从小到大，maximum = 500 - lineLength
  //const lineLength = 2
  
  interval : '5m',
  intervalInMillesec : 5 * 60 * 1000,
  recordNb : 500, // default = 500, use less for large intervals,
  numberOfFetch : 1, // min = 1, 获取多少次500个点，数字越大，获得的历史数据越多,
  windows : [4, 16, 99], // 必须从小到大，maximum = 500 - lineLength,
  lineLength : 50,

  ohlcvIndex : 4, // [ timestamp, open, high, low, close, volume ],
  KLINE_FILE : `./savedData/klines/klines${process.env.PRODUCTION ? '':'-simulate'}.js`,
  KLINE_24H_FILE : `./savedData/klines/klines24H${process.env.PRODUCTION ? '':'-simulate'}.js`,
  PICKED_TRADE : `./savedData/pickedTrade${process.env.PRODUCTION ? '':'-simulate'}.js`,
  PLOT_CSV_FILE: `./savedData/klines/plotCsv${process.env.PRODUCTION ? '':'-simulate'}.csv`,
  topVibratedNo: 2,
  fetchKlineBlackList : [],
//  fetchKlineWhiteList: ['VEN/BTC', 'APPC/BTC', 'BCPT/BTC', 'BNB/BTC', /*'BNB/BTC'*/],

  /**
   * 设置白名单
   * */
  whiteList: [],
  blackList: [],
//  whiteList: [
//    'ETH/BTC',
//    'MANA/BTC'
//  ],

  /**
   * 止盈点
   * */
  dynamicProfitList: [
    {
      multiplier: 3.5,
      percent: 30,
    },
    {
      multiplier: 4,
      percent: 40,
    },
    {
      multiplier: 5.5,
      percent: 20,
    },
  ],
//  dynamicProfitList: [
////    {
////      multiplier: 0.15,
////      percent: 30,
////    },
//    {
//      multiplier: 0.8,
//      percent: 70,
//    },
//    {
//      multiplier: 2,
//      percent: 20,
//    },
//  ],
  numberOfPoints: 24 * 60 / 5,
  padding: 100
}
