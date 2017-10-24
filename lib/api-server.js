'use strict'

module.exports = ApiServer

var EventEmitter = require('events')
var Util = require('util')
var compression = require('compression')
var Express = require('express')
var Session = require('express-session')
var FileStore = require('session-file-store')(Session)
var bodyParser = require('body-parser')
var IdentityProvider = require('./identity-provider')
var Io = require('socket.io')
var SSDP = require('node-ssdp').Server
var Ip = require('ip')
var Fs = require('fs')
var Xml2js = require('xml2js')
var Promise = require('promise')
var Http = require('http')
var Https = require('https')
var ProxyHubLogger = require('./proxy-hub-logger')
require('./common')

var logger

function ApiServer () {
  // init event emitter
  EventEmitter.call(this)
  this._config = {}

  this._app = Express()
  this._app.use(compression())
  this._proxyDevicesRouter = Express.Router()
  this._proxiesRouter = Express.Router()
  this._uiRouter = Express.Router()
  this._io = {}
  this._token = {}
  this._ssdpServer = {}
}
Util.inherits(ApiServer, EventEmitter)

var _checkTokenAndUserId = function _checkTokenAndUserId (userToken, userId, configUser) {
  return new Promise(function (resolve, reject) {
    if (!userId) {
      reject({ statusCode: 422, error: 'Your request without userId in Query or a logged session' })
    } else if (!userToken) {
      reject({ statusCode: 401, error: 'Your request without valid user_token in Header' })
    } else if (userId !== configUser.userId && !configUser.multipleAccounts && configUser.userId !== '') {
      reject({ statusCode: 403, error: 'Your are logged on an account which is not the owner of the proxyhub' })
    } else {
      resolve()
    }
  })
}

var _checkOwner = function (userId, configUser) {
  return new Promise(function (resolve, reject) {
    if (configUser.userId !== '' && userId !== configUser.userId && !configUser.multipleAccounts) {
      reject({ statusCode: 403, error: 'Your are logged on an account which is not the owner of the proxyhub' })
    } else {
      resolve()
    }
  })
}

var _keyRenamer = function _keyRenamer (renameMap) {
  return function (device) {
    var newDevice = {}
    Object.keys(device).forEach(function (key) {
      if (key in renameMap) {
        newDevice[renameMap[key]] = device[key]
      } else {
        newDevice[key] = device[key]
      }
    })
    return newDevice
  }
}

var _keyFilter = function _keyFilter (preservedKeys) {
  return function (device) {
    var newDevice = {}
    Object.keys(device).forEach(function (key) {
      if (preservedKeys.indexOf(key) >= 0) {
        newDevice[key] = device[key]
      }
    })
    return newDevice
  }
}

