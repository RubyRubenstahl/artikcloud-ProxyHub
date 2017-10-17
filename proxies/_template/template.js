module.exports = Template

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var Winston = require('winston')
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')

var logger = new (Winston.Logger)()

function Template(config) {
  logger.log('debug', 'Create Template proxy')
  this._config = config
  logger = ProxyHubLogger('TEMPLATE', this._config)
  EventEmitter.call(this)
}

/**
 * Inherits from EventEmitter.
 */
Util.inherits(Template, EventEmitter)

/**
 * Discovery
 */
Template.prototype.init = function () {
  /* emit  "newDevice" for each device found */
  this.emit('newDevice', {
    'proxyDeviceInternalId': 'proxyDeviceInternalId',
    'proxyDeviceName': 'proxyDeviceInternalId',
    'proxyDeviceTypeName': 'proxyDeviceInternalId',
    'akcDtid': 'artikCloudDeviceTypeId',
    'proxyDeviceData': 'proxyDeviceData'
  })

  /* send a device status message whenever you want using the "newMessage" event */
  this.emit('newMessage',
    'proxyDeviceInternalId',
    { 'state': 'on' }
  )
}

/**
 * Do something on schedule defined defined in proxy config
 * if in config.json: { scheduleUpdate: true, scheduleUpdatePeriodMs:XXX }
 * deviceInfo: device data saved on device found
 */
Template.prototype.scheduledUpdate = function () { }

Template.prototype.getStatus = function () {
  /* The Proxy is up and running */
  return {
    'level': 'OK',
    'message': '',
    'code': 200
  }

  /* The level can be 'OK', 'WARNING', or 'ERROR' and the code can be 200, 401, or 403. */

  /* Alert the user to perform an action */
/*   return {
        'level': 'ERROR',
        'message': 'You should set your Acme Corporation's account credentials in the proxy's User Parameters',
        'code': 401
      }   */

    /* Alert the user to perform an action on the device that should be on-boarded */
    /*   return {
            'level': 'WARNING',
            'message': 'You should press your device authentication button',
            'code': 403
          }    */
}

/**
 * Actions: create 1 function for each action postfix with Action
 * proxyDeviceInfo: {
    'proxyName': proxyName,
    'proxyDeviceId': proxyDeviceId,
    'proxyDeviceInternalId': proxyDeviceInternalId,
    'proxyDeviceName': proxyDeviceName,
    'akcDtid': akcDtid,
    'proxyDeviceData': proxyDeviceData
  }
 */
Template.prototype.setOffAction = function (proxyDeviceInfo) { }

Template.prototype.setOnAction = function (proxyDeviceInfo) { }

Template.prototype.validateUserParameters = function (userParams) {
  logger.debug(userParams)
}
