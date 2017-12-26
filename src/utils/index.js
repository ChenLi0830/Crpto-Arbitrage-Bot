const ccxt = require('ccxt')
const log = require('ololog').configure({locate: false})
require('ansicolor').nice
const json2csv = require('json2csv');
const fs = require('fs')


const getMarkets = async (exchangeId) => {
  const exchange = await new ccxt[exchangeId]()
  await exchange.loadMarkets()
  log(Object.keys(exchange.markets).join(' ').green)
}

const saveJsonToCSV = (json, fields = ['field1', 'field2'], fileName) => {
  try {
    let csv = json2csv({ data: json, fields: fields });
//    console.log(csv);
    fs.writeFileSync(`./savedData/${fileName}.csv`, csv)
  } catch (err) {
    // Errors are thrown for bad options, or if the data is empty and no fields are provided.
    // Be sure to provide fields if it is possible that your data array will be empty.
    console.error(err);
  }
}

module.exports = {getMarkets, saveJsonToCSV}
