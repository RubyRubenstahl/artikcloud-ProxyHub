'use strict'

var winston = require('winston')
var AKCProxyHub = require('./lib/akc-proxy-hub')
var pjson = require('./package.json')
var fs = require('fs')
var path = require('path')
var ip = require('ip')
var ProxyHubLogger = require('./lib/proxy-hub-logger')

var logger = new (winston.Logger)()

function init (configFilepath) {
  // load config
  if (!path.isAbsolute(configFilepath)) {
    configFilepath = './' + configFilepath
  }
  fs.exists(configFilepath, function (exists) {
    if (!exists) {
      logger.error("Config file (%s) doesn't exist", configFilepath)
    } else {
      // Load config
      var config = require(configFilepath)
      logger.info('Load config from ', configFilepath)
      initLogger(config)
      // set current dir as root dir
      config.dir.root = path.resolve(__dirname)
      // start the hub
      var akcProxyHub = new AKCProxyHub()
      akcProxyHub.init(config)
    }
  })
}

/**
 * Initialize Logger.
 */
function initLogger (config) {
  logger = ProxyHubLogger('INDEX', config)

  // add this handler before emitting any events
  process.on('uncaughtException', function (err) {
    logger.error('UNCAUGHT EXCEPTION - keeping process alive:', err, ' -> ', err.stack) // err.message is "foobar"
  })
}

// Check if a config file was passed as a parameter
if (process.argv.length !== 3) {
  console.log('Usage: node <javascript filename> <config filename>')
  process.exit()
}
// Check if the file exists
var filepath = process.argv[2]

console.log('-----------------------')
console.log('ARTIK Cloud Proxy Hub v'+pjson.version)
console.log('-----------------------')
console.log('GO TO THIS WEBPAGE TO ACCESS THE UI: http://'+ip.address()+':8888')
console.log('-----------------------')

init(filepath)
