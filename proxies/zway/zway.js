'use strict'

module.exports = Zway

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var Request = require('superagent')
var DeepEqual = require('deep-equal')
var Promise = require('promise')
var ProxyHubLogger = require('../../lib/proxy-hub-logger')

var logger
var errors = []

var COMMAND_CLASS_2_DEVICE_TYPE = {
  // 37: 'SwitchBinary',
  // 48: 'SensorBinary',
  // 49: 'SensorMultilevel',
  // 50: 'Meter',
  98: 'DoorLock'
}
var CONCERNED_COMMANDCLASSES = Object.keys(COMMAND_CLASS_2_DEVICE_TYPE)
var CONCERNED_BASIC_TYPES = [4]
// 1: "Controller", 2: "Static Controller", 3: "Slave", 4: "Routing Slave"

// Now it support only SwitchBinary, SensorBinary, SensorMultilevel, Meter, DoorLock
function Zway(config) {
  this._config = config

  logger = ProxyHubLogger('ZWAY', this._config)
  logger.debug('BUILD Zway')
  this._baseUrl = 'http://' + config.public.userParameters[0].value + ':' + config.public.userParameters[1].value + '/ZWaveAPI'
  this.DEVICE_TYPE_2_AKC_DTID = {
    // 'SwitchBinary': config['akcDtid']['SwitchBinary'],
    // 'SwitchMultilevel': config['akcDtid']['SwitchMultilevel'],
    // 'SensorBinary': config['akcDtid']['SensorBinary'],
    // 'SensorMultilevel': config['akcDtid']['SensorMultilevel'],
    // 'Meter': config['akcDtid']['Meter'],
    // 'Thermostat': config['akcDtid']['Thermostat'],
    'DoorLock': config['akcDtid']['DoorLock']
  }
  this._zwayDevicesMap = {}
  // Map of internalId -> data

  // Internal devices Ids are similar to Virtual Device Ids
  // Auto-generated devices are named after their IDs in the physical network. For Z-Wave devices the naming is generated using the following logic.
  // [Zway Device ID]:[Zway Instance ID]:[Zway Device type]:[Data channel ID(optional for sensor)]
  // Until now, Zway Device type is exact the name for CommandClass
  EventEmitter.call(this)
}
// Inherits from EventEmitter.
Util.inherits(Zway, EventEmitter)

var _parseInternalId = function _parseInternalId(internalIdStr) {
  var propsArr = internalIdStr.split(':')
  return {
    zwayDeviceId: propsArr[0],
    zwayInstanceId: propsArr[1],
    zwayDeviceType: propsArr[2],
    zwayDataChannel: propsArr[3]
  }
}

var _retreiveDevices = function _retreiveDevices(rawDevicesMap, acceptedDeviceBasicTypes, accptedCommandClassIds) {
  var newZwayDevicesList = []
  Object.keys(rawDevicesMap).filter(function (deviceKey) {
    var thisDevice = rawDevicesMap[deviceKey]
    if (thisDevice.hasOwnProperty('data') && thisDevice.data.hasOwnProperty('basicType') && thisDevice.data.basicType.hasOwnProperty('value')) {
      return acceptedDeviceBasicTypes.indexOf(thisDevice.data.basicType.value) >= 0
    } else {
      return false
    }
  }).forEach(function (deviceKey) {
    // For Each device
    var thisDevice = rawDevicesMap[deviceKey]
    var instances = thisDevice.instances ? thisDevice.instances : {}
    Object.keys(instances).forEach(function (instanceKey) {
      // for each instances
      var thisInstance = instances[instanceKey]
      var commandClasses = thisInstance.commandClasses ? thisInstance.commandClasses : {}
      Object.keys(commandClasses).filter(function (k) {
        return accptedCommandClassIds.indexOf(k) >= 0
      }).forEach(function (commandKey) {
        // for each accpted command
        var thisCommandClassData = commandClasses[commandKey].data ? commandClasses[commandKey].data : {}
        var intDataChannelKeys = Object.keys(thisCommandClassData).filter(function (k) {
          return (/^\d+$/.test(k)
          )
        }) // check there is some data channel whose key numeric
        if (intDataChannelKeys.length === 0) {
          var zwayDeviceType = COMMAND_CLASS_2_DEVICE_TYPE[commandKey]
          newZwayDevicesList.push(deviceKey + ':' + instanceKey + ':' + zwayDeviceType)
          // if no dataChannel, direct use it
        } else {
          intDataChannelKeys.forEach(function (dataChannelKey) {
            // for each data
            var zwayDeviceType = COMMAND_CLASS_2_DEVICE_TYPE[commandKey]
            newZwayDevicesList.push(deviceKey + ':' + instanceKey + ':' + zwayDeviceType + ':' + dataChannelKey)
          })
        }
      })
    })
  })
  return newZwayDevicesList
}

