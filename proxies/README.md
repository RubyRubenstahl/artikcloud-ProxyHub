# ARTIK Cloud Proxy

You can extend ARTIK Cloud Proxy Hub by adding a new proxy. This article teaches you how to do it.

**What is a proxy?** 

The proxy can send local device data (sensors) to the cloud and receives action from the cloud (enable actuators).

The proxy is in charge of:
 - Mapping a local device (physical) to an ARTIK Cloud device (virtual)
 - Relaying data from the local device to the cloud
 - Relaying action from the cloud to local device
 - This relaying could be through an hub / intermediate software / manufacturer SDK / protocol (e.g. Zigbee, Z-Wave) / external APIs

## Create a proxy (find an example)

 - Duplicate the _template folder in artik-proxy-hub/proxies
 - Rename it as you want (folder name starting with an '_' will not be loaded)
 - Edit the package.json and template.js content (e.g. project and class name) accordingly
 - Import the API libraries you need in package.json. Running "npm install' in the root of the Proxy Hub will install these libraries

## Add discover

 - If you have not created it yet, create an AKC device type + manifest, with the appropriate device data fields + actions name that you want to support on ARTIK Cloud Developer Portal. Note its Device Type ID (DTID).
 - In the init() function of JS file, using the appropriate libraries discover local devices, and then declare them by emitting a new device event, like below:
 ~~~ javascript
 this.emit('newDevice', {
  'proxyDeviceInternalId': 'proxyDeviceInternalId',
  'proxyDeviceName': 'proxyDeviceInternalId',
  'proxyDeviceTypeName': 'proxyDeviceInternalId',
  'akcDtid': 'artikCloudDeviceTypeId',
  'proxyDeviceData': 'proxyDeviceData'
  })
 ~~~

proxyDeviceInternalId: you manage it as you want
proxyDeviceName: choose a relevant device name
proxyDeviceTypeName: internal device type name
akcDtid: device type ID on ARTIK Cloud
proxyDeviceData: custom data that you manage yourself

## Declare a device 

You can also arbitrarily declare a device in the addNewDevice() function :

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
This device could represent a service (e.g. Shell proxy, TTS player, Media player), rather than a physical device.

## Add send status

Simply emit a new message event, with the JSON message describing the device status
~~~ javascript
this.emit('newMessage',
  'proxyDeviceInternalId',
  { 'state': 'on' }
)
~~~

## Add actions

For each action defined on the device type's manifest, create a function post fixed by "Action" (e.g. setStateAction)
~~~ javascript
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
Template.prototype.setStateAction = function (proxyDeviceInfo, actionParams) {
}
~~~

As its name implies, the actionParams object contains the action's parameters (as JSON map).

## Add schedule update

Using the scheduledUpdate function, you could perform processing at a regular interval. Noticeably, refreshing the devices statuses.
~~~ javascript
Template.prototype.scheduledUpdate = function () { }
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