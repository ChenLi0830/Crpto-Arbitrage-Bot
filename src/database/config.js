'use strict'

let AWS = require('aws-sdk')
AWS.config.update({
  region: 'us-west-2',
})

/**
 * For testing on local DynamoDB
 **/
console.log('process.env.DEBUG_MODE', process.env.DEBUG_MODE)
if (process.env.DEBUG_MODE) {
  AWS.config.update({
    region: 'us-west-2',
    endpoint: 'http://localhost:8000',
    accessKeyId: '123',
    secretAccessKey: '345'
  })
}

const KlineTable = 'ZL-Klines'

module.exports = {
  KlineTable,
  AWS
}
