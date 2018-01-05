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
  volumeIndex : 5,
  timeIndex : 0,
  KLINE_FILE : './savedData/klines/klines.js',
  PICKED_TRADE : './savedData/pickedTrade.js',
  blackList : ['TRX/BTC', 'XRP/BTC', 'BCC/BTC', 'AION/BTC'],
}
