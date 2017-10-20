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
  /* Use the appropriate libraries to discover local devices and then */
  /* emit "newDevice" for each device found */
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

To send, simply call emit() with 'newMessage' type. In addition, pass in the JSON message describing the device status. The message format should be consistent with the corresponding device Manifest.

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

You can perform update at a regular interval. For example, refresh the devices status and send them to ARTIK Cloud. To do so, you need to put information into config.json and implement scheduledUpdate function in javascript file. The following is an example.

~~~ json
// in config file
  "scheduleUpdate": true,
  "scheduleUpdatePeriodMs": 30000,
~~~


~~~ javascript
Template.prototype.scheduledUpdate = function () { 
  // Do device refreshing and status update with ARTIK Cloud
}
~~~

## Add user parameters by proxy
Default user parameters by proxy: 

Define them in the userParameters array in the config.json file (at the root of the proxy sub-folder).
They could store user credentials on external platform, for instance on Nest proxy plug-in:
~~~ javascript
{
  "public": {
    "displayName": "nest",
    "description": "nest",
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
    "userParametersPerDevice": {},
    "akcDtNames": [
      "Nest Thermostat Proxy"
    ]
  },
  "scheduleUpdatePeriodMs": 60000
}
~~~

Access user parameters by proxy from proxy code:

The configuration object (config) will be already loaded, access the field you are interested in:
~~~ javascript
var userParams = config.public.userParameters
username = userParams[0].value
password = userParams[1].value
~~~

Edit user parameters by proxy from proxy code:

Update the configuration object (config), serialize it as JSON objet and write it to the config.json file:
~~~ javascript
this._config.username = user
var configPath = path.resolve(__dirname, 'config.json')
Fs.writeFileSync(configPath, JSON.stringify(this._config, null, 2))
~~~

Validate parameters

You could use the validateUserParameters to check the parameters provided by the user. Throw any JavaScript exception to warn the user. 

~~~ javascript
Template.prototype.validateUserParameters = function (userParams) {
  logger.debug(userParams)
}
~~~ 

## Add user parameters by device

Default user parameters by device:
Pre-fill the userParametersPerDevice group in the config.json file (at the root of the proxy sub-folder)
~~~ json
{
  "public": {
    "displayName": "Media Player",
    "description": "Play media file from ARTIK Cloud",
    "userParametersPerDevice": {
      "mediaplayer": {
        "displayName": "Media player command",
        "value": "mplayer",
        "description": "Shell command used to play media."
      }
    },
    "akcDtNames": [
      "Media Player Proxy"
    ]
  },
  "scheduleUpdatePeriodMs": 5000,
  "akcDtid": {
    "mediaPlayer": "dt7e7b76ae3d094678b8287da8fcff7c77"
  }
}
~~~

The display name, value and description will be reflected on the ProxyHub Web Interface.

Access user parameters by device from proxy code

You can access them from proxyDeviceInfo.userParametersPerDevice object
~~~ javascript
Shell.prototype.storeCommandToGetState = function (proxyDeviceInfo)
{
  if ("state" in proxyDeviceInfo.userParametersPerDevice)
    commandToGetState[proxyDeviceInfo.proxyDeviceInternalId] = proxyDeviceInfo.userParametersPerDevice.state
}
~~~

Edit user parameters by device from proxy code

## Logging
Include our custom logging module
~~~ javascript
var ProxyHubLogger = require('../../lib/proxy-hub-logger.js')ogger = ProxyHubLogger('<Proxy plug-in name>', this._config)
logger = ProxyHubLogger(<name display in log>, <config of the proxy>
~~~

Configuration

You can change your proxy plug-in logging level from the config.json file.
If you do not specify a filename, the logs will be displayed on your terminal.

~~~json
"log": {
  "level": "debug",
  "filename": "log/proxyhub.log"
}
~~~

Usage example

~~~json
logger.log('debug', 'Create MediaPlayer proxy')
logger.debug("userParams = " + JSON.stringify(userParams))
~~~

## Getting the proxy status

On the getStatus() function, you can reflect your current proxy plug-in status.
You could warn the user on next action to perform.

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