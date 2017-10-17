'use strict'

module.exports = AKCWS

var WebSocket = require('ws')
var EventEmitter = require('events').EventEmitter
var Util = require('util')
var winston = require('winston')
var ProxyHubLogger = require('./proxy-hub-logger')

var logger = new winston.Logger()

function AKCWS (config, oldWS) {
  this._devices = {}
  this._config = config
  logger = ProxyHubLogger('WS', this._config)

  this._failedAttempt = 0
  this._failedMessages = []
  this._failedRetryTimeout = null

  this._reconnectionTimeout = null

  this._seedId = this._computeRandomID()

  this._msgSent = {}

  if (this._config.artikCloud.wsTestMode) {
    this.sendWithErrorControl = this.sendWithErrorControlInTestMode
  }

  this._openWebsocket()

  if (oldWS) {
    this._failedAttempt = oldWS._failedAttempt
    this._failedMessages = JSON.parse(JSON.stringify(oldWS._failedMessages))
    for (var cid in oldWS._msgSent) {
      logger.debug('Copy from sent message: ', oldWS._msgSent[cid])
      this.addToFailedMessages(oldWS._msgSent[cid], oldWS._msgSent[cid].oldMessage)
    }
    logger.warn('We closed the socket... retry now')
    this.retryFailed()
  }
}

/**
 * Inherits from EventEmitter.
 */
Util.inherits(AKCWS, EventEmitter)

AKCWS.prototype._openWebsocket = function () {
  this.close()

  this._isCloseAsked = false
  logger.debug('OPEN WEBSOCKET')
  this._devices = {}

  this._ws = WebSocket(this._config.artikCloud.webSocketUrl)
  this._isConnected = false

  for (var cid in this._msgSent) {
    this.addToFailedMessages(this._msgSent[cid], this._msgSent[cid].oldMessage)
  }

  this._msgSent = {}

  var self = this
  this._ws.on('open', function () {
    logger.debug('Communication with ARTIK Cloud (socket) opened')
    self._isConnected = true
    self.emit('open')
    // Retransmission of failed messages

    self.successfullSent()
  })

  this._ws.on('close', function () {
    logger.log('debug', 'Communication with ARTIK Cloud is closed')
    self._isConnected = false
    if (self.isCloseAsked()) {
      if (self._failedRetryTimeout) {
        logger.debug('CLEAR TIMEOUT')
        clearTimeout(self._failedRetryTimeout)
      }
    } else {
      logger.log('debug', 'Retry connection to  ARTIK Cloud (socket) in ' + self._config.artikCloud.stalledConnectionPeriosMs)
      self._reconnectionTimeout = setTimeout(function () {
        logger.log('debug', 'Try connection to  ARTIK Cloud')
        self._openWebsocket()
      }, self._config.artikCloud.stalledConnectionPeriosMs)
    }
    self.emit('close')
  })

  this._ws.on('message', function (data, flags) {
    if (data) {
      // Expecting {"type": "<message type>", "ddid": "<destination device id>", "data": "<on/off>", "mid": <message id>}
      logger.log('debug', 'Received message: "' + data + '"')
      var json = JSON.parse(data)
      // Filter out ping messages
      if (json.type !== 'ping') {
        if (json.data && json.data.cid) {
          // received ACK
          if (json.data.mid || json.data.code === '200') {
            if (json.data.cid in self._msgSent) {
              delete self._msgSent[json.data.cid]
            } else {
              logger.warn('Msg %s is received... but was not sent: %s', json.data.cid, data)
            }
          } else {
            logger.error('Malformed ack sending msg: %s', data)
            if (json.data.cid in self._msgSent) {
              self.addToFailedMessages(self._msgSent[json.data.cid], self._msgSent[json.data.cid].oldMessage)
              self.retryFailed()
            }
          }
        } else if (json.error) {

          var akcDeviceId = null

          if (json.error.code == 401 && 'cid' in json.error && json.error.cid in self._msgSent) {
            var messageSent = self._msgSent[json.error.cid]
            if ('sdid' in messageSent) {
              akcDeviceId = messageSent.sdid
            }
          }

          if ( (akcDeviceId != null) && (json.error.message === 'Please provide a valid authorization header' || json.error.message === 'Device not registered')) {
            logger.debug('ARTIK Cloud device (id = ' + akcDeviceId + ') or its token has been deleted.')
            self.emit('unlinkAkcDevice', akcDeviceId)
          }
          else if (json.error.code !== 409) {
            // 409: just device already registered
            logger.error('Error sending msg: %s', data)
            if (json.error.code !== 429) {
              if (json.error.cid in self._msgSent) {
                self.addToFailedMessages(self._msgSent[json.error.cid], self._msgSent[json.error.cid].oldMessage)
                self.retryFailed()
              }
            } else { // rate limiting
              logger.error('Rate limiting error, we drop the message')
            }
          } else {
            logger.debug('   -> not an error, registered twice')
          }
        }
      }
      self.emit('message', data, flags)
      // We received a message so postpone reconnection (we reconnect if no message after stalledConnectionPeriosMs - 35s per default)
      // Detect if connection stalled
      if (self._reconnectionTimeout) {
        clearTimeout(self._reconnectionTimeout)
      }
      self._reconnectionTimeout = setTimeout(function () {
        logger.log('warn', 'Connection lost, try to reconnect to ARTIK Cloud (socket).')
        self._openWebsocket()
      }, self._config.artikCloud.stalledConnectionPeriosMs)
    }
  })

  this._ws.on('error', function (err) {
    logger.log('error', 'Communication with ARTIK Cloud (socket) error, msg: %s', err)
    logger.log('silly', 'Communication with ARTIK Cloud (socket) error, stack: %s', err.stack)
  })
}

