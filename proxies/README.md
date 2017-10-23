# ARTIK Cloud Proxy

You can extend ARTIK Cloud Proxy Hub by adding a new proxy. This article teaches you how to do it.

**What is a proxy?** 

The proxy can send local device data (sensors) to the cloud and receives action from the cloud (enable actuators).

The proxy is in charge of:
 - Mapping a local device (physical) to an ARTIK Cloud device (virtual)
 - Relaying data from the local device to the cloud
 - Relaying action from the cloud to local device
 - This relaying could be through an hub / intermediate software / manufacturer SDK / protocol (e.g. Zigbee, Z-Wave) / external APIs

## Preparation

 - If you have not created the corresponding device type for this proxy yet, create an ARTIK Cloud device type and define the Manifest. Note its Device Type ID (DTID).
 - Duplicate the _template folder in artik-proxy-hub/proxies
 - Rename it to a meaningful name (folder name starting with an '_' will not be loaded)
 - Edit the package.json
 -- Fill in "name" field with a meaningful name 
 -- Import the API libraries you use in JS file.
 - Update template.js:
 -- Rename file
 -- Rename Template class  

**The rest of the article is about how to modify the JavaScript file. **

## Add or discover a device

There are two types of devices: discoverable and on-demand.
You implement 'init()' for a discoverable device and 'addNewDevice()' for on-demaind one. 

### Discover a device

In the init() function of JS file, discover local devices, and then declare them by emitting a 'newDevice' event. To discove a device, you normally need the libraries provided by the manufacture of that type of devices. 

The following code snippet uses the faked 3rd party device libary called sdk_bluetoothlock. For working examples, consult ../philips-hue/ and ../wemo/.

~~~ javascript
 bleLocker.prototype.init = function () {
  /* Use the appropriate libraries to discover local devices, and then */
  /* emit "newDevice" for each device found. This will display the device 
   * in the hub UI.
   *
   * device_info: device data from the discovered device
   */
  device_info = sdk_bluetoothlock.onDiscover( function(device_info){
    this.emit('newDevice', {
      'proxyDeviceInternalId': device_info.id,
      'proxyDeviceName': device_info.name,
      'proxyDeviceTypeName': 'ProxyDT',
      'akcDtid': 'dt1234',
      'proxyDeviceData': device_info.data
    })
    
    // The following emit function will send a message to ARTIK Cloud. Payload format should be consistent the corresponding device Manifest. Here it is assumed that payload is {'state', boolean}
    this.emit('newMessage', device_info.id, { 'state': device_info.data.status })
  })
  
  // If needed, send status massege to ARTIK Cloud upon state of the device changes
  sdk_bluetoothlock.onNewEvent( function(device_info){
    this.emit('newMessage', device_info.id, { 'state': device_info.data.status })
  })

  sdk_bluetoothlock.startDiscovery()
}
~~~

