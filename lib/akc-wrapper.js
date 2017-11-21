'use strict'

module.exports = AKCWrapper

var ArtikCloudApi = require('artikcloud-js')
var EventEmitter = require('events').EventEmitter
var fs = require('fs')
var path = require('path')
var Util = require('util')
var https = require('https')
var Url = require('url')
var request = require('request')
var ProxyHubLogger = require('./proxy-hub-logger')
var formidable = require('formidable')
var npm = require('npm')
var unzip = require('unzip-stream')

var AKCWS = require('./akc-ws')

var IdentityProvider = require('./identity-provider')

var logger

function AKCWrapper (config) {
  // init event emitter
  EventEmitter.call(this)
  this.removeAllListeners()

  this._config = {}

  // init AKC
  this._akcClient = ArtikCloudApi.ApiClient.instance
  // initialize map of linked devices
  this._linkedProxyDevices = {}
  this._notLinkedProxyDevices = {}
  // shortcut
  this._akc2ProxyDevices = {}
  this._deferredMessages = {}
  this._closed = false

  if (config) {
    this.init(config)
  }
}
Util.inherits(AKCWrapper, EventEmitter)

var parseUniqueProxyDeviceId = function (proxyDeviceId) {
  return proxyDeviceId.split('.')
}

AKCWrapper.prototype.init = function (config) {
  if (config) {
    this._config = config
  }

  logger = ProxyHubLogger('AKC_WRAPPER', this._config)

  // init AKC
  this._akcClient = ArtikCloudApi.ApiClient.instance
  // initialize map of linked devices
  this._linkedProxyDevices = {}
  this._notLinkedProxyDevices = {}
  // shortcut
  this._akc2ProxyDevices = {}
  this._deferredMessages = {}

  this._ws = new AKCWS(this._config, this._ws)

  var self = this
  this._ws.on('message', function (data) {
    if (data) {
      // Expecting {"type": "<message type>", "ddid": "<destination device id>", "data": "<on/off>", "mid": <message id>}
      var json = JSON.parse(data)
      // Filter out ping messages
      if (json.type !== 'ping') {
        if (json.ddid && json.data && json.data.actions) {
          logger.debug('do we have this device in our table? %s', JSON.stringify(self._akc2ProxyDevices))
          // action!!!!
          if (json.ddid in self._akc2ProxyDevices) {
            logger.info('Action received: ' + data)
            if (self._linkedProxyDevices[self._akc2ProxyDevices[json.ddid]]) {
              self._linkedProxyDevices[self._akc2ProxyDevices[json.ddid]].lastActionTS = Date.now()
            } else if (self._notLinkedProxyDevices[self._akc2ProxyDevices[json.ddid]]) {
              self._notLinkedProxyDevices[self._akc2ProxyDevices[json.ddid]].lastActionTS = Date.now()
            }
            for (var action in json.data.actions) {
              if (json.data.actions.hasOwnProperty(action)) {
                self.emit('newAction', self._akc2ProxyDevices[json.ddid], json.data.actions[action].name, json.data.actions[action].parameters)
              }
            }
          }
        }
      }
    }
  })

  this._ws.on('open', function open () {
    for (var proxyDeviceId in self._linkedProxyDevices) {
      self._addLinkProxyDevice(proxyDeviceId)
    }
  })

  // load historical map of linked device with AKC
  this._loadLinkedDevices()

  this._ws.on('unlinkAkcDevice', (function (akcDeviceId) {

    logger.debug('Unlinking ARTIK Cloud device (id = ' + akcDeviceId + ')')

    var unlinkCallback = (function(){
      this.emit('proxyDevicesUpdate')
    }).bind(this)

    for (var proxyName in this._linkedProxyDevices) {
      var proxyDevice = this._linkedProxyDevices[proxyName]
      if (proxyDevice.akcDeviceId == akcDeviceId) {
        var proxyDeviceId = proxyDevice.proxyDeviceId
        logger.debug('Unlink proxy device', proxyDeviceId)
        this._onUnlinkProxyDevice(proxyDeviceId, unlinkCallback)
      }
    }

  }).bind(this))

}