AKCWS.prototype.isCloseAsked = function () {
  return this._isCloseAsked
}

AKCWS.prototype.close = function () {
  this._isCloseAsked = true
  if (this._failedRetryTimeout) {
    logger.debug('CLEAR TIMEOUT')
    clearTimeout(this._failedRetryTimeout)
  }
  if (this._reconnectionTimeout) {
    clearTimeout(this._reconnectionTimeout)
  }
  if (this._ws) {
    this._ws.close()
    this._ws.removeAllListeners()
    this._ws = null
  }
}

AKCWS.prototype.addToFailedMessages = function (message, oldMessage) {
  logger.debug('Failed to send message, retry: %s', this._config.artikCloud.retryOnTransmissionError)

  if (!this._config.artikCloud.retryOnTransmissionError) {
    return
  }

  // do not store "register" message
  if (message.type === 'register') {
    return
  }

  if (oldMessage === true) {
    // insert at 1st position if old failed message
    this._failedMessages.unshift(message)
  } else {
    // push failed message
    this._failedMessages.push(message)
  }
  if (this._failedMessages.length > 200) {
    this._failedMessages.shift()
  }
  logger.debug('%d messages are in the failed queue: %s', this._failedMessages.length, JSON.stringify(this._failedMessages))
}

AKCWS.prototype.retryFailed = function () {
  // retry with the first one in the stack
  if (!this._failedRetryTimeout) {
    var exponentialBackoff = Math.floor(0.5 * ((2 << this._failedAttempt) - 1)) + 1
    logger.warn('Retry in %d seconds', exponentialBackoff)
    var self = this
    clearTimeout(this._failedRetryTimeout)
    this._failedRetryTimeout = setTimeout(function () {
      logger.debug('Retry')
      // increment failed attempt
      self._failedAttempt += 1
      if (self._failedAttempt >= 10) {
        self._failedAttempt = 10
      }
      var retryMessage = self._failedMessages.shift()
      self._failedRetryTimeout = null
      if (retryMessage && !self._isCloseAsked) {
        self.sendMessage(retryMessage, true)
      }
    }, 1000 * exponentialBackoff)
  }
}

AKCWS.prototype.successfullSent = function () {
  this._failedAttempt = 0
  if (this._failedMessages.length > 0) {
    logger.info('Transmission is back, resent all failed messages (left to send: %d): ', this._failedMessages.length, this._failedMessages[0])
    this.sendMessage(this._failedMessages.shift(), true)
  }
}

AKCWS.prototype.sendWithErrorControl = function (message, callback, oldMessage) {
  var self = this
  if (!message.cid) {
    message.cid = this._guid()
  }
  logger.debug('Send with Error control: ', message)
  this._msgSent[message.cid] = message
  this._msgSent[message.cid].oldMessage = oldMessage
  this._ws.send(JSON.stringify(message, null, 0), function (error) {
    if (callback) {
      callback(error)
    }
    if (error) {
      logger.debug('Sent with Error: ', error.message)
      logger.silly(' ! error details: ', error)
      logger.debug('   -> Add to fail messages: ', message)
      self.addToFailedMessages(message, oldMessage)
      delete self._msgSent[message.cid]
      logger.debug('   -> Remove done from sent messages: ', self._msgSent)
      self.retryFailed()
    } else {
      logger.debug('Sent with Success')
      self.successfullSent(message)
    }
  })
}

AKCWS.prototype.sendWithErrorControlInTestMode = function (message) {
  logger.debug('Send in test mode')
  if (this._config.artikCloud.wsTestFailedMode) {
    this.addToFailedMessages(message, false)
    this.retryFailed()
    return
  } else {
    this.successfullSent(message)
    return
  }
}

AKCWS.prototype.sendMessage = function (message, oldMessage) {
  try {
    this.registerDevice(message.sdid, message.token)
    this.sendWithErrorControl(message, null, oldMessage)
  } catch (e) {
    this.emit('error', e)
    return false
  }
  return true
}

AKCWS.prototype.registerDevice = function (sdid, token) {
  try {
    if (!(sdid in this._devices)) {
      logger.debug('Registering device: %s', sdid)
      var registerPayload = {
        'sdid': sdid,
        'Authorization': 'bearer ' + token,
        'type': 'register'
      }
      logger.debug('Registering payload: %s', registerPayload)
      var self = this
      this.sendWithErrorControl(registerPayload, function (error) {
        if (!error) {
          self._devices[sdid] = 'done'
        }
        logger.debug('After Registered device: %s', JSON.stringify(self._devices))
      })
    } else {
      logger.debug('Already Registered device: %s', sdid)
    }
  } catch (e) {
    this.emit('error', e)
    return false
  }
  return true
}

AKCWS.prototype.unregisterDevice = function (sdid) {
  if (!(sdid in this._devices)) {
    delete this._devices[sdid]
  }
}

AKCWS.prototype._guid = function () {
  return this._seedId + '-' + this._computeRandomID() + '-' + Date.now().toString(16)
}

AKCWS.prototype._computeRandomID = function () {
  return Math.floor((1 + Math.random()) * 0x10000).toString(16)
}