proxyDeviceInternalId: you manage it as you want
proxyDeviceName: choose a relevant device name
proxyDeviceTypeName: the device type name shown in the hub. You define it.
akcDtid: [ARTIK Cloud device type ID](https://developer.artik.cloud/documentation/getting-started/basics.html#device-id-and-device-type)
proxyDeviceData: custom data that you manage yourself

For certain fields, you may consider put their values in the config.json and read the values from it. 

Leave addNewDevice() empty for a discoverable device.

### Add an on-demain device

You implement addNewDevice() function and leave init() empty. 

The following code snippet illustrates the implementation of addNewDevice(). For working examples, consult ../shell/ and ../mediaplayer/.

 ~~~ javascript
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
 ~~~

Each time such device is linked to the user's ARTIK Cloud account, a new device of the same kind will "pop-up" as a suggestion to link to the ARTIK Cloud account.

## Send status to ARTIK Cloud

The proxy should have a logic to send status of the device to ARTIK Cloud from time to time (e.g. init()).

To send, call emit() with 'newMessage' type. Pass in the JSON message describing the device status. The message format should be consistent to the corresponding device Manifest defined in ARTIK Cloud.

~~~ javascript
this.emit('newMessage',
  'proxyDeviceInternalId',
  { 'state': 'on' }
)
~~~

## Receive Actions from ARTIK Cloud

For each action defined on the device Manifest, create a function post fixed by "Action". For example, if the Manifes defines Action "setState", you implements function setStateAction here.

~~~ javascript

Template.prototype.setOnAction = function (proxyDeviceInfo) {
  // actionParams map can be ommited for action with no parameters
}
~~~

If an Action has parameters, you can get them from actionParams as a JSON map:  
~~~ javascript
Template.prototype.setStateAction = function (proxyDeviceInfo, actionParams) {
  // Act on Action to set the state of the device managed by the hub and use
  // received parameter to perform that operation.
}
~~~

## Schedule update

The hub can perform update at a regular interval. For example, refresh the devices status and send them to ARTIK Cloud. To do so, you need to put the  information into config.json and implement scheduledUpdate function in the javascript file. The following is an example:

~~~ json
// in config file
  "scheduleUpdate": true,
  "scheduleUpdatePeriodMs": 30000,
~~~


~~~ javascript
Template.prototype.scheduledUpdate = function () { 
  // Do device refreshing and status update with ARTIK Cloud
  // Use the value of 'scheduleUpdatePeriodMs' from config.json
}
~~~

## Add user parameters for proxy

You can optionally add user parameters for a proxy. For example, use them to store user credentials on the external platform. Define them in the "userParameters" array in the config.json file (at the root of the proxy sub-folder). The following is "userParameters" from config.json for Nest proxy :
~~~ javascript
public: {
  ...
  "userParameters": [
    {
      "name": "username",
      "value": "",
      "type": "string",
      "description": "NEST account login e-mail"
    },
    {
      "name": "password",
      "value": "",
      "type": "password",
      "description": "NEST account password"
    }
  ],
  ...
}
~~~

You can access user parameters within the proxy code as the following:
~~~ javascript
var userParams = config.public.userParameters
username = userParams[0].value
password = userParams[1].value
~~~

You can also update "userParameters" of config.json in the proxy code. You need to do this if the user modifies the parameters via UI. The following example show how to change the user name. In the proxy code, update the configuration object with the one provided by the user, serialize it as JSON objet, and then write it to the config.json file:
~~~ javascript
this._config.username = user
var configPath = path.resolve(__dirname, 'config.json')
Fs.writeFileSync(configPath, JSON.stringify(this._config, null, 2))
~~~

Validate parameters

In your proxy JavaScript code, you could use validateUserParameters() to check the parameters provided by the user. Throw any JavaScript exception to warn the user. 

~~~ javascript
Template.prototype.validateUserParameters = function (userParams) {
  logger.debug(userParams)
}
~~~ 

## Add user parameters for device

You can setup default parameters for a device. Fill the userParametersPerDevice group in the config.json file (at the root of the corresponding proxy sub-folder).

~~~ json
{
  "userParametersPerDevice": {
    "mediaplayer": {
      "displayName": "Media player command",
      "value": "mplayer",
      "description": "Shell command used to play media."
    },
  },
}
~~~

"userParametersPerDevice" can have multiple objects. For each object (e.g."mediaplayer"), displayName, value and description are reflected on the ProxyHub Web Interface like the following:
![Proxy Hub user device parameter](./img/mediaplayer_userDevParam.png)

The proxy code can access device's user parameters via proxyDeviceInfo.userParametersPerDevice object as the following example:
~~~ javascript
 var player = proxyDeviceInfo.userParametersPerDevice.mediaplayer.value
~~~

## Logging

To log, include the logging module and create an logger object as following:
~~~ javascript
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')
logger = ProxyHubLogger(<name display in log>, <config file of the proxy>)
~~~

In config.json, you can specify the logging level and the log file name. If you do not specify a filename, the logs will be displayed on your terminal.

~~~ json
"log": {
  "level": "debug",
  "filename": "log/proxyhub.log"
}
~~~

Blow is an usage example:

~~~json
logger.log('debug', 'Create MediaPlayer proxy')
logger.debug("userParams = " + JSON.stringify(userParams))
~~~

## Get the proxy status

On the getStatus() function, you can reflect the status of the proxy. Optionally warn the user on next action to perform. Bleow is the example.

~~~javascript
PhilipsHue.prototype.getStatus = function () {
  if (this.hueBridgeLinkButtonHasNotBeenPressed) {
    return {
      'level': 'ERROR',
      'message': 'Please press your Hue Bridge Link Button to discover your lights',
      'code': 403
    }
  }
  else {
    return {
      'level': 'OK',
      'message': '',
      'code': 200
    }
  }
}
~~~