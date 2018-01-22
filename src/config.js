const moment = require('moment')
/**
 * 貌似没用的
 */
let lineLength = 50
let ohlcvIndex = 4 // [ timestamp, open, high, low, close, volume ],
let KLINE_24H_FILE = `./savedData/klines/klines24H.js`
let PICKED_TRADE = `./savedData/pickedTrade${process.env.PRODUCTION === 'true' ? '' : '-simulate'}-${moment().format('MMM-D-h:mm')}.js`
let topVibratedNo = 2

let interval = '5m'
let intervalInMillesec = 5 * 60 * 1000
let intervalInMins = 5
let recordNb = 500 // default = 500, use less for large intervals,
let numberOfFetch = 1 // min = 1, 获取多少次500个点，数字越大，获得的历史数据越多,

let windows = [4, 16, 99] // 必须从小到大，maximum = 500 - lineLength,
// let windows = [5, 15, 99] // 必须从小到大，maximum = 500 - lineLength,
let KLINE_FILE = `./savedData/klines/klines-${interval}-${Math.round(numberOfFetch * intervalInMins * recordNb / (24 * 60))}d-${moment().format('MMM-D')}.js`
let PLOT_CSV_FILE = `./savedData/klines/plotCsv${process.env.PRODUCTION === 'true' ? '' : '-simulate'}-${moment().format('MMM-D-h:mm')}.csv`
let fetchKlineBlackList = []
let numberOfPoints = 24 * 60 / intervalInMins
let padding = Math.max(...windows)

/**
 * 设置白名单
 * */
let whiteList = []
let blackList = []
//  let whiteList = [
//      'ETH/BTC',
//      'MANA/BTC'
//  ]

/**
 * 止盈点
 * */
let dynamicProfitList = [
  {
    multiplier: 3.5,
    percent: 30
  },
  {
    multiplier: 4,
    percent: 40
  },
  {
    multiplier: 5.5,
    percent: 20
  }
]

module.exports = {
  interval,
  intervalInMillesec,
  intervalInMins,
  recordNb,
  numberOfFetch,
  windows,
  lineLength,
  ohlcvIndex,
  KLINE_FILE,
  KLINE_24H_FILE,
  PICKED_TRADE,
  PLOT_CSV_FILE,
  topVibratedNo,
  fetchKlineBlackList,
  whiteList,
  dynamicProfitList,
  numberOfPoints,
  padding,
  blackList
}
