'use strict'

if (typeof String.prototype.endsWith !== 'function') {
  String.prototype.endsWith = function (suffix) {
    return this.indexOf(suffix, this.length - suffix.length) !== -1
  }
}

module.exports = Wemo

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var Promise = require('promise')
var Url = require('url')
var Http = require('http')
var Xml2js = require('xml2js')
var SSDPClient = require('node-ssdp').Client
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')

var logger
var errors = []

function Wemo (config) {
  this._config = config

  logger = ProxyHubLogger('WEMO', this._config)

  logger.info('Load Wemo')

  this.DEVICE_TYPE_2_AKC_DTID = {
    // 'urn:Belkin:device:bridge:1': config['akcDtid']['bridge'],
    'urn:Belkin:device:controllee:1': config['akcDtid']['switch'],
    // 'urn:Belkin:device:sensor:1': config['akcDtid']['motion'],
    // 'urn:Belkin:device:maker:1': config['akcDtid']['maker'],
    'urn:Belkin:device:insight:1': config['akcDtid']['insight'],
    // 'urn:Belkin:device:lightswitch:1': config['akcDtid']['lightSwitch']
  }
  this._client = new SSDPClient()
  this._mapWemoDevices = {}

  EventEmitter.call(this)
}
// Inherits from EventEmitter.
Util.inherits(Wemo, EventEmitter)

// Implements DISCOVER
Wemo.prototype.init = function () {
  // Discover Wemos
  logger.info('Discover Wemo devices... please wait')
  this._refreshWemoDevicesList()
  this._updateAllBinaryState()
  this._scheduleUpdateBinaryState()
  this._updateAllInsightParams()
  this._scheduleUpdateInsightParams()
}

var _getRequest = function _getRequest (location) {
  return new Promise(function (resolve, reject) {
    var req = Http.get(location, function (res) {
      var data = ''
      logger.silly('STATUS: ' + res.statusCode)
      logger.silly('HEADERS: ' + JSON.stringify(res.headers))
      res.setEncoding('utf8')
      res.on('data', function (chunk) {
        logger.silly('BODY: ' + chunk.length)
        data += chunk
      })
      res.on('end', function () {
        logger.silly('No more data in response.')
        resolve(data)
      })
    })
    req.on('error', function (e) {
      logger.debug('Got error: ' + e.message)
      reject(e.message)
    })
  })
}
var _request = function _request (config) {
  return new Promise(function (resolve, reject) {
    var req = Http.request(config.options, function (res) {
      var data = ''
      logger.silly('STATUS: ' + res.statusCode)
      logger.silly('HEADERS: ' + JSON.stringify(res.headers))
      res.setEncoding('utf8')
      res.on('data', function (chunk) {
        logger.silly('BODY: ' + chunk.length)
        data += chunk
      })
      res.on('end', function () {
        logger.silly('No more data in response.')
        resolve(data)
      })
    })
    req.on('error', function (e) {
      logger.debug('Got error: ' + e.message)
      reject(e.message)
    })
    req.write(config.payload)
    req.end()
  })
}

var _extractResponseData = function _extractResponseData (data) {
  return new Promise(function (resolve, reject) {
    Xml2js.parseString(data, { explicitArray: false }, function (err, result) {
      if (err) {
        reject(err)
      } else {
        logger.silly('xml -> JSON: ', JSON.stringify(result))
        resolve(result)
      }
    })
  })
}

Wemo.prototype._refreshWemoDevicesList = function () {
  logger.debug('_refreshWemoDevicesList')
  var self = this
  this._discoverSSDP(function onDeviceDiscovered (location) {
    self._getWemoDetail(location).then(function (deviceM) {
      if (!deviceM) {
        return
      }
      var udn = deviceM['UDN']
      // UDN stands for Universal Device Name, like uuid:Socket-1_0-221244K1100711, UDN as ProxyDeviceInternalId
      if (!self._mapWemoDevices[udn]) {
        logger.info('Belkin Wemo discovered: ' + deviceM['friendlyName'] + ' (' + deviceM['deviceType'] + ')')
        logger.info('Belkin Wemo discovered: ' + JSON.stringify(deviceM))
        self._mapWemoDevices[udn] = deviceM
        logger.debug('UDN', udn)
        logger.debug('friendlyName', deviceM['friendlyName'])
        logger.debug('deviceType', deviceM['deviceType'])
        logger.debug('akcDtid', self.DEVICE_TYPE_2_AKC_DTID[deviceM['deviceType']])
        self.emit('newDevice', {
          proxyDeviceInternalId: udn,
          proxyDeviceName: deviceM['friendlyName'],
          proxyDeviceTypeName: deviceM['deviceType'],
          akcDtid: self.DEVICE_TYPE_2_AKC_DTID[deviceM['deviceType']],
          proxyDeviceData: {}
        })
        deviceM['binaryState'] = 'unknown'
      } else {
        logger.debug('Belkin Wemo still found: ' + deviceM['friendlyName'] + ' (' + deviceM['deviceType'] + ')')
        logger.debug('Update device data')
        deviceM['binaryState'] = self._mapWemoDevices[udn]['binaryState']
        self._mapWemoDevices[udn] = deviceM
      }
    }) // A typical device include the part of setupXML -> <device>
      .catch(function (error) {
        logger.warn(error)
      })
  }, function onError (error) {
    logger.warn(error)
  })
}

