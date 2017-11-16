'use strict'

module.exports = MediaPlayer

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var Exec = require('child_process').exec
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')

var errors = []
var logger
function MediaPlayer(config) {

  this._config = config
  logger = ProxyHubLogger('MEDIAPLAYER', this._config)
  logger.log('debug', 'Create MediaPlayer proxy')

  this._akcDtid = config['akcDtid']['mediaPlayer']

  EventEmitter.call(this)
}

Util.inherits(MediaPlayer, EventEmitter)

MediaPlayer.prototype.init = function () {}

MediaPlayer.prototype.addNewDevice = function () {
  var id = 'mediaplayer-'+Date.now()
  var name = 'Media Player'
  logger.debug("name = " + name)

  this.emit('newDevice', {
    'proxyDeviceInternalId': id,
    'proxyDeviceName': name,
    'proxyDeviceTypeName': 'New Media Player',
    'akcDtid': this._akcDtid,
    'proxyDeviceData': name
  })
}

MediaPlayer.prototype._exec = function (cmd, callback) {
  Exec(cmd, function (error, stdout, stderr) {
    // command output is in stdout
    if (callback) {
      callback(error, stdout)
    }
  })
}

MediaPlayer.prototype.scheduledUpdate = function () {
}

MediaPlayer.prototype.playAction = function (proxyDeviceInfo, actionParams) {
  var player = proxyDeviceInfo.userParametersPerDevice.mediaplayer.value
  var filePath = actionParams.filePath
  var command = player + ' "' + filePath + '"'
  this._exec(command, function (error, output) {
  })
}

MediaPlayer.prototype.stopPlayerAction = function (proxyDeviceInfo, actionParams) {
  var stop = proxyDeviceInfo.userParametersPerDevice.stopcommand.value
  if(stop != ''){
    logger.debug(stop)
    this._exec(stop, function (error, output) {
    })    
  } else {
    var player = proxyDeviceInfo.userParametersPerDevice.mediaplayer.value
    var command = "pkill " + player
    logger.debug(command)
    this._exec(command, function (error, output) {
    })
  }
}

MediaPlayer.prototype.getStatus = function () {
  if (errors.length > 0) {
    return {
      'level': 'WARNING',
      'message': errors.join("\n"),
      'code': 500
    }
  }
  return {
    'level': 'OK',
    'message': '',
    'code': 200
  }
}

// Helpers

MediaPlayer.prototype.validateUserParameters = function (userParams) {
  logger.debug("userParams = " + JSON.stringify(userParams))
}