AKCWrapper.prototype.listenTo = function (producer, consumer) {
  var self = this
  if (producer) {
    producer.on('newDevice', function (proxyDevice) {
      logger.debug('Receive new Device: ' + JSON.stringify(proxyDevice))
      self._onNewProxyDevice(proxyDevice)
    })
    producer.on('newMessage', function (proxyDeviceId, message) {
      logger.debug('Receive new Message from: ' + proxyDeviceId)
      self._onNewMessage(proxyDeviceId, message)
    })
    producer.on('removeProxyInWrapper', function (proxyName, callback) {
      logger.debug('Remove proxy', proxyName)
      self._onRemoveProxy(proxyName, callback)
    })
    producer.on('addProxyInWrapper', function () {
      self.emit('proxyDevicesUpdate')
      self.emit('proxiesUpdate')
    })
    producer.on('getDevice', function (proxyDeviceId, callback) { // callback([err])
      logger.debug('Get device', proxyDeviceId)
      self._onGetProxyDevice(proxyDeviceId, callback)
    })
  }

  if (consumer) {
    consumer.on('getLinkedDevices', function (callback) {
      logger.debug('Receive request for linked devices')
      if (callback) {
        callback(null, self._linkedProxyDevices)
      }
    })
    consumer.on('getNotLinkedDevices', function (callback) {
      logger.debug('Receive request for not linked devices')
      if (callback != null ) {
        callback(null, self._notLinkedProxyDevices)
      }
    })
    consumer.on('getDeviceCandidates', function (userToken, uid, proxyDeviceId, callback) {
      logger.debug('Receive request for candidates devices')
      if (!self._notLinkedProxyDevices[proxyDeviceId] && !self._linkedProxyDevices[proxyDeviceId]) {
        if (callback) {
          callback('Unknown proxy device: ' + proxyDeviceId)
        }
      } else {
        self._getCandidates(userToken, uid, self._notLinkedProxyDevices[proxyDeviceId] ? self._notLinkedProxyDevices[proxyDeviceId]['akcDtid'] : self._linkedProxyDevices[proxyDeviceId]['akcDtid'], callback)
      }
    })
    consumer.on('getProxies', function (callback) {
      logger.debug('Receive request for getProxies')
      if (callback) {
        self.emit('getProxiesFromFactory', callback)
      }
    })
    consumer.on('switchProxy', function (params, callback) {
      logger.debug('Receive request to switchProxy')
      self.emit('switchProxyInFactory', params, callback)
    })
    consumer.on('updateProxyConfig', function (params, callback) {
      logger.debug('updateProxyConfig')

      logger.debug('Receive request for updateProxyConfig')
      self.emit('updateProxyConfigInFactory', params, callback)
    })
    consumer.on('linkDevice', function (userToken, uid, proxyDeviceId, akcDeviceId, akcDeviceName, userParametersPerDevice, callback) { // callback([err])
      logger.debug('Link device %s with %s', proxyDeviceId, akcDeviceName)
      self._onLinkProxyDevice(userToken, uid, proxyDeviceId, akcDeviceId, akcDeviceName, userParametersPerDevice, callback)
    })
    consumer.on('unlinkDevice', function (proxyDeviceId, callback) { // callback([err])
      logger.debug('Unlink device', proxyDeviceId)
      self._onUnlinkProxyDevice(proxyDeviceId, callback)
    })
    consumer.on('updateDevice', function (proxyDeviceId, userParametersPerDevice, callback) { // callback([err])
      logger.debug('Update device', proxyDeviceId)
      self._onUpdateProxyDevice(proxyDeviceId, userParametersPerDevice, callback)
    })

    consumer.on('getDevice', function (proxyDeviceId, callback) { // callback([err])
      logger.debug('Get device', proxyDeviceId)
      self._onGetProxyDevice(proxyDeviceId, callback)
    })

    consumer.on('getStatus', function (callback) {
      logger.debug('Get ProxyHub status')
      self._onGetStatus(callback)
    })

    consumer.on('isAppSetup', function (callback) {
      logger.debug('isAppSetup')
      self._onIsAppSetup(callback)
    })

    consumer.on('setupApp', function (params, callback) {
      logger.debug('setupApp')
      self._onSetupApp(params, callback)
    })

    consumer.on('newPlugin', function (params, callback) {
      logger.debug('newPlugin')
      self._onNewPlugin(params, callback)
    })
  }
}

AKCWrapper.prototype.close = function () {
  this._closed = true
  if (this._reconnectionTimeout) {
    clearTimeout(this._reconnectionTimeout)
  }
  if (this._ws) {
    this._ws.close()
  }
}

AKCWrapper.prototype._onNewProxyDevice = function (proxyDevice) {
  // Check if not in the already linked devices
  if (!this._linkedProxyDevices[proxyDevice.proxyDeviceId]) {
    logger.info('New device: ' + proxyDevice.proxyDeviceId)
    // device not linked to an AKC device
    this._notLinkedProxyDevices[proxyDevice.proxyDeviceId] = proxyDevice
    this._notLinkedProxyDevices[proxyDevice.proxyDeviceId].found = true
    this.emit('newDevice', this._notLinkedProxyDevices[proxyDevice.proxyDeviceId])
    this.emit('notLinkedProxyDevicesUpdate')
  } else {
    this._linkedProxyDevices[proxyDevice.proxyDeviceId].found = true
    logger.info('Device already known: ' + proxyDevice.proxyDeviceId)
  }
}

