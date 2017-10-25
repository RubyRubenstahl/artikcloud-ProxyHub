module.exports = Nest

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var md5 = require('js-md5');
var nest = require('unofficial-nest-api')
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')

var logger

var username = ""
var password = ""
var lastStatusByDeviceId = {}

function Nest(config) {
  this._config = config
  logger = ProxyHubLogger('NEST', this._config)
  logger.log('debug', 'Create Nest proxy')
  var userParams = config.public.userParameters
  username = userParams[0].value
  password = userParams[1].value

  EventEmitter.call(this)
}

/**
 * Inherits from EventEmitter.
 */
Util.inherits(Nest, EventEmitter)

/**
 * Discovery
 */

Nest.prototype.init = function () {

  if (username && password)
    this.getAllData(true, false, null)
}

// Status update

Nest.prototype.scheduledUpdate = function () {
  // Keep polling for energySavingMode field
  this.getAllData(false, true, null)
}

// Actions

Nest.prototype.setTemperatureAction = function (proxyDeviceInfo, actionParams) {
  var temp = actionParams.temp
  var self = this
  var deviceId = proxyDeviceInfo.proxyDeviceInternalId
  nest.login(username, password, function (err, data) {
    if (err) {
      logger.warn(err.message)
      return
    }
    nest.fetchStatus(function (data) {
      nest.setTemperature(deviceId, temp)
      self.getAllData(false, false, deviceId)
    })
  })
}

Nest.prototype.setAwayAction = function (proxyDeviceInfo) {
  var self = this
  var deviceId = proxyDeviceInfo.proxyDeviceInternalId
  nest.login(username, password, function (err, data) {
    if (err) {
      logger.warn(err.message)
      return
    }
    nest.setAway()
    self.getAllData(false, false, deviceId)
  })
}

Nest.prototype.setHomeAction = function (proxyDeviceInfo) {
  var self = this
  var deviceId = proxyDeviceInfo.proxyDeviceInternalId
  nest.login(username, password, function (err, data) {
    if (err) {
      logger.warn(err.message)
      return
    }
    nest.setHome()
    self.getAllData(false, false, deviceId)
  })
}

Nest.prototype.setCoolModeAction = function (proxyDeviceInfo) {
  var self = this
  var deviceId = proxyDeviceInfo.proxyDeviceInternalId
  nest.login(username, password, function (err, data) {
    if (err) {
      logger.warn(err.message)
      return
    }

    nest.setTargetTemperatureType(deviceId, "cool")
    self.getAllData(false, false, deviceId)
  })
}

Nest.prototype.setHeatModeAction = function (proxyDeviceInfo) {
  var self = this
  var deviceId = proxyDeviceInfo.proxyDeviceInternalId
  nest.login(username, password, function (err, data) {
    if (err) {
      logger.warn(err.message)
      return
    }

    nest.setTargetTemperatureType(deviceId, "heat")
    self.getAllData(false, false, deviceId)
  })
}

Nest.prototype.getDataAction = function (proxyDeviceInfo) {
  this.getAllData(false, false, proxyDeviceInfo.proxyDeviceInternalId)
}

// Nest API

Nest.prototype.getAllData = function (synchronize, update, proxyDeviceInternalId) {
  var self = this

  nest.login(username, password, function (err, data) {
    if (err) {
      logger.warn(err.message)
      return
    }
    nest.fetchStatus(function (data) {

      for (var deviceId in data.device) {

        if (data.device.hasOwnProperty(deviceId)) {
          var device = data.shared[deviceId]
          var deviceName = "Nest Thermostat"
          var energySavingMode = "home"

          if (self.isAway(deviceId, data))
            energySavingMode = "away"

          if (device.name)
            deviceName = device.name

          if (synchronize) {
            self.emit('newDevice', {
              'proxyDeviceInternalId': deviceId,
              'proxyDeviceName': deviceName,
              'proxyDeviceTypeName': 'nest',
              'akcDtid': 'dt08877e3069054e289698027bfcf4cbdd',
              'proxyDeviceData': '{}'
            })
          }

          var jsonMessage = {
            "temp": device.current_temperature,
            "targetTemp": device.target_temperature,
            "thermostatMode": device.target_temperature_type,
            "energySavingMode": energySavingMode
          }

          if (update) {
            var lastStatus = lastStatusByDeviceId[deviceId]
            if (!lastStatus) {
              self.emit('newMessage', deviceId, jsonMessage)
              lastStatusByDeviceId[deviceId] = md5(JSON.stringify(jsonMessage))
            }
            else if (lastStatus != md5(JSON.stringify(jsonMessage))) {
              self.emit('newMessage', deviceId, jsonMessage)
              lastStatusByDeviceId[deviceId] = md5(JSON.stringify(jsonMessage))
            }
          }
          else if (synchronize || (proxyDeviceInternalId == deviceId)) {
            self.emit('newMessage', deviceId, jsonMessage)
          }

        }
      }

      if (synchronize) {
        // subscribe to next event
        nest.subscribe(self.subscribeDone.bind(self), ['shared']);
      }

    })
  })
}

Nest.prototype.subscribeDone = function (deviceId, data, type) {

  if (deviceId) {
    var jsonMessage = {
      "temp": data.current_temperature,
      "targetTemp": data.target_temperature,
      "thermostatMode": data.target_temperature_type,
    }
    this.emit('newMessage', deviceId, jsonMessage)
  }

  var self = this
  var callback = function () {
    nest.subscribe(self.subscribeDone.bind(self), ['shared']);
  }

  setTimeout(callback, 2000);
}

// Helpers

Nest.prototype.validateUserParameters = function (userParams) {
  logger.debug("userParams = " + JSON.stringify(userParams))
}

Nest.prototype.isAway = function (deviceId, data) {
  for (var structureId in data.structure) {
    var structure = data.structure[structureId]
    if (structure.devices.indexOf("device." + deviceId) > -1) {
      return structure.away
    }
  }
  return false
}

Nest.prototype.findStructureId = function (deviceId, data) {
  for (var structureId in data.structure) {
    var structure = data.structure[structureId]
    if (structure.devices.indexOf("device." + deviceId) > -1) {
      return structureId
    }
  }
  return null
}

Nest.prototype.getStatus = function () {

  if (username && password) {
    return {
      'level': 'OK',
      'message': '',
      'code': 200
    }

  }
  else {
    return {
      'level': 'ERROR',
      'message': 'You have to provide your Nest account credentials on the Nest Proxy\'s User Parameters.',
      'code': 401
    }
  }
}