Wemo.prototype._soapAction = function (udn, serviceType, action, messageBody) {
  var soapReq = {
    'soapenv:Envelope': {
      '$': {
        'xmlns:soapenv': 'http://schemas.xmlsoap.org/soap/envelope/',
        'soapenv:encodingStyle': 'http://schemas.xmlsoap.org/soap/encoding/'
      },
      'soapenv:Body': { }
    }
  }

  if (messageBody) {
    soapReq['soapenv:Envelope']['soapenv:Body']['message:' + action] = messageBody
  } else {
    soapReq['soapenv:Envelope']['soapenv:Body']['message:' + action] = {}
  }

  soapReq['soapenv:Envelope']['soapenv:Body']['message:' + action]['$'] = {
    'xmlns:message': serviceType
  }

  logger.silly('soapReq', JSON.stringify(soapReq))
  var payload = new Xml2js.Builder().buildObject(soapReq)
  logger.silly('messageBody', messageBody)
  logger.silly('payload', payload)
  var thisDevice = this._mapWemoDevices[udn]
  var location = Url.parse(thisDevice['location'])
  logger.silly('location', JSON.stringify(location))
  var service = undefined
  for (var i in thisDevice['serviceList']['service']) {
    if (thisDevice['serviceList']['service'][i]['serviceType'] === serviceType) {
      service = thisDevice['serviceList']['service'][i]
      break
    }
  }

  var options = {
    hostname: location.hostname,
    port: location.port,
    path: service['controlURL'],
    method: 'POST',
    headers: {
      'SOAPAction': '"' + serviceType + '#' + action + '"', // this line has been a bug --> a header need doublequote
      'Content-Type': 'text/xml; charset="utf-8"',
      'Content-Length': payload.length
    }
  }
  logger.silly('options', options)

  var deviceChecker = function deviceChecker () {
    return new Promise(function (resolve, reject) {
      if (!(thisDevice && location && service)) {
        reject('Device|location|service not found')
      } else {
        resolve({ options: options, payload: payload })
      }
    })
  }

  return deviceChecker().then(_request).then(_extractResponseData).then(function (result) {
    return Promise.resolve(result['s:Envelope']['s:Body']['u:' + action + 'Response'])
  }).catch(function (reason) {
    logger.error('Error executing action ' + action + ' on the device ' + udn + ': ' + reason)

    if(action != 'GetBinaryState') // avoid false warning on Raspberry PI (this action fails only once)
    {
      errors.push('Error executing action ' + action + ' on the device ' + udn + ': ' + reason)
    }
  })
}

Wemo.prototype._getWemoDetail = function (deviceSetupLocation) {
  logger.debug('_getWemoDetail', deviceSetupLocation)

  function setLocation (result) {
    result.root.device['location'] = deviceSetupLocation
    return result.root.device
  }

  return _getRequest(deviceSetupLocation).then(_extractResponseData).then(function (result) {
    return Promise.resolve(setLocation(result))
  // .set('AKCConnected', false)
  }).catch(function (reason) {
    logger.warn('Cannot get Wemo info: ' + reason)
    errors.push('Cannot get Wemo info: ' + reason)
  })
}

Wemo.prototype._discoverSSDP = function (onDeviceDiscovered, onError) {
  logger.debug('_discoverSSDP')
  var self = this
  var magicServiceName = 'urn:Belkin:service:metainfo:1' // We suppose all devices have this service
  var handleResponse = function handleResponse (headers, statusCode, rinfo) {
    logger.silly('handleResponse')
    logger.silly(headers, statusCode, rinfo)
    if (statusCode === 200) {
      // Everything ok
      if (headers['USN'].endsWith('::' + magicServiceName)) {
        // USN for Universal Service Name
        logger.silly('Found a device with a correct device type')
        if (onDeviceDiscovered) {
          onDeviceDiscovered(headers['LOCATION'])
        }
      } else {
        logger.silly('Found a device with a unknown device type: ' + headers['USN'])
      }
    } else if (onError) {
      onError('SSDP search request error: ' + statusCode + ', ' + JSON.stringify(headers))
      errors.push('SSDP search request error: ' + statusCode + ', ' + JSON.stringify(headers))
    }
  }

  self._client.removeAllListeners('response', handleResponse)
  self._client.addListener('response', handleResponse)
  self._client.search(magicServiceName)
}