var _zwayDataExtract = function _zwayDataExtract(dataObj, retainKeys) {
  /* EXAMPLE INPUT :
  {
    "invalidateTime": 1467058568,
    "updateTime": 1467058640,
    "type": "empty",
    "value": null,
    "sensorTypeString": {
      "invalidateTime": 1464709130,
      "updateTime": 1464709131,
      "type": "string",
      "value": "Temperature"
    },
    "val": {
      "invalidateTime": 1464709130,
      "updateTime": 1467058640,
      "type": "float",
      "value": 24.9
    },
    "deviceScale": {
      "invalidateTime": 1464709130,
      "updateTime": 1467058640,
      "type": "int",
      "value": 0
    },
    "scale": {
      "invalidateTime": 1464709130,
      "updateTime": 1467058640,
      "type": "int",
      "value": 0
    },
    "scaleString": {
      "invalidateTime": 1464709130,
      "updateTime": 1467058640,
      "type": "string",
      "value": "°C"
    }
  }
  EXAMPLE OUTPUT :
  {
    "sensorTypeString": "Temperature",
    "val": 24.9,
    "deviceScale": 0,
    "scale": 0,
    "scaleString": "°C"
  }
  */
  var newData = {}
  Object.keys(dataObj).forEach(function (key) {
    if (retainKeys.indexOf(key) >= 0 && dataObj[key].hasOwnProperty('value')) {
      newData[key] = dataObj[key].value
    }
  })
  return newData
}

var _zwayDataProcessor = function _zwayDataProcessor(result) {
  // result sould contain 'internalId' & 'data'
  var targetDevice = _parseInternalId(result.internalId)
  var translator = {
    'SwitchBinary': function SwitchBinary(data) {
      return { state: data.level.value }
    },
    'DoorLock': function DoorLock(data) {
      switch (data.mode.value) {
        case 0:
          return { state: 'unlocked' }
        case 255:
          return { state: 'locked' }
        default:
          return { state: 'unknown' }
      }
    },
    'Meter': function Meter(data) {
      return _zwayDataExtract(data[targetDevice.zwayDataChannel], ['delta', 'previous', 'ratetype', 'scale', 'scaleString', 'sensorType', 'sensorTypeString', 'val'])
    },
    'SensorBinary': function SensorBinary(data) {
      return _zwayDataExtract(data[targetDevice.zwayDataChannel], ['sensorTypeString', 'level'])
    },
    'SensorMultilevel': function SensorMultilevel(data) {
      return _zwayDataExtract(data[targetDevice.zwayDataChannel], ['deviceScale', 'scale', 'scaleString', 'sensorTypeString', 'val'])
    }
  }
  return translator[targetDevice.zwayDeviceType](result.data)
}

var _buildDeviceName = function _buildDeviceName(deviceData) {
  var SEPARATOR = ' - '
  var name = [deviceData.vendorString.value, deviceData.deviceTypeString.value, deviceData.givenName.value].reduce(function (prev, current) {
    return current ? prev + SEPARATOR + current : prev
  }, '').slice(SEPARATOR.length)
  return name
}

// Implements DISCOVER
Zway.prototype.init = function () {
  // Discover Zways
  logger.info('Discover Zway devices... please wait')
  this.scheduledUpdate({})
}

Zway.prototype._sendZwayCommand = function (internalId, commandClassStr, childCommandStr) {
  var self = this
  var targetDevice = _parseInternalId(internalId)
  var targetUrl = self._baseUrl + '/Run/devices[' + targetDevice.zwayDeviceId + '].instances[' + targetDevice.zwayInstanceId + '].' + commandClassStr + '.' + childCommandStr
  logger.debug('Command sending to:', targetUrl)
  return new Promise(function (resolve, reject) {
    Request.post(targetUrl).end(function (err, res) {
      if (err || !res.ok) {
        logger.error('Oh no! error, when _sendZwayCommand')

        errors.push('Error when sending Z-Wave command: ' + JSON.stringify(err))
        reject({
          error: err,
          response: res
        })
      } else {
        logger.debug('Got response ' + JSON.stringify(res.body))
        resolve({
          internalId: internalId,
          data: res.body
        })
      }
    })
  })
}

Zway.prototype._getZwayRawDevices = function () {
  var self = this
  logger.debug('Get all data at url: ' + self._baseUrl + '/Data')
  return new Promise(function (resolve, reject) {
    Request.get(self._baseUrl + '/Data').end(function (err, res) {
      if (err || !res.ok) {
        logger.error('Error when _getZwayRawDevices:', JSON.stringify(err))
        errors.push('Error when getting ZWave raw devices : ' + JSON.stringify(err))

        reject({
          error: err,
          response: res
        })
      } else {
        logger.debug('Got response ' + Util.inspect(res.body, { depth: 0 }))
        resolve(res.body.devices)
      }
    })
  })
}

