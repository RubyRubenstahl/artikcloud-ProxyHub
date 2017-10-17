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

  /* using the appropriate libraries discover local devices and then */
  /* emit  "newDevice" for each device found */
  this.emit('newDevice', {
    'proxyDeviceInternalId': 'proxyDeviceInternalId',
    'proxyDeviceName': 'proxyDeviceName',
    'proxyDeviceTypeName': 'proxyDeviceTypeName',
    'akcDtid': 'artikCloudDeviceTypeId',
    'proxyDeviceData': '(custom) proxyDeviceData'
  })

  /* send a device status message whenever you want using the "newMessage" event */
  this.emit('newMessage',
    'proxyDeviceInternalId',
    { 'state': 'on' }
  )
}

/**
 * Device on-demand
 */
Template.prototype.addNewDevice = function () {

  /* you can also arbitrarily declare a device */
  /* emit 1 "newDevice"  */
  this.emit('newDevice', {
    'proxyDeviceInternalId': 'proxyDeviceInternalId',
    'proxyDeviceName': 'proxyDeviceName',
    'proxyDeviceTypeName': 'proxyDeviceTypeName',
    'akcDtid': 'artikCloudDeviceTypeId',
    'proxyDeviceData': '(custom) proxyDeviceData'
  })

  /* 
   * Each time such device is linked to the user's ARTIK Cloud account, a new device 
   * of the same kind will "pop-up" as a suggestion to link to the ARTIK Cloud account
   * This device could represent a service (e.g. Shell proxy, TTS player, Media player), 
   * rather than a physical device.
   */
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
  /* return {
    'level': 'ERROR',
    'message': 'You should set your ACME Corporation's account credentials in the proxy's User Parameters',
    'code': 401
  } */

  /* Alert the user to perform an action on the device that should be on-boarded */
  /* return {
    'level': 'WARNING',
    'message': 'You should press your device authentication button',
    'code': 403
  } */
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
 * actionParams: ARTIK Cloud received action parameters JSON map (i.e.)
 */
Template.prototype.setOnAction = function (proxyDeviceInfo) {
  // actionParams map can be ommited for action with no parameters
}

Template.prototype.setOffAction = function (proxyDeviceInfo) {

}

Template.prototype.setLevelAction = function (proxyDeviceInfo, actionParams) {
  var level = actionParams.level
}

Template.prototype.setDefaultLevelAction = function (proxyDeviceInfo, actionParams) {
  // retrieve the default level from the user parameters on proxy
  var userParams = config.public.userParameters
  var level = parseInt(userParams[1].value)
}

Template.prototype.setPreferedLevelAction = function (proxyDeviceInfo, actionParams) {
  // retrieve the prefered level from the user parameters on device
  var level = parseInt(proxyDeviceInfo.userParametersPerDevice.preferedLevel)
}

Template.prototype.validateUserParameters = function (userParams) {
  logger.debug(userParams)
}
