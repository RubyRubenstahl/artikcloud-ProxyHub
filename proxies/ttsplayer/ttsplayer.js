module.exports = TTSPlayer

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var say = require('say');
var errors = []
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')

var logger

function TTSPlayer(config) {
  this._config = config
  this._akcDtid = config['akcDtid']['ttsPlayer']

  logger = ProxyHubLogger('TTSPLAYER', this._config)
  logger.log('debug', 'TTS player')
  
  EventEmitter.call(this)
}

Util.inherits(TTSPlayer, EventEmitter)

TTSPlayer.prototype.init = function () {}

TTSPlayer.prototype.addNewDevice = function () {
  var id = 'ttsplayer-'+Date.now()
  var name = 'TTSPlayer'
  logger.debug("name = " + name)

  this.emit('newDevice', {
    'proxyDeviceInternalId': id,
    'proxyDeviceName': name,
    'proxyDeviceTypeName': 'New TTSPlayer',
    'akcDtid': this._akcDtid,
    'proxyDeviceData': name
  })
}

TTSPlayer.prototype.scheduledUpdate = function () { }

TTSPlayer.prototype.PlayAction = function (proxyDeviceInfo, actionParams) {
  logger.debug("I should say: " + actionParams.text)

  try {
    say.speak(actionParams.text);
  }
  catch(err) {
    errors.push(err)
  }

}

TTSPlayer.prototype.validateUserParameters = function (userParams) {
  logger.debug(userParams)
}

TTSPlayer.prototype.getStatus = function () {

  if(errors.length > 0)
  {
    return {
      'level': 'ERROR',
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
