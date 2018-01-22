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
  fetchNewPointAndAttach,
  calcMovingAverge,
  logSymbolsBasedOnVolPeriod
} = utils

const klineListGetDuringPeriod = require('./database/klineListGetDuringPeriod')

module.exports = class Manager {
  constructor (exchangeId = 'binance', credentials, params) {
    const {
      numberOfPoints,
      padding,
      windows,
      useVolAsCriteria = true,
      whiteList = [],
      blackList = [],
      longVolSymbolNo = 10, // 用长期vol选多少个候选币
      shortVolSymbolNo = 2, // 用短期vol选多少个候选币
      longVolWindow = 24 * 60 / 5,
      shortVolWindow = 4 * 60 / 5,
      logTopVolWindow = 15 / 5,
      logTopVolSymbolNumber = 10,
      logTopVolThreshold,
    } = params

    this.exchangeId = exchangeId
    this.exchange = new ccxt[exchangeId](ccxt.extend({enableRateLimit: true}, credentials))
    this.numberOfPoints = numberOfPoints
    this.padding = padding
    this.windows = windows
    this.whiteList = whiteList
    this.blackList = blackList

    // Vol相关
    this.useVolAsCriteria = useVolAsCriteria
    this.longVolSymbolNo = longVolSymbolNo
    this.shortVolSymbolNo = shortVolSymbolNo
    this.longVolWindow = longVolWindow
    this.shortVolWindow = shortVolWindow
    this.logTopVolWindow = logTopVolWindow
    this.logTopVolSymbolNumber = logTopVolSymbolNumber
    this.logTopVolThreshold = logTopVolThreshold

    this.ohlcvMAList = [] // 记录所有symbols的k线和MA
    this.workerList = [] // 记录所有active的worker
    this.eventList = [] // 记录买币和卖币events
    this.symbolPool = [] // 统计所有白名单黑名单后，最终会从这个pool里挑选币
  }

  /**
   * 给 worker 调用来update worker 状态的callback
   * @param {*} id
   * @param {*} args
   */
  updateWorkerList (id, args) {
    console.log('id, args', id, args)
    let worker = _.find(this.workerList, {id})

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
    if (!this.ohlcvMAList || !this.ohlcvMAList.length) {
      await this.exchange.loadMarkets()
      let symbols = _.filter(this.exchange.symbols, symbol => symbol.endsWith('BTC'))
      return klineListGetDuringPeriod(this.exchangeId, symbols, this.numberOfPoints + this.padding)
    } else {
      /**
       * 后续fetch，仅获取更新的数据
       */
      return fetchNewPointAndAttach(this.ohlcvMAList, this.exchangeId, this.windows)
    }
  }

  async buyCurrency (symbol) {
    let id = uuid()
    let worker = new Worker(id, symbol)
    this.workerList.push(worker)
  }

  _getWhiteList (whiteList, volumeWhiteList24H, volumeWhiteList4H, blackList) {
    let whiteListSet = new Set([...whiteList, ...volumeWhiteList24H.slice(0, this.longVolSymbolNo), ...volumeWhiteList4H.slice(0, this.shortVolSymbolNo)])
    /*
    * 删除黑名单中的部分
    * */
    blackList && blackList.forEach(symbol => whiteListSet.delete(symbol))
    return [...whiteListSet]
  }

  _pickSymbolFromMarket () {
    if (this.useVolAsCriteria) {
      let topVolumeList = getTopVolume(this.ohlcvMAList, undefined, this.longVolWindow)
      let volumeWhiteListLong = (topVolumeList).map(o => `${o.symbol}`)

      topVolumeList = getTopVolume(this.ohlcvMAList, undefined, this.shortVolWindow)
      let volumeWhiteListShort = (topVolumeList).map(o => `${o.symbol}`)

      this.symbolPool = this._getWhiteList(this.whiteList, volumeWhiteListLong, volumeWhiteListShort, this.blackList)
      log(`symbolPool: ${this.symbolPool}`.yellow)
    }

    // todo 检查价格和其他条件，是否该买
  }

  async start () {
    while (true) {
      try {
        let ohlcvList = await this.fetchData()
        this.ohlcvMAList = calcMovingAverge(ohlcvList, this.windows)
        // console.log('this.ohlcvMAList.length', this.ohlcvMAList.length)
        // // console.log('this.ohlcvMAList[0]', Object.keys(this.ohlcvMAList[0]))
        // process.exit()
        logSymbolsBasedOnVolPeriod(this.ohlcvMAList, this.logTopVolWindow, this.logTopVolSymbolNumber, this.logTopVolThreshold, this.symbolPool)
        let pickedSymbol = this._pickSymbolFromMarket()// 检查是否有该买的currency
        if (pickedSymbol) {
          this.buyCurrency('ETH/BTC')
          console.log('this.workerList', this.workerList)
          this.workerList[0].createCutProfitOrders(this.updateWorkerStateList.bind(this))
        }
      } catch (error) {
        console.log(error)
      }

      break // Todo remove in production
    }
  }
}