AKCWrapper.prototype._addLinkProxyDevice = function (proxyDeviceId) {
  logger.debug('add linked device: %s', this._linkedProxyDevices[proxyDeviceId])
  if (this._linkedProxyDevices[proxyDeviceId] && this._linkedProxyDevices[proxyDeviceId]['akcDeviceId'] && this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']) {
    var akcDeviceId = this._linkedProxyDevices[proxyDeviceId]['akcDeviceId']
    this._akc2ProxyDevices[akcDeviceId] = proxyDeviceId
    this._ws.registerDevice(akcDeviceId, this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken'])
    // send deferred messages
    this._sendDeferredMessages(proxyDeviceId)
  }
}

AKCWrapper.prototype._onLinkProxyDevice = function (userToken, uid, proxyDeviceId, akcDeviceId, akcDeviceName, userParametersPerDevice, callback) {
  if (!this._notLinkedProxyDevices[proxyDeviceId]) {
    logger.error('Error: cannot find unlinked device  with id: ' + proxyDeviceId)
    callback('Error: cannot find unlinked device with id: ' + proxyDeviceId)
  }

  var self = this
  function linkDone (error) {
    if (error) {
      if (self._linkedProxyDevices[proxyDeviceId]['akcDeviceId']) {
        delete self._linkedProxyDevices[proxyDeviceId]['akcDeviceId']
      }
      if (self._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']) {
        delete self._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']
      }
      self._notLinkedProxyDevices[proxyDeviceId] = self._linkedProxyDevices[proxyDeviceId]
      logger.error('Error linking device: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]))
      delete self._linkedProxyDevices[proxyDeviceId]
      if (callback) {
        callback(error)
      }
    } else {
      // SUCCESSFULLY LINKED
      self._saveLinkedDevices()
      self._addLinkProxyDevice(proxyDeviceId)
      // send deferred messages
      self._sendDeferredMessages(proxyDeviceId)
      //Ask for a new device if not more
      var nameProxy = parseUniqueProxyDeviceId(proxyDeviceId)[0]
      var hasOtherDevice = false
      for(var did in self._notLinkedProxyDevices){
        if(nameProxy == parseUniqueProxyDeviceId(did)[0])
          hasOtherDevice = true
      }
      if(!hasOtherDevice)
        self.emit('askNewDevice', nameProxy)
      if (callback) {
        var proxyDevice = self._linkedProxyDevices[proxyDeviceId]
        if(typeof userParametersPerDevice != 'undefined')
          if(userParametersPerDevice != null)
            proxyDevice.userParametersPerDevice = userParametersPerDevice
        callback(null, proxyDevice)
      }
    }
  }

  // If link to already existing AKC device
  if (akcDeviceId) {
    logger.debug('Link with existing device: %s, just get token', akcDeviceId)
    this._linkedProxyDevices[proxyDeviceId] = this._notLinkedProxyDevices[proxyDeviceId]
    delete this._notLinkedProxyDevices[proxyDeviceId]
    this._linkedProxyDevices[proxyDeviceId]['akcDeviceId'] = akcDeviceId
    // var self = this // ?
    this._getAKCDeviceName(userToken, uid, proxyDeviceId, function () {
      self._getAKCDeviceToken(userToken, uid, proxyDeviceId, linkDone)
    })
  } else if (akcDeviceName) {
    // create a new AKC device
    logger.debug('Link with new device, create device and generate token: ' + JSON.stringify(this._notLinkedProxyDevices[proxyDeviceId]))
    this._linkedProxyDevices[proxyDeviceId] = this._notLinkedProxyDevices[proxyDeviceId]
    delete this._notLinkedProxyDevices[proxyDeviceId]
    this._linkedProxyDevices[proxyDeviceId]['akcDeviceName'] = akcDeviceName
    this._createNewAKCDevice(userToken, uid, proxyDeviceId, function (error) {
      if (error) {
        linkDone(error)
      } else {
        self._getAKCDeviceToken(userToken, uid, proxyDeviceId, linkDone)
      }
    })
  } else {
    callback({
      errorCode: 400,
      errorMessage: 'Missing either akcDeviceId (to link proxy device to an ARTIK Cloud device) or akcDeviceName  (to create a new ARTIK Cloud device)'
    })
  }
}

AKCWrapper.prototype._onUnlinkProxyDevice = function (proxyDeviceId, callback) {
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Error: cannot find linked device  with id: ' + proxyDeviceId)
    callback('Error: cannot find linked device with id: ' + proxyDeviceId)
  }
  var self = this
  var proxyDevice = {}
  var keyList = ['proxyDeviceId', 'proxyDeviceName', 'proxyDeviceTypeName', 'akcDtid', 'akcDeviceId', 'akcDeviceName', 'userParametersPerDevice']
  for (var key of keyList)
    proxyDevice[key] = this._linkedProxyDevices[proxyDeviceId][key]

  logger.debug('Unlink existing device')
  ;['akcDeviceId', 'akcDeviceName', 'akcDeviceToken']
    .forEach(function (prop) {
      if (self._linkedProxyDevices[proxyDeviceId][prop]) {
        delete self._linkedProxyDevices[proxyDeviceId][prop]
      }
    })

  for (var akcDeviceId in this._akc2ProxyDevices) {
    var proxyId = this._akc2ProxyDevices[akcDeviceId]
    if (proxyId === proxyDeviceId) {
      delete this._akc2ProxyDevices[akcDeviceId]
    }
  }
  if(!this._linkedProxyDevices[proxyDeviceId].isVirtual)
    this._notLinkedProxyDevices[proxyDeviceId] = this._linkedProxyDevices[proxyDeviceId]
  delete this._linkedProxyDevices[proxyDeviceId]
  this._saveLinkedDevices()
  callback(null, proxyDevice)
}

AKCWrapper.prototype._onUpdateProxyDevice = function (proxyDeviceId, userParametersPerDevice, callback) {
  logger.debug('Updating device', proxyDeviceId)
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Error: cannot find linked device  with id: ' + proxyDeviceId)
    callback('Error: cannot find linked device with id: ' + proxyDeviceId)
  }
  this._linkedProxyDevices[proxyDeviceId].userParametersPerDevice = userParametersPerDevice

  this._saveLinkedDevices()
  callback(null, this._linkedProxyDevices[proxyDeviceId])
}

AKCWrapper.prototype._onGetProxyDevice = function (proxyDeviceId, callback) {

  logger.debug('Getting device', proxyDeviceId)

  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Error: cannot find linked device  with id: ' + proxyDeviceId)
    callback('Error: cannot find linked device with id: ' + proxyDeviceId)
  }
  var proxyDevice = this._linkedProxyDevices[proxyDeviceId]
  callback(null, proxyDevice)
}

