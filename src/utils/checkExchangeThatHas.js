const ccxt = require('ccxt')
const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const json2csv = require('json2csv');
const fs = require('fs')
const credentials = require('../../credentials')
const util = require('util')

async function checkExchangeThatHas(methodName){
  ccxt.exchanges.forEach(exchangeId=>{
    let exchange = new ccxt[exchangeId]()
    if (exchange[methodName]) {
      log(`${exchangeId} has ${methodName}`.green)
      /** update credential file */
//      if (credentials[exchangeId]) credentials[exchangeId][`_${methodName}`] = true
//      log(credentials)
//      fs.writeFileSync('credentials.js', 'module.exports = ' + util.inspect(credentials), 'utf-8')
    }
  })

  log(ccxt.exchanges.join(' '))
}

checkExchangeThatHas('fetchDepositAddress')
//checkExchangeThatHas('withdraw')
