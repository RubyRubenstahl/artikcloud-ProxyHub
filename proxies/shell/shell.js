'use strict'

module.exports = Shell

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var winston = require('winston')
var Exec = require('child_process').exec
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')

var logger = new winston.Logger()
var errors = []
var lastState = {}
var commandToGetState = {}

function Shell(config) {
  logger.log('debug', 'Create Shell proxy')
  this._config = config
  logger = ProxyHubLogger('SHELL_PROXY', this._config)

  this._akcDtid = config['akcDtid']['shellProxy']

  EventEmitter.call(this)
}

Util.inherits(Shell, EventEmitter)

Shell.prototype.init = function () {}

Shell.prototype.addNewDevice = function () {
  var name = this._config.public.defaultName
  var id = 'shell.'+Date.now()
  logger.debug("name = " + name)

  this.emit('newDevice', {
    'proxyDeviceInternalId': id,
    'proxyDeviceName': name,
    'proxyDeviceTypeName': 'New Shell Proxy',
    'akcDtid': this._akcDtid,
    'proxyDeviceData': name
  })

  // device is off by default
  this.emit('newMessage', id, { 'state': 'off' })
  lastState[id] = 'off'
}

Shell.prototype._exec = function (cmd, callback) {
  Exec(cmd, function (error, stdout, stderr) {
    // command output is in stdout
    if (callback) {
      callback(error, stdout)
    }
  })
}

Shell.prototype.scheduledUpdate = function () {
  // regularly monitor if state has been changed from other source than ProxyHub
  var self = this
  for(var proxyDeviceInternalId in commandToGetState)
  {
    var command = commandToGetState[proxyDeviceInternalId]
    this._exec(command, function (error, output) {
      output = output.trim()
      if (error || output !== 'on' && output !== 'off') {
        logger.warn('not a valid output for the command state: %s, error: %s', output, error)
        errors.push('not a valid output for the command state: ' + output + ' , error:' + error)
      } else {
        var message = { 'state':output }
        // update the state only if it has changed from previously
        if( (!(proxyDeviceInternalId in lastState)) || (output != lastState[proxyDeviceInternalId]))
        {
          self.emit('newMessage', proxyDeviceInternalId, message)
          lastState[proxyDeviceInternalId] = output
        }
      }
    })
  }
}

Shell.prototype.storeCommandToGetState = function (proxyDeviceInfo)
{
  if ("state" in proxyDeviceInfo.userParametersPerDevice)
    commandToGetState[proxyDeviceInfo.proxyDeviceInternalId] = proxyDeviceInfo.userParametersPerDevice.state
}


Shell.prototype.setOffAction = function (proxyDeviceInfo) {

  // monitor if state has been changed from other source than ProxyHub
  this.storeCommandToGetState(proxyDeviceInfo)

  var self = this
  if ("userParametersPerDevice" in proxyDeviceInfo)
    if ("setOff" in proxyDeviceInfo.userParametersPerDevice) {

      self._exec(proxyDeviceInfo.userParametersPerDevice.setOff, function (error, output) {
        if (error) {
          logger.error('not a valid output for the command state: %s', error)
          errors.push('not a valid output for the command state: ' + error)

        } else {
          logger.debug('Action set off sent, output: ', output)
          lastState[proxyDeviceInfo.proxyDeviceInternalId] == 'off'
          // deduce the state:
          // - to be instantaneous
          // - in case there is no command to get the state
          // - to avoid OS synchronization issues
          self.emit('newMessage', proxyDeviceInfo.proxyDeviceInternalId, { 'state': 'off' })
        }
      })
    }
}

Shell.prototype.setOnAction = function (proxyDeviceInfo) {

  // monitor if state has been changed from other source than ProxyHub
  this.storeCommandToGetState(proxyDeviceInfo)

  var self = this
  if ("userParametersPerDevice" in proxyDeviceInfo)
    if ("setOn" in proxyDeviceInfo.userParametersPerDevice) {
      self._exec(proxyDeviceInfo.userParametersPerDevice.setOn.value, function (error, output) {
        if (error) {
          logger.error('not a valid output for the command state: %s', error)
          errors.push('not a valid output for the command state: ' + error)

        } else {
          logger.debug('Action set off sent, output: ', output)
          lastState[proxyDeviceInfo.proxyDeviceInternalId] == 'on'
          // deduce the state:
          // - to be instantaneous
          // - in case there is no command to get the state
          // - to avoid OS synchronization issues
          self.emit('newMessage', proxyDeviceInfo.proxyDeviceInternalId, { 'state': 'on' })
        }
      })
    }
}

Shell.prototype.toggleAction = function (proxyDeviceInfo) {

  if (proxyDeviceInfo.proxyDeviceInternalId in lastState) {
    if (lastState[proxyDeviceInfo.proxyDeviceInternalId] == 'off')
      this.setOffAction(proxyDeviceInfo)
    else if (lastState[proxyDeviceInfo.proxyDeviceInternalId] == 'on')
      this.setOffAction(proxyDeviceInfo)
  }
  else {
    this.setOnAction(proxyDeviceInfo)
  }

}

Shell.prototype.setStateAction = function (proxyDeviceInfo, actionParams) {
  if (actionParams.state === 'off') {
    this.setOffAction(proxyDeviceInfo)
  } else if (actionParams.state === 'on') {
    this.setOnAction(proxyDeviceInfo)
  }
}

Shell.prototype.getStatus = function () {
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

Shell.prototype.validateUserParameters = function (userParams) {
  logger.debug("userParams = " + JSON.stringify(userParams))
}