AKCWrapper.prototype._onGetStatus = function (callback) {
  logger.debug('Getting ProxyHub status')
  var self = this
  var statusesCallback = function(statuses)
  {
    var result = {'globalLevel':'OK', 'proxiesStatuses':[]}

    for(var i in statuses.proxiesStatuses)
    {
      var status = statuses.proxiesStatuses[i]

      result.proxiesStatuses.push(status)

      if(result.globalLevel == 'OK' && status.level == 'WARNING')
        result.globalLevel = 'WARNING'

      if(status.level == 'ERROR')
        result.globalLevel = 'ERROR'
    }

    callback(result)
  }

  this.emit('getProxiesStatusesFromFactory', statusesCallback)
}

AKCWrapper.prototype._onNewPlugin = function (req, callback) {
  var form = new formidable.IncomingForm()
  var matchRegexp = null
  var updatedValues = null
  var paths = {}
  logger.debug('_onNewPlugin')
  var flatten = function (arr) {
    return arr.reduce(function (flat, toFlatten) {
      return flat.concat(Array.isArray(toFlatten) ? flatten(toFlatten) : toFlatten);
    }, [])
  }
  var walkSync = function (dir) {
    return fs.statSync(dir).isDirectory() ? fs.readdirSync(dir).map(f => walkSync(path.join(dir, f))) : dir
  }
  var deleteFolderRecursive = function(path) {
    if( fs.existsSync(path) ) {
      fs.readdirSync(path).forEach(function(file) {
        var curPath = path + '/' + file
        if(fs.statSync(curPath).isDirectory()) { // recurse
          deleteFolderRecursive(curPath)
        } else { // delete file
          fs.unlinkSync(curPath)
        }
      })
      fs.rmdirSync(path)
    }
  }
  var renamePromise = function (data){
    logger.debug('_onNewPlugin renamePromise src:'+data.oldpath+' dest:'+data.newpath)
    return new Promise(function(resolve, reject){
      fs.rename(data.oldpath, data.newpath, function(err){
        if (err != null ) {
          reject('Unable to copy the file in the directory')
        } else {
          resolve()
        }
      })
    })
  }
  var unlinkPromise = function (paths, name){
    logger.debug('_onNewPlugin unlinkPromise')
    return new Promise(function(resolve){
      fs.unlink(paths[name], function(){
        resolve()
      })
    })
  }
  var parseFormPromise = function (req, parseFunction) {
    logger.debug('_onNewPlugin parseFormPromise')
    return new Promise(function(resolve, reject){
      form.parse(req, function(err, fields, files){
        parseFunction(files, resolve, reject)
      })
    })
  }
  var readUploadedFile = function(files, resolve, reject) {
    logger.debug('_onNewPlugin readUploadedFile')
    if (files.plugin == null){
      reject('Please provide a file')
    } else {
      var re = /(.*)\.zip$/
      var name = '_'+files.plugin.name.replace(/[^a-z0-9\.]/gi, '-').toLowerCase()
      matchRegexp = name.match(re)
      updatedValues = {}
      paths.oldpath = files.plugin.path
      paths.newpath = './proxies/' + name
      if(matchRegexp == null){
        reject('The file must be a zip file')
      } else {
        paths.newpathunziproot = './proxies/_temp'+matchRegexp[1]
        paths.newpathunzip = paths.newpathunziproot+'/archive'
        resolve({newpath: paths.newpath, oldpath: paths.oldpath})
      }
    }
  }
  var unzipPromise = function (paths) {
    logger.debug('_onNewPlugin unzipPromise')
    return new Promise ( function (resolve, reject) {
      fs.createReadStream(paths.newpath)
        .pipe(unzip.Extract({ path: paths.newpathunzip }))
        .on('close', function() {
          fs.unlink(paths.newpath, function(){})
          var packagesFiles = flatten(walkSync(paths.newpathunzip)).filter(function (file){
            return file.includes('package.json')
          })
          if(packagesFiles.length == 0){
            reject('Cannot find the package.json file')
          } else {
            var packagePath = packagesFiles.reduce( function (el1, el2) {
              if(el1.length > el2.length)
                return el2
              else
                return el1
            })
            var rootPathPackage = packagePath.replace('/package.json', '')
            readPackagePromise(packagePath)
              .then(function (name) {
                paths.proxyPath = './proxies/_'+name
                paths.enablePath = './proxies/'+name
                deleteFolderRecursive(paths.proxyPath)
                deleteFolderRecursive(paths.enablePath)
              })
              .then(function(){
                resolve({oldpath: rootPathPackage, newpath: paths.proxyPath})                
              })
              .catch(catchPromise)
          }
        })
    })
  }
  var catchPromise = function (errorString) {
    logger.debug('_onNewPlugin catchPromise')
    logger.error(errorString)
    var updatedValues = {}
    updatedValues['error'] = errorString
    callback(updatedValues)
  }
  var installDependencies = function() {
    deleteFolderRecursive(paths.newpathunziproot)
    return new Promise( function (resolve, reject) {
      npm.load({prefix: paths.proxyPath},function(err) {
        if (err != null){
          reject('An error occur while loading npm')
        } else {
          npm.commands.install([], function(er){
            if(er != null)
              reject('Could not run npm install')
            else
              resolve({oldpath: paths.proxyPath, newpath: paths.enablePath})
          })

          npm.on('log', function(message) {
          // log installation progress
            logger.debug(message)
          })
        }
      })
    })
  }
  var readPackagePromise = function(packageFile) {
    logger.debug('READ PACKAGE PROMISE')
    return new Promise(function(resolve, reject) {
      fs.readFile(packageFile, 'utf8', function(err,data){
        var jsonData = JSON.parse(data)
        if(err != null || jsonData.name == null)
          reject('Could not read package.json')
        else
          resolve(jsonData.name) 
      })
    })
  }
  parseFormPromise(req, readUploadedFile)
    .then(renamePromise)
    .then(unzipPromise.bind(this, paths))
    .then(renamePromise)
    .then(unlinkPromise.bind(this, paths, 'newpath'))
    .then(installDependencies)
    .then(renamePromise)
    .then(function(){
      callback(updatedValues)
    })
    .catch(catchPromise)
}