Zway.prototype._getZwayData = function (internalId) {
  var self = this
  var targetDevice = _parseInternalId(internalId)
  return new Promise(function (resolve, reject) {
    Request.get(self._baseUrl + '/Run/devices[' + targetDevice.zwayDeviceId + '].instances[' + targetDevice.zwayInstanceId + '].' + targetDevice.zwayDeviceType + '.data').end(function (err, res) {
      if (err || !res.ok) {
        logger.debug('Error when _getZwayData')
        errors.push('Error when getting ZWave data : ' + JSON.stringify(err))

        reject({
          error: err,
          response: res
        })
      } else {
        logger.debug('Got response ' + Util.inspect(res.body, { depth: 0 }))
        resolve({
          internalId: internalId,
          data: res.body
        })
      }
    })
  })
}

Zway.prototype._refreshZwayDevicesList = function () {
  logger.debug('_refreshZwayDevicesList')
  var self = this
  this._getZwayRawDevices().then(function (devices) {
    _retreiveDevices(devices, CONCERNED_BASIC_TYPES, CONCERNED_COMMANDCLASSES).forEach(function (dId) {
      if (!(dId in self._zwayDevicesMap)) {
        var targetDevice = _parseInternalId(dId)
        self._zwayDevicesMap[dId] = {}

        if (targetDevice.zwayDeviceType in self.DEVICE_TYPE_2_AKC_DTID) {
          self.emit('newDevice', {
            proxyDeviceInternalId: dId,
            proxyDeviceName: _buildDeviceName(devices[targetDevice.zwayDeviceId].data),
            proxyDeviceTypeName: targetDevice.zwayDeviceType,
            akcDtid: self.DEVICE_TYPE_2_AKC_DTID[targetDevice.zwayDeviceType],
            proxyDeviceData: {}
          })
        }

      }
    })
  }).catch(logger.error)
}

Zway.prototype.scheduledUpdate = function (deviceInfo) {
  logger.debug('Update call')
  var self = this
  this._refreshZwayDevicesList()
  Object.keys(this._zwayDevicesMap).forEach(function (internalId) {
    var targetDevice = _parseInternalId(internalId)
    self._sendZwayCommand(internalId, targetDevice.zwayDeviceType, 'Get()').then(function (result) {
      return self._getZwayData(result.internalId)
    }).then(function (result) {
      var oldData = self._zwayDevicesMap[result.internalId]
      var newData = _zwayDataProcessor(result)
      if (!DeepEqual(oldData, newData)) {
        self._zwayDevicesMap[result.internalId] = newData
        self.emit('newMessage', result.internalId, newData)
      }
    }).catch(logger.error)
  })
}

// Implements ACTIONS
Zway.prototype.setOnAction = function (deviceInfo) {
  logger.debug('setOn')
  var self = this
  var internalId = deviceInfo.proxyDeviceInternalId
  this._sendZwayCommand(internalId, 'SwitchBinary', 'Set(255)').then(function (result) {
    return self._sendZwayCommand(internalId, 'SwitchBinary', 'Get()')
  }).catch(logger.error)
}

Zway.prototype.setOffAction = function (deviceInfo) {
  logger.debug('setOffAction')
  var self = this
  var internalId = deviceInfo.proxyDeviceInternalId
  this._sendZwayCommand(internalId, 'SwitchBinary', 'Set(0)').then(function (result) {
    return self._sendZwayCommand(internalId, 'SwitchBinary', 'Get()')
  }).catch(logger.error)
}

Zway.prototype.resetAction = function (deviceInfo) {
  logger.debug('resetAction')
  var self = this
  var internalId = deviceInfo.proxyDeviceInternalId
  this._sendZwayCommand(internalId, 'Meter', 'ReSet()').then(function (result) {
    return self._sendZwayCommand(internalId, 'Meter', 'Get()')
  }).catch(logger.error)
}

Zway.prototype.unlockAction = function (deviceInfo) {
  logger.debug('unlockAction')
  var self = this
  var internalId = deviceInfo.proxyDeviceInternalId
  this._sendZwayCommand(internalId, 'DoorLock', 'Set(0)').then(function (result) {
    return self._sendZwayCommand(internalId, 'DoorLock', 'Get()')
  }).catch(logger.error)
}

Zway.prototype.lockAction = function (deviceInfo) {
  logger.debug('lock')
  var self = this
  var internalId = deviceInfo.proxyDeviceInternalId
  this._sendZwayCommand(internalId, 'DoorLock', 'Set(255)').then(function (result) {
    return self._sendZwayCommand(internalId, 'DoorLock', 'Get()')
  }).catch(logger.error)
}

Zway.prototype.getStateAction = function (deviceInfo) {
  logger.debug('getState')
  var self = this
  var internalId = deviceInfo.proxyDeviceInternalId
  var targetDevice = _parseInternalId(internalId)
  this._sendZwayCommand(internalId, targetDevice.zwayDeviceType, 'Get()').then(function (result) {
    return self._getZwayData(result.internalId)
  }).then(function (result) {
    self.emit('newMessage', result.internalId, _zwayDataProcessor(result))
  }).catch(logger.error)
}

Zway.prototype.getStatus = function () {
  if (errors.length > 0) {
    return {
      'level': 'WARNING',
      'message': errors[errors.length-1],
      'code': 500
    }
  }
  return {
    'level': 'OK',
    'message': '',
    'code': 200
  }
}
