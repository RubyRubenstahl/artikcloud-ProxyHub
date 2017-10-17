module.exports = PhilipsHue

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var Winston = require('winston')
var proxyHubLogger = require('../../lib/proxy-hub-logger')
var Fs = require('fs')
var path = require('path');
var Q = require('q');
var hue = require("node-hue-api")
var md5 = require('js-md5');
var os = require("os")

var logger = new (Winston.Logger)()
var lightState = hue.lightState
var HueApi = hue.HueApi
var hueApi = new HueApi()
var host = ""
var userDescription = "ARTIK Cloud Hue proxy"
var username = ""
var api = null
var lastStatusByLightId = {}
var request = require('request')

function PhilipsHue(config) {
  this._config = config

  logger = proxyHubLogger('PHILIPS-HUE', this._config)
  logger.log('debug', 'Philips Hue proxy starting...')
  EventEmitter.call(this)
  this.extractUser = this.extractUser.bind(this)
  this.extractLights = this.extractLights.bind(this)
  this.extractBridges = this.extractBridges.bind(this)
  this.logError = this.logError.bind(this)
  this.linkButtonNotPressedErrorHandler = this.linkButtonNotPressedErrorHandler.bind(this)
  this.init = this.init.bind(this)
  this.synchronizeDevices = this.synchronizeDevices.bind(this)
  this.discoverBridges = this.discoverBridges.bind(this)

}

Util.inherits(PhilipsHue, EventEmitter)

PhilipsHue.prototype.hueBridgeLinkButtonHasNotBeenPressed = false

PhilipsHue.prototype.logError = function (err) {
  logger.log('error', err)
};

PhilipsHue.prototype.linkButtonNotPressedErrorHandler = function (err) {
  logger.log('error', 'Link button has not been pressed. Rechecking in 15 seconds...')
  this.hueBridgeLinkButtonHasNotBeenPressed = true
  logger.log('error', err)
  this.init()
}

PhilipsHue.prototype.discoverBridges = function ()
{
  var deferred = Q.defer()
  var callback = function (error, response, body) {
    if(error)
    {
      deferred.reject(new Error(error))
    }
    else
    {
      var bridges = JSON.parse(body)
      deferred.resolve(bridges);
    }
  }
  request('https://www.meethue.com/api/nupnp', callback)

  return deferred.promise;
}

PhilipsHue.prototype.synchronizeDevices = function () {
  return this.discoverBridges().then(this.extractBridges).fail((function(err){
    this.logError(err)
    logger.error('Retrying to discover bridges')
    this.init()
  }).bind(this))
}

PhilipsHue.prototype.init = function () {
  if(this.hueBridgeLinkButtonHasNotBeenPressed)
    Q.delay(15000).then(this.synchronizeDevices).done()
  else
    this.synchronizeDevices().done()
}

PhilipsHue.prototype.scheduledUpdate = function () {

  if (username)
    this.getLights()

}

PhilipsHue.prototype.validateUserParameters = function (userParams) {
}

PhilipsHue.prototype.getLights = function () {
  return api.getFullState().then(this.extractLights).fail(this.logError)
}

PhilipsHue.prototype.extractUser = function (user) {
  if (!user) {
    logger.log('error', 'Empty user')
    logger.log('error', 'Link button has not been pressed. Rechecking in 15 seconds...')
    throw "Empty user because Link button has not been pressed"
  }
  else {
    this.hueBridgeLinkButtonHasNotBeenPressed = false
    username = user
    if (!this._config.username) {
      this._config.username = user
      var configPath = path.resolve(__dirname, 'config.json')
      Fs.writeFileSync(configPath, JSON.stringify(this._config, null, 2))
    }
    api = new HueApi(host, username)
    return this.getLights()
  }
};

PhilipsHue.prototype.extractBridges = function (bridges) {

  logger.log('debug', 'Bridges:')
  for (var bridge of bridges) {
    logger.log('debug', 'Bridges:')
    logger.log('debug', JSON.stringify(bridge, null, 2))

    // this proxy supports only 1 bridge for the moment
    //host = bridge.ipaddress
    host = bridge.internalipaddress

    if (this._config.username) {
      username = this._config.username
      return this.extractUser(username)
    }
    else {

      return hueApi.registerUser(host, userDescription)
        .then(this.extractUser)
        .fail(this.linkButtonNotPressedErrorHandler)

    }
  }
  this.linkButtonNotPressedErrorHandler('Empty bridges retrying');
};

PhilipsHue.prototype.extractLights = function (fullState) {
  logger.log('debug', 'Lights:')
  logger.log(JSON.stringify(fullState.lights, null, 2))
  for (var light_id in fullState.lights) {
    var light = fullState.lights[light_id]
    this.emit('newDevice', {
      'proxyDeviceInternalId': light_id,
      'proxyDeviceName': light.name,
      'proxyDeviceTypeName': light.type,
      'akcDtid': 'dt6fed9284ed564521abc50681fd247532',
      'proxyDeviceData': '{}'
    })

    var state = "off"

    if (light.state.on)
      state = "on"

    var message = {}
    message.state = state
    message.level = Math.ceil((light.state.bri / 255.0) * 100.0)
    message.effect = light.state.effect
    message.alert = light.state.alert

    var extractLight = function (light_id, message, lightStatus) {
      var rgb = lightStatus.state.rgb
      message.colorRGB = { 'r': rgb[0], 'g': rgb[1], 'b': rgb[2] }

      var lastStatus = lastStatusByLightId[light_id]

      if (!lastStatus) {
        this.emit('newMessage', light_id, message)
        lastStatusByLightId[light_id] = md5(JSON.stringify(message))
      }
      else if (lastStatus != md5(JSON.stringify(message))) {
        this.emit('newMessage', light_id, message)
        lastStatusByLightId[light_id] = md5(JSON.stringify(message))
      }

    };

    api.lightStatusWithRGB(light_id)
      .then(extractLight.bind(this, light_id, message))
      .fail(this.logError)
      .done();
  }
};