AKCWrapper.prototype._onIsAppSetup = function (callback) {
  logger.debug('Checking if ARTIK Cloud application is setup')
  if(this._config.optionalArtikOnBoarding.clientId && this._config.optionalArtikOnBoarding.clientSecret && this._config.optionalArtikOnBoarding.callbackUrl)
    callback(true)
  else
    callback(false)
}

AKCWrapper.prototype._onSetupApp = function (params, callback) {

  logger.debug('Setting up ARTIK Cloud application')

  var clientId = params.clientId
  var clientSecret = params.clientSecret
  var callbackUrl = params.callbackUrl

  //setting the app permissions
  request({
    uri: 'https://accounts.artik.cloud/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    form: {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    },
  }, (function( err, response, body) {
    var apiBody = null
    try {
      apiBody = JSON.parse(body)
    } catch (e) {
      err = true
    }
    if(err || apiBody.error != null || apiBody.access_token == null){
      logger.error('Error while trying to retrieve applicationToken')
      callback({'error':'Unable to retrieve application token please be sure that you checked Client credentials on your app and verify you ClientId/ClientSecret'})
      return
    }
    logger.debug('Application token retrieved')
    var applicationToken = apiBody.access_token
    request({
      method: 'PUT',
      uri: 'https://api.artik.cloud/v1.1/applications/'+clientId,
      headers: {
        'Authorization': 'Bearer '+applicationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        'defaultScope': 96,
        'scopeParameters':'{"32":{"devicetype_dtid":["*"]},"64":{"devicetype_dtid":["*"]}}'
      }),
    }, (function (error) {
      if(error){
        logger.error('Error while updating the permissions')
        callback({'error': error})
        return
      }
      logger.debug('Permissions has been updated on the application')
      //saving client credentials
      this._config.optionalArtikOnBoarding.clientId = clientId
      this._config.optionalArtikOnBoarding.clientSecret = clientSecret
      this._config.optionalArtikOnBoarding.callbackUrl = callbackUrl
      var updatedValues = {'clientId':clientId, 'clientSecret':clientSecret, 'callbackUrl':callbackUrl}
      try {
        var configPath = path.resolve(path.resolve(path.dirname('')), 'config.json')
        fs.writeFileSync(configPath, JSON.stringify(this._config, null, 2))
      }
      catch (err) {
        updatedValues = {'error':'unable to write to ProxyHub config.json'}
      }

      try {
        IdentityProvider.init(this._config)
      }
      catch (err) {
        logger.warn('Unable to init IdentityProvider - no client ID and secret provided in config.json')
        updatedValues['error'] = 'Unable to init IdentityProvider - no client ID and secret provided in config.json'
      }

      callback(updatedValues)
    }).bind(this))
  }).bind(this))
}



//Trigger when a proxy is removed permanently
AKCWrapper.prototype._onRemoveProxy = function (proxyName, callback) {
  for (var linkedProxyDeviceId in this._linkedProxyDevices) {
    if (parseUniqueProxyDeviceId(linkedProxyDeviceId)[0] === proxyName) {
      delete this._linkedProxyDevices[linkedProxyDeviceId]
      this.emit('linkedProxyDevicesUpdate')
    }
  }
  for (var notLinkedProxyDeviceId in this._notLinkedProxyDevices) {
    if (parseUniqueProxyDeviceId(notLinkedProxyDeviceId)[0] === proxyName) {
      delete this._notLinkedProxyDevices[notLinkedProxyDeviceId]
      this.emit('notLinkedProxyDevicesUpdate')
    }
  }
  logger.debug('deleted', proxyName, 'in _notLinkedProxyDevices')
  for (var akcDeviceId in this._akc2ProxyDevices) {
    var proxyDId = this._akc2ProxyDevices[akcDeviceId]
    if (parseUniqueProxyDeviceId(proxyDId)[0] === proxyName) {
      delete this._akc2ProxyDevices[akcDeviceId]
    }
  }
  logger.debug('deleted', proxyName, 'in _akc2ProxyDevices')
  if (callback) {
    callback()
  }
}

AKCWrapper.prototype._onNewMessage = function (proxyDeviceId, message) {
  var akcMessage = {
    ts: Date.now(),
    data: message
  }

  logger.debug('_linkedProxyDevices: ' + JSON.stringify(this._linkedProxyDevices))
  // coming from a proxy device not linked yet
  if (!this._linkedProxyDevices[proxyDeviceId] || !this._linkedProxyDevices[proxyDeviceId]['akcDeviceId'] || !this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']) {
    // queue message, it will process when the proxy device will be linked
    this._addToDeferreddMessage(proxyDeviceId, akcMessage)
    if (this._notLinkedProxyDevices[proxyDeviceId]) {
      this._notLinkedProxyDevices[proxyDeviceId].lastMessageTS = Date.now()
    }
  } else {
    this._linkedProxyDevices[proxyDeviceId].lastMessageTS = Date.now()
    if (!this._sendMessage(proxyDeviceId, akcMessage)) {
      // WS take care of that now
      // this._addToDeferreddMessage(proxyDeviceId, akcMessage)
    }
  }
}