Wemo.prototype._getBinaryState = function (udn) {
  var self = this
  var thisDevice = this._mapWemoDevices[udn]
  logger.debug('Get binary state for ' + thisDevice['friendlyName'])
  this._soapAction(udn, 'urn:Belkin:service:basicevent:1', 'GetBinaryState', null).then(function (data) {
    logger.debug('data', data)

    if(thisDevice['deviceType'] === 'urn:Belkin:device:sensor:1')
    {
        self.emit('newMessage', udn, {
          'state': data['BinaryState'] !== '0' ? 'motion' : 'no motion',
          'internalState': data['BinaryState']
        })
    }
    else {
        self.emit('newMessage', udn, {
          'state': data['BinaryState'] !== '0' ? 'on' : 'off',
          'internalState': data['BinaryState']
        })
    }
  }).catch(logger.error)
}

Wemo.prototype._getBinaryStateSendChangedState = function (udn) {
  var self = this
  var thisDevice = this._mapWemoDevices[udn]
  logger.silly('Get binary state for ' + thisDevice['friendlyName'])
  this._soapAction(udn, 'urn:Belkin:service:basicevent:1', 'GetBinaryState', null).then(function (data) {
    logger.silly('data', data)
    if (data) {
      if (thisDevice['binaryState'] !== data['BinaryState']) {
        logger.debug('State is different send a new state')
        thisDevice['binaryState'] = data['BinaryState']
        self._mapWemoDevices[udn] = thisDevice
        if(thisDevice['deviceType'] === 'urn:Belkin:device:sensor:1')
        {
            self.emit('newMessage', udn, {
              'state': data['BinaryState'] !== '0' ? 'motion' : 'no motion',
              'internalState': data['BinaryState']
            })
        }
        else {
            self.emit('newMessage', udn, {
              'state': data['BinaryState'] !== '0' ? 'on' : 'off',
              'internalState': data['BinaryState']
            })
        }
      }
    } else {
      logger.debug('Can not contact device (get state): ' + thisDevice['friendlyName'] + '/' + udn)

      // avoid false warning on Raspberry PI (this action fails only once):
      // errors.push('Can not contact device (get state): ' + thisDevice['friendlyName'] + '/' + udn)
    }
  }).catch(logger.error)
}

Wemo.prototype._setBinaryState = function (udn, binaryState) {
  var thisDevice = this._mapWemoDevices[udn]
  logger.debug('Set binary state for ' + thisDevice['friendlyName'])
  var message = {
    'UDN': udn,
    'BinaryState': binaryState & 1 // convert to a number
  }
  this._soapAction(udn, 'urn:Belkin:service:basicevent:1', 'SetBinaryState', message).then(function (data) {
    logger.debug(data)
  }).catch(logger.error)
}

Wemo.prototype._getInsightParams = function (udn) {
  var self = this
  var thisDevice = this._mapWemoDevices[udn]
  logger.debug('Get binary state for ' + thisDevice['friendlyName'])
  this._soapAction(udn, 'urn:Belkin:service:insight:1', 'GetInsightParams', null).then(function (data) {
    logger.debug('data', data)
    var params = data['InsightParams'].split('|')
    self.emit('newMessage', udn, {
      'state': params[0] !== '0' ? 'on' : 'off',
      'internalState': params[0],
      'lastChangeTimestamp': params[1], // in [second]
      'lastOnTime': params[2], // in [second]
      'todayOnTime': params[3], // in [second]
      'accumulatedOnTime': params[4], // in [second]
      'timeWindowSpan': params[5], // in [second]
      'averagePower': params[6], // in [Watt]
      'instantPower': params[7] / 1000, // in [mW], ==> [W]
      'todayConsumedEnergy': params[8] / 1000, // in [mW*min] ==> [W*min]
      'accumulatedConsumedEnergy': params[9] / 1000, // in [mW*min] ==> [W*min]
      'powerThreshold': params[10] / 1000 // in [mW] ==> [W]
    })
  }).catch(logger.error)
}

Wemo.prototype._setPowerThreshold = function (udn, threshold) {
  var thisDevice = this._mapWemoDevices[udn]
  logger.debug('Set binary state for ' + thisDevice['friendlyName'])
  var message = { 'PowerThreshold': threshold }
  this._soapAction(udn, 'urn:Belkin:service:insight:1', 'SetPowerThreshold', message).then(function (data) {
    logger.debug(data)
  }).catch(logger.error)
}

