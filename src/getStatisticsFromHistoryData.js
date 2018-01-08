'use strict'

const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
require('ansicolor').nice;
const fs = require('fs')
const {saveJsonToCSV, cutExtractedInfoList, getTopVibrated, getTopVolume} = require('./utils')
const moment = require('moment')

const TOP_VIBRATED_CSV_FILE = './savedData/topVibrated.csv'
const TOP_VOLUME_CSV_FILE = './savedData/topVolume.csv'
//-----------------------------------------------------------------------------
async function main () {
  let extractedInfoList = require('../savedData/klines/klines')
  let statsInterval = 4 * 60 * 60 * 1000 //'4h'

  let startIndex = 0
  let endIndex = 0

  let topVibrateResult = []
  let topVolumeResult = []

  while (startIndex < extractedInfoList[0].timeLine.length) {
    while (extractedInfoList[0].timeLine[endIndex] - extractedInfoList[0].timeLine[startIndex] < statsInterval) {
      endIndex++
    }

    let newExtractedInfoList = cutExtractedInfoList (extractedInfoList, startIndex, endIndex - startIndex + 1)

    let newInfoLength = newExtractedInfoList[0].timeLine.length
    let topVibrated = getTopVibrated(newExtractedInfoList, 10, newInfoLength)
    let topVolume = getTopVolume(newExtractedInfoList, 10, newInfoLength)

    let startTime = moment(newExtractedInfoList[0].timeLine[0]).format('MMMM Do YYYY, h:mm:ss a')
    let endTime = moment(newExtractedInfoList[0].timeLine[newInfoLength-1]).format('MMMM Do YYYY, h:mm:ss a')

    topVibrateResult.push({
      startTime,
      endTime,
      topVibrated: topVibrated.map(info => `{${info.symbol}: ${info.vibrateValue}}`).join(' ')
    })

    topVolumeResult.push({
      startTime,
      endTime,
      topVolume: topVolume.map(info => `{${info.symbol}: ${info.totalVolume}}`).join(' ')
    })

    startIndex = endIndex + 1

  }

//  console.log('topVibrateResult', topVibrateResult)
  saveJsonToCSV(topVibrateResult, ['startTime', 'endTime', 'topVibrated'], TOP_VIBRATED_CSV_FILE)
  saveJsonToCSV(topVolumeResult, ['startTime', 'endTime', 'topVolume'], TOP_VOLUME_CSV_FILE)

  //  while (data.length < fetchingGoal) {
  //    fetchSince -= fetchRecordNb * milsecPerRecord
  //    let fetchedData = await fetchData(exchangeId, symbol, interval, fetchSince,
  //      fetchRecordNb)
  //    data.push(...fetchedData)
//      saveJsonToCSV(data, ['time', 'open', 'high', 'low', 'close', 'volume'], fileName)
  //    log(`${data.length} of record is fetched, ${Math.trunc(100 * data.length / fetchingGoal)}%`.green)
  //  }
  //
  //  console.log('data', data)
  //  process.exit()
}

(async ()=>{
  try {
    await main()
  }
  catch(error){
    console.log(error)
  }
})()