AKCWrapper.prototype._sendDeferredMessages = function (proxyDeviceId) {
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.warn('Proxy device: %s not linked, linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return
  }
  if (!this._linkedProxyDevices[proxyDeviceId]['akcDeviceId'] || !this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']) {
    logger.warn('Not enough info to sen to ARTIK Cloud (no device id or no device token): %s', this._linkedProxyDevices[proxyDeviceId])
    return
  }

  // In case mesage was sent before the device was known for AKCWrapper
  if (!this._linkedProxyDevices[proxyDeviceId].lastMessageTS) {
    this._linkedProxyDevices[proxyDeviceId].lastMessageTS = Date.now()
  }

  // Send deffered messages
  if (this._deferredMessages[proxyDeviceId]) {
    var newDeferredMessages = []
    while (this._deferredMessages[proxyDeviceId].length > 0) {
      var message = this._deferredMessages[proxyDeviceId].shift()
      if (!this._sendMessage(proxyDeviceId, message)) {
        newDeferredMessages.push(message)
      }
    }
    if (newDeferredMessages.length > 0) {
      this._deferredMessages[proxyDeviceId] = newDeferredMessages
    } else {
      delete this._deferredMessages[proxyDeviceId]
    }
  }
}

AKCWrapper.prototype._sendAllDeferredMessages = function () {
  for (var proxyDeviceId in this._deferredMessages) {
    this._sendDeferredMessages(proxyDeviceId)
  }
}

AKCWrapper.prototype._createNewAKCDevice = function (userToken, uid, proxyDeviceId, callback) {
  // Paranoid test
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Cant find proxy device: %s in linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return
  }

  //   create new device
  var artikcloudOauth = this._akcClient.authentications['artikcloud_oauth']
  artikcloudOauth.accessToken = userToken
  var deviceApi = new ArtikCloudApi.DevicesApi()

  var device = new ArtikCloudApi.Device()
  // {Device} Device to be added to the user
  device.uid = uid
  device.dtid = this._linkedProxyDevices[proxyDeviceId]['akcDtid']
  device.name = this._linkedProxyDevices[proxyDeviceId]['akcDeviceName']

  logger.info('Device to create: %s', JSON.stringify(device))

  var self = this
  var akcCreationDone = function akcCreationDone (error, data, response) {
    if (error) {
      logger.error('Error creating device for proxy %s\n   -> Error: %s\n   -> Response: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]), error, response.text)
      if (callback) {
        callback(error)
      }
    } else {
      self._linkedProxyDevices[proxyDeviceId]['akcDeviceId'] = data.data.id
      logger.debug('Linked device: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]))
      if (callback) {
        callback()
      }
    }
  }
  deviceApi.addDevice(device, akcCreationDone)
}

AKCWrapper.prototype._getAKCDeviceName = function (userToken, uid, proxyDeviceId, callback) {
  // Paranoid test
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Cant find proxy device: %s in linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return
  }

  //   get device token
  var artikcloudOauth = this._akcClient.authentications['artikcloud_oauth']
  artikcloudOauth.accessToken = userToken
  var deviceApi = new ArtikCloudApi.DevicesApi()
  var deviceId = this._linkedProxyDevices[proxyDeviceId]['akcDeviceId']

  logger.info('Get name for: %s', deviceId)

  var self = this
  function akcGetDone (error, data) {
    if (error || !data.data || !data.data.name) {
      logger.warn('Cound not get ARTIK Cloud device name for: %s, error: %s, data: %s ', deviceId, error, data)
    } else {
      logger.debug('data: %s', JSON.stringify(data))
      self._linkedProxyDevices[proxyDeviceId]['akcDeviceName'] = data.data.name
    }
    if (callback) {
      callback()
    }
  }
  deviceApi.getDevice(deviceId, akcGetDone)
}
AKCWrapper.prototype._getAKCDeviceToken = function (userToken, uid, proxyDeviceId, callback) {
  // Paranoid test
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Cant find proxy device: %s in linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return
  }

  //   get device token
  var artikcloudOauth = this._akcClient.authentications['artikcloud_oauth']
  artikcloudOauth.accessToken = userToken
  var deviceApi = new ArtikCloudApi.DevicesApi()
  var deviceId = this._linkedProxyDevices[proxyDeviceId]['akcDeviceId']

  logger.info('Get token for: %s', deviceId)

  var self = this
  var getMode = true
  function akcGetTokenDone (error, data) {
    if (error) {
      if (getMode && error.status === 404) {
        // no token
        logger.debug('No token yet, create one')
        // create one
        getMode = false
        // deviceApi.updateDeviceToken(deviceId, akcGetTokenDone)
        var artikcloudurl = Url.parse(self._config.artikCloud.apiUrl)
        var options = {
          host: artikcloudurl.host || 'api.artik.cloud',
          port: 443,
          path: '/' + (artikcloudurl.host.path || 'V1.1') + '/devices/' + deviceId + '/tokens',
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer ' + userToken
          }
        }
        logger.debug('options', options)

        var req = https.request(options, function (res) {
          logger.debug('res.statusCode', res.statusCode)
          res.on('data', function (data) {
            akcGetTokenDone(null, JSON.parse(data.toString()), res)
          })
        })
        req.write('{}')
        req.end()

        req.on('error', function (e) {
          logger.error(e)
        })
      }
      /*if (getMode) {
          logger.error('Error getting device token for proxy %s\n   -> Error: %s\n   -> Response: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]), error, response ? response.text : 'undefined')
        } else {
          logger.error('Error creating device token for proxy %s\n   -> Error: %s\n   -> Response: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]), error, JSON.stringify(response))
        }
        if (callback) {
          callback(error)
        }
      */
    } else {
      logger.debug('data: %s', JSON.stringify(data))
      self._linkedProxyDevices[proxyDeviceId]['akcDeviceToken'] = data.data.accessToken
      logger.debug('Linked device: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]))
      if (callback) {
        callback()
      }
    }
  }
  deviceApi.getDeviceToken(deviceId, akcGetTokenDone)
}