Wemo.prototype._getPowerThreshold = function (udn) {
  var thisDevice = this._mapWemoDevices[udn]
  logger.debug('Set binary state for ' + thisDevice['friendlyName'])
  this._soapAction(udn, 'urn:Belkin:service:insight:1', 'GetPowerThreshold', null).then(function (data) {
    logger.debug(data)
  }).catch(logger.error)
}

Wemo.prototype._resetPowerThreshold = function (udn) {
  var thisDevice = this._mapWemoDevices[udn]
  logger.debug('Set binary state for ' + thisDevice['friendlyName'])
  this._soapAction(udn, 'urn:Belkin:service:insight:1', 'ResetPowerThreshold', null).then(function (data) {
    logger.debug(data)
  }).catch(logger.error)
}

Wemo.prototype.scheduledUpdate = function (deviceInfo) {
  logger.debug('Update device list')
  this._refreshWemoDevicesList()
/*
Object.keys(this._mapWemoDevices)
.forEach(udn => {
  self._getBinaryStateSendChangedState(udn)
})
*/
}

Wemo.prototype._updateAllBinaryState = function () {
  var self = this
  logger.debug('Update binary state')
  Object.keys(self._mapWemoDevices).forEach(function (udn) {
    self._getBinaryStateSendChangedState(udn)
  })
}

Wemo.prototype._scheduleUpdateBinaryState = function () {
  if (this._updateBinaryStateTimeout) {
    clearTimeout(this._updateBinaryStateTimeout)
  }

  var self = this
  this._updateBinaryStateTimeout = setTimeout(function () {
    self._updateAllBinaryState()
    self._scheduleUpdateBinaryState()
  }, this._config.binaryStateScheduleUpdatePeriodMs)
}

Wemo.prototype._updateAllInsightParams = function () {
  var self = this
  logger.debug('Update insight parameters')
  for (var udn in self._mapWemoDevices) {
    logger.debug('Binary state device: ' + self._mapWemoDevices[udn]['binaryState'])
    if (self._mapWemoDevices[udn]['deviceType'] === 'urn:Belkin:device:insight:1' && self._mapWemoDevices[udn]['binaryState'] !== '0') {
      logger.debug('  -> yes')
      self._getInsightParams(udn)
    }
  }
}

Wemo.prototype._scheduleUpdateInsightParams = function () {
  if (this._updateInsightParamsTimeout) {
    clearTimeout(this._updateInsightParamsTimeout)
  }

  var self = this
  this._updateInsightParamsTimeout = setTimeout(function () {
    self._updateAllInsightParams()
    self._scheduleUpdateInsightParams()
  }, this._config.insightParamsScheduleUpdatePeriodMs)
}

// Implements ACTIONS
Wemo.prototype.setOffAction = function (deviceInfo) {
  logger.debug('setOff: ' + deviceInfo.friendlyName)
  this._setBinaryState(deviceInfo.proxyDeviceInternalId, false)
}

Wemo.prototype.setOnAction = function (deviceInfo) {
  logger.debug('setOn')
  this._setBinaryState(deviceInfo.proxyDeviceInternalId, true)
}

Wemo.prototype.toggleAction = function (deviceInfo) {
  logger.debug('toggle')
  var self = this
  var udn = deviceInfo.proxyDeviceInternalId
  this._soapAction(udn, 'urn:Belkin:service:basicevent:1', 'GetBinaryState', null).then(function (data) {
    logger.debug('data', data)
    if (data['BinaryState'] === '0') {
      // possible values : '0'|'1'|'Error'
      self._setBinaryState(udn, true)
    } else {
      self._setBinaryState(udn, false)
    }
    self._getBinaryStateSendChangedState(udn)
  }).catch(logger.error)
}

Wemo.prototype.setStateAction = function (deviceInfo, actionParams) {
  logger.debug('setState')
  this._setBinaryState(deviceInfo.proxyDeviceInternalId, actionParams.state)
  this._getBinaryStateSendChangedState(deviceInfo.proxyDeviceInternalId)
}

Wemo.prototype.getStateAction = function (deviceInfo) {
  logger.debug('getState')
  this._getBinaryState(deviceInfo.proxyDeviceInternalId)
}

Wemo.prototype.getInsightParamsAction = function (deviceInfo) {
  logger.debug('getInsightParams')
  this._getInsightParams(deviceInfo.proxyDeviceInternalId)
}

Wemo.prototype.getStatus = function () {
  if(errors.length > 0)
  {
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
