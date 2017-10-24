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

// /**
//  *  Add a discoverable device
//  *
//  *  The following is an example, which use faked 3rd party device libary
//  *  called sdk_bluetoothlock. For working examples, consult
//  *  ../philips-hue/
//  *  ../wemo/
//  *
//  */
// Template.prototype.init = function () {
//   /* Use the appropriate libraries to discover local devices and then 
//    * emit  "newDevice" for each device found. The discovered device will appear 
//    * in the hub UI.
//    * device_info: device data from the discovered device
//    */
//   device_info = sdk_bluetoothlock.onDiscover( function(device_info){
//     this.emit('newDevice', {
//       'proxyDeviceInternalId': device_info.id,
//       'proxyDeviceName': device_info.name,
//       'proxyDeviceTypeName': 'ProxyDT',
//       'akcDtid': 'dt1234',
//       'proxyDeviceData': device_info.data
//     })
    
//     // The following emit function will send a message to ARTIK Cloud. Payload format should be consistent
//     // the corresponding device Manifest. Here it is assumed that payload is {'state', string}
//     this.emit('newMessage', device_info.id, { 'state': device_info.data.status })
//   })
  
//   // If needed, send status massege to ARTIK Cloud upon state of the device changes
//   sdk_bluetoothlock.onNewEvent( function(device_info){
//     this.emit('newMessage', device_info.id, { 'state': device_info.data.status })
//   })

//   sdk_bluetoothlock.startDiscovery()
// }
//
// //No need to implement the following for a discoverable device
// //Template.prototype.addNewDevice = function () { }

/**
 * OR Add Device on-demand (example: ../ttsplayer/*.js)
 * 
 */
Template.prototype.addNewDevice = function () {

  /* you can also arbitrarily declare a device */
  /* emit 1 "newDevice"  */
  this.emit('newDevice', {
    'proxyDeviceInternalId': 'proxyDeviceInternalId',
    'proxyDeviceName': 'proxyDeviceName',
    'proxyDeviceTypeName': 'proxyDeviceTypeName',
    'akcDtid': 'artikCloudDeviceTypeId', // From ARTIK Cloud: https://developer.artik.cloud/documentation/getting-started/basics.html#device-id-and-device-type
    'proxyDeviceData': '(custom) proxyDeviceData' //
  })

  // The following emit function will send a message to ARTIK Cloud. Payload format should be consistent
  // with the corresponding device Manifest. Here it is assumed that payload is {'state', string}
  this.emit('newMessage', proxyDeviceInternalId, { 'state': 'off' })
 }

/**
 * Do something on schedule.
 * The following method is called only if 'scheduleUpdate' field is true
 * in config.json.
 *
 * An example in config.json: { scheduleUpdate: true, scheduleUpdatePeriodMs:XXX }
 * The method uses the value of 'scheduleUpdatePeriodMs'.
 */
Template.prototype.scheduledUpdate = function () { }

/* In getStatus() function, you can reflect your current proxy status.
* You could warn the user on next action to perform.
*  
* For example:
* PhilipsHue.prototype.getStatus = function () {
*   if (this.hueBridgeLinkButtonHasNotBeenPressed) {
*     return {
*       'level': 'ERROR',
*       'message': 'Please press your Hue Bridge Link Button to discover your lights',
*       'code': 403
*     }
*   }
*   else {
*     return {
*       'level': 'OK',
*       'message': '',
*       'code': 200
*     }
*   }
* }
*
* The level can be 'OK', 'WARNING', or 'ERROR' and the code can be 200, 401, or 403. 
* Alert the user to perform an action
* return {
*    'level': 'ERROR',
*    'message': 'You should set your ACME Corporation's account credentials in the proxy's User Parameters',
*    'code': 401
*  } 
*
* Alert the user to perform an action on the device that should be on-boarded
* return {
*    'level': 'WARNING',
*    'message': 'You should press your device authentication button',
*    'code': 403
*  }
*
*/
Template.prototype.getStatus = function () {
  /* The Proxy is up and running */
  return {
    'level': 'OK',
    'message': '',
    'code': 200
  }

 }

/**
 * Actions: create 1 function for each action postfix with Action
 * actionParams: ARTIK Cloud received action parameters JSON map (i.e.)
 */
// manifest action is named "setOn" -> name of the function is "setOnAction"
Template.prototype.setOnAction = function (proxyDeviceInfo) {
  // actionParams map can be ommited for action with no parameters
}

// manifest action is named "setOn" -> name of the function is "setOnAction"
Template.prototype.setOffAction = function (proxyDeviceInfo) {

}

// manifest action is named "setLevel" -> name of the function is "setLevelAction"
Template.prototype.setLevelAction = function (proxyDeviceInfo, actionParams) {
  // Act on Action to set the state of the device managed by the hub and use
  // received parameter to perform that operation.
  var level = actionParams.level
  // do more
}

Template.prototype.validateUserParameters = function (userParams) {
  logger.debug(userParams)
}