AKCWrapper.prototype._sendMessage = function (proxyDeviceId, akcMessage) {
  // Paranoid test
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Cant find proxy device: %s in linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return false
  }

  akcMessage.sdid = this._linkedProxyDevices[proxyDeviceId]['akcDeviceId']
  akcMessage.token = this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']
  logger.info('Send Message: ' + JSON.stringify(akcMessage))

  return this._ws.sendMessage(akcMessage)
}

AKCWrapper.prototype._addToDeferreddMessage = function (proxyDeviceId, akcMessage) {
  if (!this._deferredMessages[proxyDeviceId]) {
    this._deferredMessages[proxyDeviceId] = []
  }
  this._deferredMessages[proxyDeviceId].push(akcMessage)
  logger.debug('_deferredMessages: ' + JSON.stringify(this._deferredMessages))
  if (this._config.artikCloud && this._config.artikCloud.maxDefferedMessagePerDevice) {
    while (this._deferredMessages[proxyDeviceId].length > this._config.artikCloud.maxDefferedMessagePerDevice) {
      this._deferredMessages[proxyDeviceId].shift()
    }
  }
  logger.debug('_deferredMessages after clean: ' + JSON.stringify(this._deferredMessages))

// @todo: save the queue on schedule??
}

AKCWrapper.prototype._deleteAKCDevice = function (proxyDeviceId, callback) {
  // Paranoid test
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Cant find proxy device: %s in linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return
  }

  //   delete device
  var artikcloudOauth = this._akcClient.authentications['artikcloud_oauth']
  artikcloudOauth.accessToken = this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']
  var deviceApi = new ArtikCloudApi.DevicesApi()

  var deviceId = this._linkedProxyDevices[proxyDeviceId]['akcDeviceId']
  this._ws.unregisterDevice(deviceId)

  logger.info('Device to delete: %s', deviceId)

  var self = this
  var akcDeletionDone = function akcDeletionDone (error, data, response) {
    if (error) {
      logger.error('Error deleting device for proxy %s\n   -> Error: %s\n   -> Response: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]), error, response.text)
    } else {
      if (self._linkedProxyDevices[proxyDeviceId]['akcDeviceId']) {
        delete self._akc2ProxyDevices[self._linkedProxyDevices[proxyDeviceId]['akcDeviceId']]
        delete self._linkedProxyDevices[proxyDeviceId]['akcDeviceId']
      }
      delete self._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']
      if(!self._linkedProxyDevices[proxyDeviceId].isVirtual)
        self._notLinkedProxyDevices[proxyDeviceId] = self._linkedProxyDevices[proxyDeviceId]
      delete self._linkedProxyDevices[proxyDeviceId]
      logger.debug('Deleted device: %s', JSON.stringify(self._notLinkedProxyDevices[proxyDeviceId]))
    }

    if (callback) {
      callback(error)
    }
  }
  deviceApi.deleteDevice(deviceId, akcDeletionDone)
}

AKCWrapper.prototype._getAKCLastMessage = function (proxyDeviceId, callback) {
  // Paranoid test
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Cant find proxy device: %s in linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return
  }

  //   delete device
  var artikcloudOauth = this._akcClient.authentications['artikcloud_oauth']
  artikcloudOauth.accessToken = this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']
  var MessagesApi = new ArtikCloudApi.MessagesApi()

  var opts = {
    'count': 1,
    'sdids': this._linkedProxyDevices[proxyDeviceId]['akcDeviceId']
  }

  var self = this
  var akcDone = function akcDone (error, data, response) {
    if (error) {
      logger.error('Error in request to AKC %s\n   -> Error: %s\n   -> Response: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]), error, response.text)
    } else {
      data = data.data
    }
    if (callback) {
      callback(error, data)
    }
  }
  MessagesApi.getLastNormalizedMessages(opts, akcDone)
}

