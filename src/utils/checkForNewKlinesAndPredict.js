const {intervalInMillesec, exchangeId} = require('../config')
const {saveJsonToCSV} = require('./index')
const klineListGetDuringPeriod = require('../database/klineListGetDuringPeriod')
const api = require('../api')
const player = require('play-sound')()
const PythonShell = require('python-shell')

async function main () {
  let simuEndTime = new Date().getTime()
  let simuDuration = 10 * 24 * 60 * 60 * 1000

  let predictionAnchorTime = 1517605200000
  let predictionInterval = 30 * 60 * 60 * 1000

  let predictionCount = 0

  let totalNumberOfPoints = Math.trunc(simuDuration / intervalInMillesec)
  let symbol = 'BTC/USDT'

  while (true) {
    console.log('Loading data')
    let dataSource = await klineListGetDuringPeriod(exchangeId, [symbol], totalNumberOfPoints, simuEndTime)

    if (dataSource[0].data.slice(-1)[0].timeStamp >= predictionAnchorTime + predictionCount * predictionInterval) {
      console.log('Writing data')
      saveJsonToCSV(dataSource[0].data, ['timeStamp', 'open', 'high', 'low', 'close', 'volume'], './new_BTC_data')
      console.log('Success')

      player.play('./src/Glass.aiff', (err) => {
        if (err) throw err
      })

      PythonShell.run('my_script.py', function (err) {
        if (err) {
          throw err
        }
        
        console.log('finished')
      })

      predictionCount++
    }

    api.sleep(10000)
  }
}

main()
