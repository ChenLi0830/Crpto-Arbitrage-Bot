const credentials = require('../../credentials')
const Manager = require('../Manager')
const {windows} = require('../config')

async function main () {
  let exchangeId = 'binance'
  let numberOfPoints = 24 * 60 / 5
  let padding = 100
  let params = {
    numberOfPoints,
    padding,
    windows
  }

  let manager = new Manager(exchangeId, credentials[exchangeId], params)
  await manager.start()
  // await manager.loadBalance()
  // await manager.fetchData()
  // console.log('manager.extractedInfoList.length', manager.extractedInfoList.length)
  // await manager.fetchData()
  // console.log('manager.extractedInfoList.length', manager.extractedInfoList.length)
  // await manager.fetchData()
  // console.log('manager.extractedInfoList.length', manager.extractedInfoList.length)
}

main()
