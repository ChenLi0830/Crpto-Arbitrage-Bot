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
    const {
      numberOfPoints,
      padding,
      windows,
      useVolAsCriteria,
      whiteList,
      blackList,
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
    this.useVolAsCriteria = useVolAsCriteria
    this.whiteList = whiteList
    this.blackList = blackList
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
  updateWorkerStateList (id, args) {
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
      this.ohlcvMAList = await klineListGetDuringPeriod(this.exchangeId, symbols, this.numberOfPoints + this.padding)
    }
    /**
     * 后续fetch，仅获取更新的数据
     */
    this.ohlcvMAList = await fetchNewPointAndAttach(this.ohlcvMAList, this.exchangeId, this.windows)
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
      let topVolume = getTopVolume(this.ohlcvMAList, undefined, this.numberOfPoints)
      let volumeWhiteListLong = (topVolume).map(o => `${o.symbol}`)
      //        log(topVolume.map(o => `${o.symbol}: ${o.BTCVolume}`).join(' '))

      topVolume = getTopVolume(this.ohlcvMAList, undefined, this.numberOfPoints / 6)
      let volumeWhiteListShort = (topVolume).map(o => `${o.symbol}`)
  //    topVolume = getTopVolume(newExtractedInfoList, undefined, numberOfPoints / 6, 5000 / 6)
  //    volumeWhiteList4H = (topVolume).map(o => `${o.symbol}`)

      this.symbolPool = this._getWhiteList(this.whiteList, volumeWhiteListLong, volumeWhiteListShort, this.blackList)
      log(`symbolPool: ${this.symbolPool}`.yellow)
    }
  }

  /**
   * 显示过去时间，除了已经在whiteList里vol活跃度最高的币
   * @param {number} window 用多少个k线点来判断最高流量
   * @param {integer} symbolNumber 显示多少个币
   * @param {number} [threshold] 超过这个threshold才会显示
   */
  logSymbolsBasedOnVolPeriod (window, symbolNumber, threshold) {
    /*
      * 显示除了已经在whiteList里，vol最高的前10
      * */
    let topVolume = getTopVolume(this.ohlcvMAList, undefined, window, threshold)
    topVolume = _.filter(topVolume, o => this.symbolPool.indexOf(o.symbol) === -1).slice(0, symbolNumber)

    log(`Top volume ${symbolNumber * 5} mins: `.yellow + topVolume.map(o => (
      `${o.symbol}: `.yellow + `${Math.round(o.BTCVolume)}`.green
    )).join(' '))
  }

  async start () {
    while (true) {
      await this.fetchData()
      this.logSymbolsBasedOnVolPeriod(this.logTopVolWindow, this.logTopVolSymbolNumber, this.logTopVolThreshold)

      let pickedSymbol = _pickSymbolFromMarket()// 检查是否有该买的currency
      if (pickedSymbol) {
        this.buyCurrency('ETH/BTC')
        console.log('this.workerList', this.workerList)
        this.workerList[0].createCutProfitOrders(this.updateWorkerStateList.bind(this))
      }
      
      break // Todo remove in production
    }
  }
}