// Common actions

PhilipsHue.prototype.setOnAction = function (proxyDeviceInfo) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var message = { "state": "on" }
  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }
  updateStatus = updateStatus.bind(this)
  var state = lightState.create().on()
  api.setLightState(lightId, state).then(updateStatus).done()
}

PhilipsHue.prototype.setOffAction = function (proxyDeviceInfo) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var message = { "state": "off" }
  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }
  updateStatus = updateStatus.bind(this)
  var state = lightState.create().off()
  api.setLightState(lightId, state).then(updateStatus).done()
}

PhilipsHue.prototype.setStateAction = function (proxyDeviceInfo, actionParams) {
  var desiredState = actionParams.state
  desiredState = desiredState.toLowerCase()
  switch (desiredState) {
    case 'on':
      this.setOnAction(proxyDeviceInfo)
      break
    case 'off':
      this.setOffAction(proxyDeviceInfo)
      break
    default:

      break
  }
}

PhilipsHue.prototype.toggleAction = function (proxyDeviceInfo) {
  var self = this;
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var extractLight = function (light) {
    if (light.state.on)
      self.setOffAction(proxyDeviceInfo)
    else
      self.setOnAction(proxyDeviceInfo)
  };
  extractLight = extractLight.bind(this)
  api.lightStatusWithRGB(lightId)
    .then(extractLight)
    .fail(this.logError)
    .done();
}

PhilipsHue.prototype.setLevelAction = function (proxyDeviceInfo, actionParams) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var level = actionParams.level
  var message = { "level": level }
  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }
  updateStatus = updateStatus.bind(this)

  var brightness = (level / 100.0) * 255.0
  brightness = Math.ceil(brightness)
  var state = lightState.create().bri(brightness).on()
  api.setLightState(lightId, state).then(updateStatus).done()
}

PhilipsHue.prototype.setColorRGBAction = function (proxyDeviceInfo, actionParams) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var colorRGB = actionParams.colorRGB

  var message = {
    "colorRGB": {
      "b": colorRGB.blue,
      "g": colorRGB.green,
      "r": colorRGB.red
    }
  }

  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }

  updateStatus = updateStatus.bind(this)

  var state = lightState.create().on().rgb(colorRGB.red, colorRGB.green, colorRGB.blue)
  api.setLightState(lightId, state).then(updateStatus).done()
}

// Blinking actions

PhilipsHue.prototype.setAlertToShortAction = function (proxyDeviceInfo) {

  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var message = { "alert": "short" }

  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }

  updateStatus = updateStatus.bind(this)

  var state = lightState.create().on().alertShort()
  api.setLightState(lightId, state).then(updateStatus).done()
}

PhilipsHue.prototype.setAlertToLongAction = function (proxyDeviceInfo) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var message = { "alert": "long" }

  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }

  updateStatus = updateStatus.bind(this)

  var state = lightState.create().on().alertLong()
  api.setLightState(lightId, state).then(updateStatus).done()
}

PhilipsHue.prototype.setAlertToNoneAction = function (proxyDeviceInfo) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var message = { "alert": "none" }

  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }

  updateStatus = updateStatus.bind(this)

  var state = lightState.create().on().alert("none")
  api.setLightState(lightId, state).then(updateStatus).done()
}

// Effets actions

PhilipsHue.prototype.setEffectToColorLoopAction = function (proxyDeviceInfo) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var message = { "effect": "colorloop" }

  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }

  updateStatus = updateStatus.bind(this)

  var state = lightState.create().on().effect("colorloop")
  api.setLightState(lightId, state).then(updateStatus).done()
}

PhilipsHue.prototype.setEffectToNoneAction = function (proxyDeviceInfo) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var message = { "effect": "none" }

  var updateStatus = function (result) {
    if (result == true)
      this.emit('newMessage', lightId, message)
  }

  updateStatus = updateStatus.bind(this)

  var state = lightState.create().on().effect("none")
  api.setLightState(lightId, state).then(updateStatus).done()
}

// Get data

PhilipsHue.prototype.getDataAction = function (proxyDeviceInfo) {
  var lightId = proxyDeviceInfo.proxyDeviceInternalId
  var extractLight = function (light) {
    var message = {}
    var state = "off"
    if (light.state.on)
      state = "on"
    message.state = state
    message.level = Math.ceil((light.state.bri / 255.0) * 100.0)
    var rgb = light.state.rgb
    message.colorRGB = { 'r': rgb[0], 'g': rgb[1], 'b': rgb[2] }
    message.effect = light.state.effect
    message.alert = light.state.alert
    this.emit('newMessage', lightId, message)
  };
  extractLight = extractLight.bind(this)
  api.lightStatusWithRGB(lightId)
    .then(extractLight)
    .fail(this.logError)
    .done();
}

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
