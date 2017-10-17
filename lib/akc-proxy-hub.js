'use strict'

module.exports = AKCProxyHub

var winston = require('winston')
var ProxyFactory = require('./proxy-factory')
var AKCWrapper = require('./akc-wrapper')
var ApiServer = require('./api-server')
var ProxyHubLogger = require('./proxy-hub-logger')

var logger = new winston.Logger()

function AKCProxyHub (config) {
  this._proxyFactory = new ProxyFactory()
  this._akcWrapper = new AKCWrapper()
  this._apiServer = new ApiServer()

  if (config) {
    this.init(config)
  }
}

AKCProxyHub.prototype.init = function (config) {
  logger.silly('AKCProxyHub init')
  this._config = config

  logger = ProxyHubLogger('AKC_PROXY_HUB', this._config)
  //Overloading console.error to get it log
  // eslint-disable-next-line
  console.error = logger.error

  this._proxyFactory.listenTo(this._akcWrapper)
  this._akcWrapper.listenTo(this._proxyFactory, this._apiServer)
  this._apiServer.listenTo(this._akcWrapper)
  this._proxyFactory.init(config)
  this._akcWrapper.init(config)
  this._apiServer.init(config)
  this._apiServer.start()
}

AKCProxyHub.prototype.close = function () {
  logger.silly('AKCProxyHub close')
  this._akcWrapper.close()
  this._proxyFactory.close()
  this._apiServer.close()
}
