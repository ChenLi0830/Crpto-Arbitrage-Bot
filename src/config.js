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

let windows = [7, 16, 120] // 必须从小到大，maximum = 500 - lineLength,
// let windows = [5, 15, 99] // 必须从小到大，maximum = 500 - lineLength,
let KLINE_FILE = `./savedData/klines/klines-${interval}-${Math.round(numberOfFetch * intervalInMins * recordNb / (24 * 60))}d-${moment().format('MMM-D')}.js`
let fetchKlineBlackList = []
let numberOfPoints = 24 * 60 / intervalInMins
if (numberOfPoints < Math.max(...windows)) {
  throw new Error('numberOfPoints must be larger than the max value of windows')
}
let padding = Math.max(...windows)

/**
 * 常换变量
 * */
//  let whiteList = [
//      'ETH/BTC',
//      'MANA/BTC'
//  ]
let exchangeId = 'binance'
let whiteList = []
let blackList = ['ETH/BTC', 'BNB/BTC']
let longVolSymbolNo = 10 // 用长期vol选多少个候选币
let shortVolSymbolNo = 2 // 用短期vol选多少个候选币
let longVolWindow = 24 * 60 / 5 // 长期vol window是多长
let shortVolWindow = 4 * 60 / 5 // 短期vol window是多长
let logTopVol = false //  是否显示 Volume 白名单候选币
let logTopVolWindow = 15 / 5 // 显示 Volume 白名单候选币，观察几个点
let logTopVolSymbolNumber = 10 // 显示 Volume 白名单候选币，显示几个
let logTopVolThreshold // 显示 Volume 白名单候选币，threshold
let volWindow = 48 // volume均线的window
let buyLimitInBTC = 1 // 最多每个worker花多少BTC买币
let useLockProfit = false // 是否开启止盈保本
let useVolAsCriteria = true // 是否用volume作为选币依据
let isSimulation = false // 是否使用模拟模式
let simuBalance = 1 // 初始 BTC Balance
let simuTradingFee = 0.0005 // 交易费
let simuDuration = 1 * 24 * 60 * 60 * 1000 + numberOfPoints * intervalInMillesec // 模拟进行时长，单位为毫秒
let simuEndTime = undefined // 截止至什么时候 in epoch time，undefined默认为截止至当下
let simuTimeStepSize = 5 * 60 * 1000 // 模拟中每步的步长
let PLOT_CSV_FILE = `./savedData/klines/plotCsv${isSimulation ? '-simulate' : ''}-${moment().format('MMM-D-h:mm')}.csv`
/**
 * 止盈点
 * */
let dynamicProfitList = [
  {
    multiplier: 1,
    percent: 30
  },
  {
    multiplier: 3,
    percent: 50
  },
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
  exchangeId,
  whiteList,
  dynamicProfitList,
  numberOfPoints,
  padding,
  blackList,
  useVolAsCriteria,
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
  useLockProfit,
  isSimulation,
  simuBalance,
  simuTradingFee,
  simuDuration,
  simuEndTime,
  simuTimeStepSize
}