AKCWrapper.prototype._sendAction = function (proxyDeviceId, action, callback) {
  // Paranoid test
  if (!this._linkedProxyDevices[proxyDeviceId]) {
    logger.error('Cant find proxy device: %s in linkedDevices: %s', proxyDeviceId, this._linkedProxyDevices)
    return
  }

  //   delete device
  var artikcloudOauth = this._akcClient.authentications['artikcloud_oauth']
  artikcloudOauth.accessToken = this._linkedProxyDevices[proxyDeviceId]['akcDeviceToken']
  var MessagesApi = new ArtikCloudApi.MessagesApi()
  var message = new ArtikCloudApi.MessageAction()

  message.data = action
  message.ddid = message.sdid = this._linkedProxyDevices[proxyDeviceId]['akcDeviceId']
  message.ts = Date.now()
  message.type = 'action'

  var self = this
  var akcDone = function akcDone (error, data, response) {
    if (error) {
      logger.error('Error in request to AKC %s\n   -> Error: %s\n   -> Response: %s', JSON.stringify(self._linkedProxyDevices[proxyDeviceId]), error, response.text)
    }
    if (callback) {
      callback(error, data)
    }
  }
  MessagesApi.sendMessageAction(message, akcDone)
}

AKCWrapper.prototype._getCandidates = function (userToken, uid, akcDtid, callback) {
  //   - find candidates
  var artikcloudOauth = this._akcClient.authentications['artikcloud_oauth']
  artikcloudOauth.accessToken = userToken
  this._akcUserId = uid
  var userApi = new ArtikCloudApi.UsersApi(this._akcClient)

  var countPerPage = 100
  var opts = {
    'offset': 0,
    'count': countPerPage,
    'includeProperties': false
  }

  var akcCandidates = []

  var self = this
  var onNewCandidates = function onNewCandidates (error, data) {
    if (error) {
      logger.error('Can\'t get device candidates in ARTIK CLoud. Error details: ' + error)
      if (callback) {
        callback(error, null)
      }
    } else {
      logger.debug('----------------------')
      logger.debug('API called successfully. Returned data: ' + JSON.stringify(data))

      for (var i = 0; i < data.count; i++) {
        if (data.data.devices[i].dtid === akcDtid) {
          // we have a candidate
          akcCandidates.push(data.data.devices[i])
          logger.debug('Found: ' + data.data.devices[i].id)
        }
      }

      // if not finished (we still have some devices to fetch)
      if (data.count === countPerPage) {
        opts.offset += countPerPage
        userApi.getUserDevices(self._akcUserId, opts, callback)
      } else {
        logger.debug('Candidates: ' + akcCandidates)
        if (callback) {
          callback(error, akcCandidates)
        }
      }
    }
  }

  userApi.getUserDevices(this._akcUserId, opts, onNewCandidates)
}

AKCWrapper.prototype.getLinkedDevices = function () {
  var devices = []
  for (var key in this._detectedDevices) {
    if (this._detectedDevices[key].getSamiId()) {
      devices.push(this._detectedDevices[key])
    }
  }
  return devices
}



AKCWrapper.prototype._loadLinkedDevices = function () {
  logger.log('debug', 'Load data')
  try {
    var historicalLinkedDevices = this._loadDataFromFile( 'devices.json')
    logger.log('debug', 'Loaded sami/proxy links: ' + JSON.stringify(historicalLinkedDevices))
    // merge with linkedDevices
    for (var proxyDeviceId in historicalLinkedDevices) {
      if (!this._linkedProxyDevices.hasOwnProperty(proxyDeviceId)) {
        this._linkedProxyDevices[proxyDeviceId] = historicalLinkedDevices[proxyDeviceId]
        this._linkedProxyDevices[proxyDeviceId].found = false
        this._addLinkProxyDevice(proxyDeviceId)
      }
    }
  } catch (e) {
    logger.log('debug', 'Can not load linked devices data: ' + e)
  }
}

AKCWrapper.prototype._cleanSavedLinkedDevices = function () {
  this._cleanDataInFile('devices.json')
}

AKCWrapper.prototype._saveLinkedDevices = function () {
  this._saveDataInFile('devices.json', this._linkedProxyDevices)
}


AKCWrapper.prototype._loadDataFromFile = function (filename) {
  logger.log('debug', 'Load data')
  try {
    var data = require(path.join(this._config.dir.root ? this._config.dir.root : './', this._config.dir.data, filename))
    logger.log('debug', 'Loaded ' + filename)
    return data
  } catch (e) {
    logger.log('debug', 'Can not load ' + filename + ':' + e)
    return null
  }
}

AKCWrapper.prototype._cleanDataInFile = function (filename) {
  try {
    logger.debug('Clean saved data')
    fs.unlink(path.join(this._config.dir.root ? this._config.dir.root : './', this._config.dir.data, filename), function (error) {
      if (error) {
        if (error.code !== 'ENOENT') {
          logger.log('error', 'Cannot clean saved data in %s: %s', filename, error)
        }
      } else {
        logger.log('debug', 'Saved data cleaned %s', filename)
      }
    })
  } catch (e) {
    logger.error('Cannot clean saved data %s: %s', filename, e)
  }
}

AKCWrapper.prototype._saveDataInFile = function (filename, data) {
  try {
    logger.log('debug', 'Save data in %s: %s', filename, JSON.stringify(data))
    var dataDir = path.join(this._config.dir.root ? this._config.dir.root : './', this._config.dir.data)
    fs.mkdir(dataDir, function () {
      fs.writeFile(path.join(dataDir, filename), JSON.stringify(data), 'utf8', function (error) {
        if (error) {
          if (error.code === 'EACCES') {
            logger.log('error', 'Cannot save data because cant access to file: ' + path.join(dataDir, filename))
          } else {
            throw error
          }
        }
        logger.log('debug', 'Data saved')
      })
    })
  } catch (e) {
    logger.error('Cannot save data in %s: %s', filename, e)
  }
}