var _extractNum = function _extractNum (query, keystr) {
  if (query) {
    var valstr = query[keystr]
    return valstr ? parseInt(valstr, 10) : undefined
  }
  return undefined
}
var _findToken = function _findToken (req) {
  logger.debug('_findToken')
  var authHeader = req.header('Authorization')
  var found = /^bearer (\w+)$/i.exec(authHeader)
  var tokenFound = Array.isArray(found) ? found[1] : null
  if (req.session.userToken) {
    logger.debug('_findToken from req.session' + req.session.userToken)
    return req.session.userToken
  }
  logger.debug('_findToken from req.header: ' + tokenFound)
  return tokenFound
}
var _handlePagination = function _handlePagination (list, count, offset) {
  logger.debug('_handlePagination')
  var begin = offset || 0
  var end = count === undefined ? list.length : begin + count
  return list.slice(begin, end)
}
var _xmlParseReplaceURLBase = function _xmlParseReplaceURLBase (descriptionFileName, newEndpoint) {
  var filepath = './public/' + descriptionFileName
  var builder = new Xml2js.Builder()
  var read = function read () {
    return new Promise(function (resolve, reject) {
      Fs.readFile(filepath, function (err, data) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  }
  var modify = function modify (data) {
    return new Promise(function (resolve, reject) {
      Xml2js.parseString(data, { explicitArray: false }, function (err, result) {
        if (err) {
          reject(err)
        } else {
          result.root.URLBase = newEndpoint
          var xml = builder.buildObject(result)
          resolve(xml)
        }
      })
    })
  }
  var write = function write (data) {
    return new Promise(function (resolve, reject) {
      Fs.writeFile(filepath, data, function (err) {
        if (err) {
          reject(err)
        } else {
          logger.debug('URLBase replaced xml saved.')
        }
      })
    })
  }
  read().then(modify).then(write).catch(logger.error)
}
var _extractPortFromConfig = function _extractPortFromConfig (config) {
  return config.server.port || 8888 // default port: 8888
}

ApiServer.prototype._initProxyDevicesRouter = function () {
  // This router should be binded to /proxydevices
  var self = this
  this._proxyDevicesRouter.use(bodyParser.json())
  // for parsing application/json
  this._proxyDevicesRouter.use(bodyParser.urlencoded({ extended: true }))
  // for parsing application/x-www-form-urlencoded

  this._proxyDevicesRouter.get('/:linkedFlag', function (req, res) {
    logger.debug('GET', '/proxydevices/:linkedFlag')
    logger.debug(':linkedFlag', req.params.linkedFlag)
    logger.debug('request.session', req.session)
    var linkedFlag = req.params.linkedFlag
    var userId = req.body.userId || req.session.userId
    if(linkedFlag === 'linked' || linkedFlag === 'notlinked')
    {
      var count = _extractNum(req.query, 'count')
      var offset = _extractNum(req.query, 'offset')

      var _handleDevicesMap = function _handleDevicesMap(devicesMap) {
        var outputKeys = ['proxyDeviceId', 'proxyDeviceName', 'proxyDeviceTypeName', 'akcDtid', 'akcDeviceId',
          'akcDeviceName', 'found', 'lastMessageTS', 'lastActionTS', 'userParametersPerDevice']
        var devicesList = Object.keys(devicesMap).map(function (k) {
          return devicesMap[k]
        }) // Map to Value Array
        var resDevicesList = _handlePagination(devicesList, count, offset).map(_keyFilter(outputKeys))
        res.json({
          offset: offset,
          count: resDevicesList.length,
          total: devicesList.length,
          data: { devices: resDevicesList }
        })
      }

      var _dispatchCorrespondent = function _dispatchCorrespondent(eventName) {
        return new Promise(function (resolve, reject) {
          var _callbackLinkedOrNotDevices = function _callbackLinkedOrNotDevices(err, mapOfDevices) {
            logger.debug('linked/notLinked Devices', mapOfDevices)
            if (err) {
              logger.error(err)
              reject({ statusCode: 500, error: err })
            } else {
              resolve(mapOfDevices)
            }
          }
          self.emit(eventName, _callbackLinkedOrNotDevices)
        })
      }

      var _chooseRightEvent = function _chooseRightEvent(flag) {
        var flag2Event = {
          'linked': 'getLinkedDevices',
          'notlinked': 'getNotLinkedDevices'
        }
        var eventName = flag2Event[flag]
        return new Promise(function (resolve, reject) {
          if (eventName) {
            resolve(eventName)
          } else {
            logger.error('Unknown request, should linked/notlinked, but: ', flag)
            reject({ statusCode: 400, error: 'Unknown request flag, it should be linked/notlinked' })
          }
        })
      }

      _checkOwner(userId, self._config.optionalArtikOnBoarding)
        .then(_chooseRightEvent.bind(this, linkedFlag))
        .then(_dispatchCorrespondent)
        .then(_handleDevicesMap)
        .catch(function (reason) {
          res.status(reason.statusCode).json({ error: reason.error })
        })
    }
    else
    {
      var proxyDeviceId = linkedFlag

      var _successResponse = function _successResponse(proxyDevice) {
        var resJson = {}
        var keyList = ['proxyDeviceId', 'proxyDeviceName', 'proxyDeviceTypeName', 'akcDtid', 'akcDeviceId', 'akcDeviceName', 'userParametersPerDevice']
        for (var key of keyList)
          resJson[key] = proxyDevice[key]
        res.json(resJson)
      }
      var _getDevice = function _getDevice() {
        return new Promise(function (resolve, reject) {
          var _callbackGet = function _callbackGet(err, proxyDevice) {
            if (err) {
              logger.error('Update error: ', err)
              reject({ statusCode: 404, error: err })
            } else {
              resolve(proxyDevice)
            }
          }
          self.emit('getDevice', proxyDeviceId, _callbackGet)
        })
      }

      logger.debug('Getting ProxyDevice:', proxyDeviceId)

      _checkOwner(userId, self._config.optionalArtikOnBoarding)
        .then(_getDevice)
        .then(_successResponse)
        .catch(function (reason) {
          var resJson = { 'errorCode': reason.statusCode, 'errorMessage': reason.error }
          res.status(reason.statusCode).json(resJson)
        })
    }

  })

  this._proxyDevicesRouter.post('/:proxyDeviceId', function (req, res) {
    logger.debug('POST', '/proxydevices/:proxyDeviceId')
    logger.debug('request.body', req.body)
    logger.debug('request.session', req.session)
    var proxyDeviceId = req.params.proxyDeviceId
    logger.debug('proxyDeviceId', proxyDeviceId)
    var userToken = _findToken(req)
    var userId = req.body.userId || req.session.userId
    var akcDeviceId = req.body.akcDeviceId
    var akcDeviceName = req.body.akcDeviceName
    var userParametersPerDevice = req.body.userParametersPerDevice
    logger.debug('userToken', userToken)
    logger.debug('userId', userId)

    var _successResponse = function _successResponse (proxyDevice) {
      var resJson = {}
      var keyList = ['proxyDeviceId', 'proxyDeviceName', 'proxyDeviceTypeName', 'akcDtid', 'akcDeviceId', 'akcDeviceName', 'userParametersPerDevice']
      for(var key of keyList)
        resJson[key] = proxyDevice[key]
      res.json(resJson)
    }

    var _linkDevice = function _linkDevice () {
      return new Promise(function (resolve, reject) {
        var _callbackLinkOrCreate = function _callbackLinkOrCreate (err, proxyDevice) {
          if (err) {
            logger.error('Linking error: ', err)
            if (err.response) {
              reject({ statusCode: 400, error: err.response.body.error })
            } else {
              reject({ statusCode: 404, error: err })
            }
          } else {
            resolve(proxyDevice)
          }
        }
        self.emit('linkDevice', userToken, userId, proxyDeviceId, akcDeviceId, akcDeviceName, userParametersPerDevice, _callbackLinkOrCreate)
      })
    }

    logger.debug('Linking ProxyDevice:', proxyDeviceId, 'to the AKC Device', akcDeviceId)
    _checkTokenAndUserId(userToken, userId, self._config.optionalArtikOnBoarding)
      .then(_linkDevice)
      .then(_successResponse)
      .catch(function (reason) {
        var resJson = { 'errorCode': reason.statusCode, 'errorMessage': reason.error }
        res.status(reason.statusCode).json(resJson)
      })
  })

  this._proxyDevicesRouter.delete('/:proxyDeviceId', function (req, res) {
    logger.debug('DELETE', '/proxydevices/:proxyDeviceId')
    logger.debug('request.body', req.body)
    logger.debug('request.session', req.session)
    var proxyDeviceId = req.params.proxyDeviceId
    logger.debug('proxyDeviceId', proxyDeviceId)

    var _successResponse = function _successResponse(proxyDevice) {
      res.json(proxyDevice)
    }
    var _unlinkDevice = function _unlinkDevice() {
      return new Promise(function (resolve, reject) {
        var _callbackUnlink = function _callbackUnlink(err, proxyDevice) {
          if (err) {
            logger.error('Unlinking error: ', err)
            reject({ statusCode: 404, error: err })
          } else {
            resolve(proxyDevice)
          }
        }
        self.emit('unlinkDevice', proxyDeviceId, _callbackUnlink)
      })
    }

    logger.debug('Unlinking ProxyDevice:', proxyDeviceId)
    _unlinkDevice()
      .then(_successResponse)
      .catch(function (reason) {
        var resJson = { 'errorCode': reason.statusCode, 'errorMessage': reason.error }
        res.status(reason.statusCode).json(resJson)
      })
  })

  this._proxyDevicesRouter.put('/:proxyDeviceId', function (req, res) {
    logger.debug('PUT', '/proxydevices/:proxyDeviceId')
    logger.debug('request.body', req.body)
    logger.debug('request.session', req.session)

    var proxyDeviceId = req.params.proxyDeviceId
    var userParametersPerDevice = req.body.userParametersPerDevice

    if(!('userParametersPerDevice' in req.body))
    {
      var resJson = { 'errorCode': 400, 'errorMessage': 'Missing userParametersPerDevice in request body' }
      res.status(400).json(resJson)
      return
    }

    var _successResponse = function _successResponse(proxyDevice) {
      var resJson = {}
      var keyList = ['proxyDeviceId', 'proxyDeviceName', 'proxyDeviceTypeName', 'akcDtid', 'akcDeviceId', 'akcDeviceName', 'userParametersPerDevice']
      for (var key of keyList)
        resJson[key] = proxyDevice[key]
      res.json(resJson)
    }
    var _updateDevice = function _updateDevice() {
      return new Promise(function (resolve, reject) {
        var _callbackUpdate = function _callbackUpdate(err, proxyDevice) {
          if (err) {
            logger.error('Update error: ', err)
            reject({ statusCode: 404, error: err })
          } else {
            resolve(proxyDevice)
          }
        }
        self.emit('updateDevice', proxyDeviceId, userParametersPerDevice, _callbackUpdate)
      })
    }

    logger.debug('Updating ProxyDevice:', proxyDeviceId)

    var userToken = _findToken(req)
    var userId = req.body.userId || req.session.userId
    _checkTokenAndUserId(userToken, userId, self._config.optionalArtikOnBoarding).then(
      function() {
        _updateDevice()
          .then(_successResponse)
          .catch(function (reason) {
            var resJson = { 'errorCode': reason.statusCode, 'errorMessage': reason.error }
            res.status(reason.statusCode).json(resJson)
          })
      }
    ).catch(function (reason) {
      var resJson = { 'errorCode': reason.statusCode, 'errorMessage': reason.error }
      res.status(reason.statusCode).json(resJson)
    })
  })

  this._proxyDevicesRouter.get('/:proxyDeviceId/candidates', function (req, res) {
    logger.debug('GET', '/proxydevices/:proxyDeviceId/candidates')
    logger.debug('request.session', req.session)
    var proxyDeviceId = req.params.proxyDeviceId
    logger.debug('proxyDeviceId', proxyDeviceId)
    var userToken = _findToken(req)
    var userId = req.query.userId || req.session.userId
    logger.debug('userToken', userToken)
    logger.debug('userId', userId)
    var count = req.query ? req.query.count : undefined
    var offset = req.offset ? req.query.offset : undefined

    var _handleCandidatesMap = function _handleCandidatesMap (candidatesMap) {
      var renameMap = { 'id': 'akcDeviceId', 'name': 'akcDeviceName' }
      var candidatesList = Object.keys(candidatesMap).map(function (k) {
        return candidatesMap[k]
      }) // Map to Array
      logger.debug('candidatesList', JSON.stringify(candidatesList))
      var resCandidatesList = _handlePagination(candidatesList, count, offset).map(_keyFilter(['id', 'name'])).map(_keyRenamer(renameMap))
      logger.debug('resCandidatesList', JSON.stringify(resCandidatesList))
      res.json({
        offset: offset,
        count: resCandidatesList.length,
        total: candidatesList.length,
        data: { candidates: resCandidatesList }
      })
    }
    var _getDeviceCandidates = function _getDeviceCandidates () {
      return new Promise(function (resolve, reject) {
        var _callbackCandidates = function _callbackCandidates (err, mapOfCandidates) {
          if (err) {
            logger.error(err)
            reject({ statusCode: 404, error: err })
          } else {
            resolve(mapOfCandidates)
          }
        }
        self.emit('getDeviceCandidates', userToken, userId, proxyDeviceId, _callbackCandidates)
      })
    }

    _checkTokenAndUserId(userToken, userId, self._config.optionalArtikOnBoarding).then(_getDeviceCandidates).then(_handleCandidatesMap).catch(function (reason) {
      res.status(reason.statusCode).json({ error: reason.error })
    })
  })
}

ApiServer.prototype._initUiRouter = function () {
  this._uiRouter.get('*', function (req, res) {
    res.sendFile('public/index.html', {root: './'})
  })
}

ApiServer.prototype._initProxiesRouter = function () {
  // This router should be binded to /proxies
  var self = this
  this._proxiesRouter.use(bodyParser.json())
  // for parsing application/json
  this._proxiesRouter.use(bodyParser.urlencoded({ extended: true }))
  // for parsing application/x-www-form-urlencoded

  this._proxiesRouter.get('/', function (req, res) {
    logger.debug('GET', '/proxies')
    logger.debug(':onlyEnabled', req.query.onlyEnabled)
    logger.debug('request.session', req.session)
    var onlyEnabled = (req.query.onlyEnabled === 'true')
    var count = _extractNum(req.query, 'count')
    var offset = _extractNum(req.query, 'offset')

    var _handleProxiesList = function _handleProxiesList (proxiesList) {
      var proxiesEnabledFiltered = proxiesList.filter(function (item) {
        return onlyEnabled ? item.enabled : true
      })
      var resProxiesList = _handlePagination(proxiesEnabledFiltered, count, offset)
      res.json({
        offset: offset,
        count: resProxiesList.length,
        total: proxiesEnabledFiltered.length,
        data: { proxies: resProxiesList }
      })
    }

    var _emitGetEvent = function _emitGetEvent () {
      return new Promise(function (resolve) {
        var _callbackProxies = function _callbackProxies (listProxies) {
          logger.debug('onlyEnabled/all Proxies', JSON.stringify(listProxies))
          resolve(listProxies)
        }
        self.emit('getProxies', _callbackProxies)
      })
    }

    var userId = req.body.userId || req.session.userId
    _checkOwner(userId, self._config.optionalArtikOnBoarding)
      .then(_emitGetEvent)
      .then(_handleProxiesList)
      .catch(function (reason) {
        res.status(reason.statusCode).json({ error: reason.error })
      })
  })

  this._proxiesRouter.get('/status', function (req, res) {
    var callback = function(statusInfo)
    {
      res.json(statusInfo)
    }
    self.emit('getStatus', callback)
    return
  })


  this._proxiesRouter.get('/isApplicationSetup', function (req, res) {
    var callbackSetup = function(result)
    {
      res.json({'isApplicationSetup':result})
    }
    self.emit('isAppSetup', callbackSetup)
    return
  })

  this._proxiesRouter.post('/setupApplication', function (req, res) {
    if(!(req.body.clientId && req.body.clientSecret && req.body.callbackUrl))
    {
      res.status(400).json({'error':'request body should contains complete clientId, clientSecret and callbackUrl'})
      return
    }

    var callbackSetupDone = function (result) {
      if('error' in result)
      {
        if(result.error == 'unable to write to ProxyHub config.json')
          res.status(500).json(result)
        else
          res.status(400).json(result)
      }
      else
        res.json(result)
    }
    if(self._config.optionalArtikOnBoarding.clientId === '' || self._config.optionalArtikOnBoarding.clientSecret === '')
      self.emit('setupApp', req.body, callbackSetupDone)
    else {
      var userToken = _findToken(req)
      var userId = req.body.userId || req.session.userId
      _checkTokenAndUserId(userToken, userId, self._config.optionalArtikOnBoarding)
        .then(self.emit.bind('setupApp', req.body, callbackSetupDone))
        .catch(function (reason) {
          var resJson = { 'errorCode': reason.statusCode, 'errorMessage': reason.error }
          res.status(reason.statusCode).json(resJson)
        })
    }
    return
  })

  this._proxiesRouter.get('/:proxyName', function (req, res) {
    logger.debug('GET', '/proxies/:proxyName')
    logger.debug(':proxyName', req.params.proxyName)
    logger.debug('request.session', req.session)
    var proxyName = req.params.proxyName

    var _selectProxyFromList = function _selectProxyFromList (proxiesList) {
      var proxyFound = proxiesList.find(function (item) {
        return item.name === proxyName
      })
      res.json({
        data: proxyFound
      })
    }

    var _emitGetEvent = function _emitGetEvent () {
      return new Promise(function (resolve) {
        var _callbackProxies = function _callbackProxies (listProxies) {
          logger.debug('onlyEnabled/all Proxies', JSON.stringify(listProxies))
          resolve(listProxies)
        }
        self.emit('getProxies', _callbackProxies)
      })
    }

    var userId = req.body.userId || req.session.userId
    _checkOwner(userId, self._config.optionalArtikOnBoarding)
      .then(_emitGetEvent)
      .then(_selectProxyFromList)
      .catch(function (reason) {
        res.status(reason.statusCode).json({ error: reason.error })
      })
  })

  this._proxiesRouter.put('/:proxyName', function (req, res) {
    logger.debug('PUT', '/proxies/:proxyName')
    logger.debug(':proxyName', req.params.proxyName)
    var eventParams = {
      enabled: false,
      proxyName: req.params.proxyName,
      userParameters: req.body.userParameters
    }
    eventParams.enabled = req.body.enabled.toString().toLowerCase() === 'true'

    var _emitSwitchEvent = function _emitSwitchEvent (eventParams) {
      return new Promise(function (resolve, reject) {
        var _callbackProxy = function _callbackProxy (err, proxyInfo) {
          if (err) {
            reject({
              statusCode: 404,
              error: err
            })
          }
          else
          {
            logger.debug('enabled/disabled Proxy:', proxyInfo)
            resolve()
          }

        }
        self.emit('switchProxy', eventParams, _callbackProxy)
      })
    }

    var _emitUpdateConfigEvent = function _emitUpdateConfigEvent (eventParams) {
      return new Promise(function (resolve, reject) {
        var _callbackProxy = function _callbackProxy (err, proxyInfo) {
          if (err) {
            reject({
              statusCode: 404,
              error: err
            })
          }
          else
          {
            logger.debug('update Proxy Config:', proxyInfo)
            resolve(proxyInfo)
          }
        }
        self.emit('updateProxyConfig', eventParams, _callbackProxy)
      })
    }

    _emitSwitchEvent(eventParams)
      .then(function () {
        var userToken = _findToken(req)
        var userId = req.body.userId || req.session.userId
        if(self._config.optionalArtikOnBoarding.clientId === '' || self._config.optionalArtikOnBoarding.clientSecret === '')
          _emitUpdateConfigEvent(eventParams)
        else
          return _checkTokenAndUserId(userToken, userId, self._config.optionalArtikOnBoarding).then(_emitUpdateConfigEvent.bind(this, eventParams))
      })
      .then(function (info) {
        res.json(info)
      })
      .catch(function (reason) {
        res.status(reason.statusCode).json({ error: reason.error })
      })
  })



}

ApiServer.prototype._configExpress = function () {
  var authRoot = this._config.optionalArtikOnBoarding ? this._config.optionalArtikOnBoarding.authPath || '/auth' : '/auth'
  var publicDir = this._config.dir ? this._config.dir.publicDir || 'public' : 'public'
  var sessionOptions = {
    store: null,
    name: 'userIdentity',
    secret: 'artikcloud',
    resave: true,
    saveUninitialized: true
  }
  if (this._config['NODE_ENV'] !== 'test') {
    sessionOptions.store = new FileStore({
      path: './data'
    // encrypt: true
    })
    this._sessionIntervalToClean = sessionOptions.store.options.reapIntervalObject
  }

  this._app.use(Express.static(publicDir))
  this._app.use(Session(sessionOptions))
  this._app.use('/proxydevices', this._proxyDevicesRouter)
  this._app.use('/proxies', this._proxiesRouter)
  this._app.use(authRoot, IdentityProvider)
  this._app.use('/', this._uiRouter)
}

ApiServer.prototype._defineIo = function () {
  var self = this
  this._io.on('error', function (err) {
    logger.log('error', 'Socket.io connection error: ' + err)
  })
  this._io.on('connection', function (socket) {
    logger.log('info', 'Socket.io connection success')
    self._socket = socket
  })
}

ApiServer.prototype._defineSSDP = function () {
  var descriptionFileName = 'description.xml'
  var port = _extractPortFromConfig(this._config)
  var endpoint = Ip.address() + ':' + port
  _xmlParseReplaceURLBase(descriptionFileName, endpoint)
  this._ssdpServer = new SSDP({
    udn: 'uuid:32b12b00-dcb3-4b17-90ff-cc99b62ff6a5',
    location: endpoint + '/' + descriptionFileName,
    description: '/' + descriptionFileName
  })
  this._ssdpServer.addUSN('upnp:rootdevice')
  this._ssdpServer.addUSN('urn:artikcloud:device:proxyhub:1')
  this._ssdpServer.on('advertise-alive', function () {
    // logger.debug('advertise-alive', heads)
    // Expire old devices from your cache.
    // Register advertising device somewhere (as designated in http headers heads)
    logger.silly('Got a advertise-alive.')
  })
  this._ssdpServer.on('advertise-bye', function () {
    // logger.debug('advertise-bye', heads)
    logger.debug('Got a advertise-bye.')
  // Remove specified device from cache.
  })
}

ApiServer.prototype.init = function (config) {
  this._config = config

  logger = ProxyHubLogger('API_SERVER', this._config)

  try {
    IdentityProvider.init(this._config)
  }
  catch (err) {
    logger.warn('Unable to init IdentityProvider - no client ID and secret provided in config.json')
  }

  this._initProxyDevicesRouter()
  this._initProxiesRouter()
  this._initUiRouter()
  this._configExpress()
  this._defineSSDP()
}

ApiServer.prototype.listenTo = function (consumer) {
  if (consumer) {
    consumer.on('linkedProxyDevicesUpdate', (function () {
      if(this._socket != null) {
        this._socket.emit('linkedProxyDevicesUpdate')
      }
    }).bind(this))
    consumer.on('notLinkedProxyDevicesUpdate', (function () {
      if(this._socket != null) {
        this._socket.emit('notLinkedProxyDevicesUpdate')
      }
    }).bind(this))
    consumer.on('proxyDevicesUpdate', (function () {
      if(this._socket != null) {
        this._socket.emit('linkedProxyDevicesUpdate')
        this._socket.emit('notLinkedProxyDevicesUpdate')
      }
    }).bind(this))
  }
}

ApiServer.prototype.start = function () {
  logger.debug(JSON.stringify(this._config))
  var port = _extractPortFromConfig(this._config)
  var httpsEnabled = this._config.server.https
  // Create an HTTP/S service
  var httpsKey
  var httpsCert
  if (httpsEnabled) {
    try {
      httpsKey = Fs.readFileSync(this._config.server.httpsKeyFilepath)
      httpsCert = Fs.readFileSync(this._config.server.httpsCertFilepath)
    } catch (error) {
      logger.error(error)
      httpsEnabled = false
    }
    this._server = Https.createServer({key: httpsKey, cert: httpsCert}, this._app)
  } else {
    this._server = Http.createServer(this._app)
  }
  this._server.on('error', logger.error)
  this._server.listen(port, function () {
    var protoStr = httpsEnabled ? 'https://' : 'http://'
    logger.info('Server is listening at ' + protoStr + this.address().address + ':' + port)
  })

  this._io = Io(this._server)
  this._defineIo()
  // start SSDP server on all interfaces
  this._ssdpServer.start('0.0.0.0')
}

ApiServer.prototype.close = function () {
  logger.debug('CLOSE api server')
  if (this._server) {
    this._server.close()
  }
  if (this._sessionIntervalToClean) {
    clearInterval(this._sessionIntervalToClean)
  }

  if (this._ssdpServer) {
    this._ssdpServer.stop()
  }
}
