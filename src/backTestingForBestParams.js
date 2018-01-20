const log = require('ololog').configure({locate: false})
require('ansicolor').nice;
const utils = require('./utils')
const {
  addMAToExtractedInfoList,
} = utils

const {timeWalk} = require('./klineTimewalk')

let {
  lineLength,
  windows,
  KLINE_FILE,
  PLOT_CSV_FILE,
  intervalInMillesec,
  intervalInMins,
  whiteList,
  dynamicProfitList,
} = require('./config')

/**
 * 测试用，lineLength是用来获得24小时vol时用的
 * */


lineLength = 1 * 24 * 60 / intervalInMins
KLINE_FILE = `./savedData/klines/klines-5m-2d-Jan-19.js`

console.log('KLINE_FILE', KLINE_FILE)
console.log('PLOT_CSV_FILE', PLOT_CSV_FILE)

function test(){

}

(async function main () {
  /**
   * TimeWalk simulation
   * */
  let extractedInfoList = require(`.${KLINE_FILE}`)

  whiteList = require('./config').whiteList
  dynamicProfitList = require('./config').dynamicProfitList
//  process.env['PRODUCTION'] = 'true'
  let bestResult = 0

  try {
    for (let w1 = 3; w1<6; w1++){
      for (let w2 = w1 * 2; w2<25; w2++) {
        for (let w3 = w2 * 2; w3<128; w3++) {
          let windows = [w1, w2, w3]
          console.log('windows', windows)

//          windows = [5, 15, 99]
//          extractedInfoList = addMAToExtractedInfoList(extractedInfoList, windows)
//          let profit1 = await timeWalk(extractedInfoList, windows)
//          console.log('profit1', profit1)

          windows = [4, 50, 128]
          extractedInfoList = addMAToExtractedInfoList(extractedInfoList, windows)
          let profit2 = await timeWalk(extractedInfoList, windows)
          console.log('profit2', profit2)

          process.exit()

          if (profit > bestResult)　{
            bestResult = profit
            console.log(`bestResult ${bestResult}, windows ${windows}`)
          }

        }
      }
    }
  } catch (error) {
    console.error(error)
    log(error.message.red)
  }
})()
