// 'use strict'
const ccxt = require('ccxt')
const asciichart = require('asciichart')
const asTable = require('as-table')
const log = require('ololog').configure({locate: false})
const api = require('./api')
const fs = require('fs')
const _ = require('lodash')
const {saveJsonToCSV} = require('./utils')
require('ansicolor').nice
const moment = require('moment')
const credentials = require('../credentials')
const {MinorError, MajorError} = require('./utils/errors')
const utils = require('./utils')
const player = require('play-sound')(opts = {})
const Worker = require('./Worker')
const uuid = require('uuid/v4')

const {
  retryMutationTaskIfTimeout,
  retryQueryTaskIfAnyError,
  cutExtractedInfoList,
  getTopVibrated,
  getTopVolume,
  getTopWeighted,
  addVibrateValue,
  addBTCVolValue,
  generateCutProfitList,
  addPaddingExtractedInfoList,
  fetchNewPointAndAttach
} = utils

const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')

module.exports = class Manager {
  constructor (exchangeId = 'binance', credentials, params) {
    let {numberOfPoints, padding, windows} = params
    this.exchangeId = exchangeId
    this.exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials))
    this.numberOfPoints = numberOfPoints
    this.padding = padding
    this.windows = windows

    this.extractedInfoList = [] // 记录所有symbols的k线和MA
    this.workerList = [] // 记录所有active的worker
    this.eventList = [] // 记录买币和卖币events
  }

  /**
   * 给 worker 调用来update worker 状态的callback
   * @param {*} id
   * @param {*} args
   */
  updateWorkerStateList (id, args) {
    console.log('id, args', id, args)
    let worker = _.find(this.workerList, {id})
    // workerState = {...workerState, ...args}

    console.log('this.workerList', this.workerList)

    if (worker.done) {
      let workerIdx = _.findIndex(this.workerList, {id})
      this.workerList.splice(workerIdx, 1)
    }
  }

  appendEventList (event) {
    this.eventList.push(event)
  }

  async loadBalance () {
    let newBTCBalance = (await retryQueryTaskIfAnyError(this.exchange, 'fetchBalance', [{'recvWindow': 60 * 10 * 1000}]))['free']['BTC']
    log(`--- newBTCBalance ${newBTCBalance}`)
  }

  async fetchData () {
    /**
     * 初始fetch，获取所有所需数据
     */
    if (!this.extractedInfoList || !this.extractedInfoList.length) {
      await this.exchange.loadMarkets()
      let symbols = _.filter(this.exchange.symbols, symbol => symbol.endsWith('BTC'))
      this.extractedInfoList = await klineListGetDuringPeriod(this.exchangeId, symbols, this.numberOfPoints + this.padding)
    }
    /**
     * 后续fetch，仅获取更新的数据
     */
    this.extractedInfoList = await fetchNewPointAndAttach(this.extractedInfoList, this.exchangeId, this.windows)
  }

  amountToPrecision (amount) {
    return this.exchange.amountToPrecision(this.symbol, amount)
  }

  createLimitBuyOrder (amount, price) {
    return this.exchange.createLimitBuyOrder(this.symbol, amount, price)
  }

  createLimitSellOrder (amount, price) {
    return this.exchange.createLimitSellOrder(this.symbol, amount, price)
  }

  async buyCurrency (symbol) {
    let id = uuid()
    let worker = new Worker(id, symbol)
    this.workerList.push(worker)
  }

  async start () {
    while (true) {
      await this.fetchData()
      this.buyCurrency('ETH/BTC')
      console.log('this.workerList', this.workerList)
      this.workerList[0].createCutProfitOrders(this.updateWorkerStateList.bind(this))
      break // Todo remove in production
    }
  }
}
