/*global process */
'use strict'

module.exports = ProxyFactory

var EventEmitter = require('events').EventEmitter
var Util = require('util')
var Fs = require('fs')
var Path = require('path')
var Winston = require('winston')
var Chokidar = require('chokidar')
var Promise = require('promise')
var ProxyHubLogger = require('./proxy-hub-logger')
require('./common')

var logger = new Winston.Logger()

function ProxyFactory (config) {
  EventEmitter.call(this)
  this.removeAllListeners()
  this._config = {}
  this._closed = false
  this._proxies = {}
  this._scheduledUpdateTimeouts = {}
  this._watcher = {}
  if (config) {
    this.init(config)
  }
}
Util.inherits(ProxyFactory, EventEmitter)

var uniqueProxyDeviceId = function (proxyName, proxyDeviceInternalId) {
  return [proxyName, proxyDeviceInternalId].join('.')
}

var parseUniqueProxyDeviceId = function (proxyDeviceId) {
  return proxyDeviceId.split('.')
}

var readJsonFileSync = function (file) {
  var content = Fs.readFileSync(file)
  try {
    return JSON.parse(content)
  } catch (err) {
    logger.error(err)
  }
}

ProxyFactory.prototype.init = function (config) {
  if (config) {
    this._config = config
  }
  this._watcher = Chokidar.watch(this._config.dir.proxies, {
    ignored: new RegExp(Path.join(this._config.dir.proxies, '[_.]')),
    awaitWriteFinish: true,
    ignoreInitial: true
  })
  this._configWatcher(this._watcher)

  // init log level
  logger = ProxyHubLogger('PROXY_FACTORY', this._config)

  this._proxies = {}
  this._scheduledUpdateTimeouts = {}

  this._initProxies()
}

ProxyFactory.prototype._configWatcher = function (watcher) {
  logger.debug('_configWatcher')
  var self = this

  watcher.on('all', (event, path) => {
    var proxiesDir = Path.normalize(self._config.dir.proxies)
    var regExpProxyDir = new RegExp('^' + proxiesDir + Path.sep)
    var detectedPath = path.replace(regExpProxyDir, '')
    switch (event) {
    case 'unlinkDir':
      if (detectedPath.indexOf(Path.sep) === -1) {
        logger.debug('removeProxy', detectedPath)
        self._removeProxy(detectedPath)
        return
      }
      break
    case 'addDir':
      if (detectedPath.indexOf(Path.sep) === -1) {
        logger.debug('loadProxy', detectedPath)
        self._loadProxy(detectedPath)
        return
      }
      break
    case 'change':
      var cuttedProxyName = detectedPath.slice(0, detectedPath.indexOf(Path.sep))
      logger.debug('some file changed in proxy:', cuttedProxyName)
      //self._removeProxy(cuttedProxyName)
      self._loadProxy(cuttedProxyName)
      /*
        self._removeProxy(cuttedProxyName, function () {
          self._loadProxy(cuttedProxyName)
        })
        */
      break
    default:
      break
    }
  })
}

ProxyFactory.prototype.close = function () {
  this._closed = true
  this._watcher.close()
  for (var proxyName in this._scheduledUpdateTimeouts) {
    if (this._scheduledUpdateTimeouts.hasOwnProperty(proxyName)) {
      logger.debug('clear timeout: ' + proxyName + '=>' + this._scheduledUpdateTimeouts[proxyName])
      clearTimeout(this._scheduledUpdateTimeouts[proxyName])
    }
  }
}

ProxyFactory.prototype.listenTo = function (eventEmitter) {
  var self = this
  eventEmitter.on('newAction', function (proxyDeviceId, actionName, actionParameters) {
    logger.debug('newAction', actionName)
    self._onNewAction(proxyDeviceId, actionName, actionParameters)
  })
  eventEmitter.on('askNewDevice', function (proxyName) {
    logger.debug('askNewDevice', proxyName)
    self._askNewDevice(proxyName)
  })
  eventEmitter.on('getProxiesFromFactory', function (callback) {
    logger.debug('getProxiesFromFactory')
    self._onGetProxies(callback)
  })
  eventEmitter.on('getProxyInfoFromFactory', function (params, callback) {
    logger.debug('getProxyInfoFromFactory')
    try {
      params.proxyInfo = extractInfoProxy.bind(self)(params.proxyName)
    } catch(e) {
      logger.debug('No proxy info for %s', params.proxyName)
    }
    callback(params)
  })
  eventEmitter.on('updateProxyConfigInFactory', function (params, callback) {
    logger.debug('updateProxyConfigInFactory')
    self._onUpdateProxyConfig(params, callback)
  })

  eventEmitter.on('getProxiesStatusesFromFactory', function (callback) {
    logger.debug('getProxiesStatusesFromFactory')
    self._getProxiesStatuses(callback)
  })

}

ProxyFactory.prototype.restart = function () {
  logger.info('==============================')
  logger.info('Restart Proxy factory')
  this._init()
  this._initProxies()
}

ProxyFactory.prototype.getProxyByProxyDeviceId = function (proxyDeviceId) {
  return parseUniqueProxyDeviceId(proxyDeviceId)[0]
}

ProxyFactory.prototype.getProxy = function (proxyName) {
  logger.debug('Get proxy: ' + proxyName)
  logger.debug('List of proxies: ', Object.keys(this._proxies))
  return this._proxies[proxyName]
}

ProxyFactory.prototype._loadProxy = function (proxyName) {
  if(/^[_.]/.test(proxyName))
    return
  var filepath = Path.join(process.cwd(), this._config.dir.proxies, proxyName, proxyName + '.js')
  var configPath = Path.join(process.cwd(), this._config.dir.proxies, proxyName, 'config.json')
  if (!Path.isAbsolute(filepath)) {
    filepath = './' + filepath
  }
  var self = this
  var loadOneProxy = function (proxyConfig) {
    var isNew = false
    if(self._proxies[proxyName] == null)
      isNew = true
    self._proxies[proxyName] = new Proxy(proxyConfig)
    self._proxies[proxyName].on('newDevice', function (proxyDevice) {
      self._onNewProxyDevice(proxyName, proxyDevice)
    })
    self._proxies[proxyName].on('newMessage', function (proxyDeviceInternalId, message) {
      self._onNewMessage(proxyName, proxyDeviceInternalId, message)
    })
    self._proxies[proxyName].init()

    if(isNew){
      self._askNewDevice(proxyName)
    }
    self.emit('addProxyInWrapper')
    if (proxyConfig.scheduleUpdatePeriodMs) {
      self._scheduleUpdate(proxyConfig.scheduleUpdatePeriodMs, proxyName)
    }
  }
  try {
    logger.debug('Instanciate Proxy ' + filepath)
    var Proxy = require(filepath)
    var proxyConfig = {}
    Fs.exists(configPath, function (exists) { // fs.exists is a deprecated API, change to fs.access
      if (!exists) {
        logger.info('No config found for proxy: %s', proxyName)
      } else {
        // Load config
        proxyConfig = readJsonFileSync(configPath)
        logger.debug('Loaded proxy config: ', configPath)
      }
      // add log level
      proxyConfig.log = {'level': self._config.log.level, 'filename': self._config.log.filename}

      loadOneProxy(proxyConfig)
    })
  } catch (e) {
    logger.error('Can\'t use proxy ' + filepath)
    logger.error('  -> message: ' + e.message)
    logger.error('  -> stack: ' + e.stack)
  }
}

/**
 * Initialize Proxies.
 */
ProxyFactory.prototype._initProxies = function () {
  logger.debug('Init Proxies')
  var self = this

  Fs.readdir(this._config.dir.proxies, function (err, files) {
    if (err) {
      logger.error('Can\'t find proxies: ' + err)
      return
    }
    files.filter(function (filename) {
      return !/^[_.]/.test(filename)
    }).forEach(function (proxyName) {
      logger.debug('Loading Proxy ' + proxyName)
      self._loadProxy(proxyName)
    })
  })
}

ProxyFactory.prototype._removeProxy = function (proxyName, callback) {
  delete this._proxies[proxyName]
  logger.debug('deleted', proxyName, 'in ProxyFactory')
  this.emit('removeProxyInWrapper', proxyName, function () {
    if (callback) {
      callback()
    }
  })
}

ProxyFactory.prototype._askNewDevice = function (proxyName) {
  if(this._proxies[proxyName].addNewDevice != null){
    logger.debug('Adding a new device on %s', proxyName)

    this._proxies[proxyName].addNewDevice()
  }
}

var extractInfoProxy = function (fname) {
  var proxyName = fname
  if (/^[_.]/.test(fname)) {
    return null
  }
  var configPath = Path.join(this._config.dir.proxies, fname, 'config.json')
  var proxyConfig = readJsonFileSync(configPath)
  var info = proxyConfig.public ? proxyConfig.public : {}
  info.name = proxyName
  info.canDemandDevice = this._proxies[proxyName].addNewDevice != null

  return info
}

ProxyFactory.prototype._onGetProxies = function (callback) {
  var self = this
  var readdir = new Promise(function (resolve, reject) {
    Fs.readdir(self._config.dir.proxies, function (err, files) {
      if (err) {
        reject('Can\'t find proxies: ' + err)
      }
      resolve(files)
    })
  })

  var handleProxies = function (files) {
    var proxiesInfo = files
      .filter(function (fname) {
        if(/^[_.]/.test(fname)){
          return false
        }
        var proxyPath = Path.join(self._config.dir.proxies, fname)
        return Fs.lstatSync(proxyPath).isDirectory()
      })
      .map(extractInfoProxy.bind(self))
    return Promise.resolve(proxiesInfo)
  }

  readdir
    .then(handleProxies)
    .then(callback)
    .catch(logger.error)
}

ProxyFactory.prototype._getProxyInfo = function (params, callback) {
  // callback(err, proxyInfo)
  var self = this
  var proxyName = params.proxyName.toString().split('_').pop()
  var proxyPath = Path.join(self._config.dir.proxies, proxyName)
  Fs.access(proxyPath, function (err) {
    if (err) {
      logger.error('Could not access the proxy path %s: %s', proxyPath, err)
    } else {
      callback(null, extractInfoProxy.bind(self)(proxyName))
    }
  })
}

ProxyFactory.prototype._onUpdateProxyConfig = function (params, callback) {
  // callback(err, proxyInfo)
  var self = this
  var proxyName = params.proxyName.toString().split('_').pop()
  var newUserParameters = params.userParameters
  var proxyPath = Path.join(self._config.dir.proxies, proxyName)
  var validateUserParameters = function (proxyName, userParams) {
    var proxy = self.getProxy(proxyName)
    try {
      logger.debug('Run \'validateUserParameters\' for: \'' + proxyName + '\' with args: ' + JSON.stringify(userParams))
      proxy['validateUserParameters'](userParams)
    } catch (e) {
      logger.warn('Can not send action: ' + e)
    }
  }
  var updateProxyConfig = function (proxyFileName) {
    var configPath = Path.join(self._config.dir.proxies, proxyFileName, 'config.json')
    var proxyConfig = readJsonFileSync(configPath)
    if (!proxyConfig.public) {
      proxyConfig.public = {}
    }
    if (newUserParameters) {
      proxyConfig.public.userParameters = newUserParameters
      Fs.writeFileSync(configPath, JSON.stringify(proxyConfig, null, 2))
      validateUserParameters(proxyName, newUserParameters)
    }
    callback(null, extractInfoProxy.bind(self)(proxyFileName))
  }
  Fs.access(proxyPath, function (err) {
    if (err) {
      logger.error('Could not access the proxy path %s: %s', proxyPath, err)
    } else {
      updateProxyConfig(proxyName)
    }
  })
}

ProxyFactory.prototype._onNewProxyDevice = function (proxyName, proxyDevice) {
  if (!proxyDevice['proxyDeviceInternalId'] || !proxyDevice['proxyDeviceName'] || !proxyDevice['proxyDeviceTypeName'] || !proxyDevice['akcDtid']) {
    logger.error('Proxy device sent is incompatible (missing parameters): ' + JSON.stringify(proxyDevice))
    return
  }

  // transform unique id for a proxy to a universal unique id
  var proxyDeviceId = uniqueProxyDeviceId(proxyName, proxyDevice.proxyDeviceInternalId)
  logger.debug('- proxyName:' + proxyName)
  logger.debug('- proxyDeviceName:' + proxyDevice.proxyDeviceName)
  logger.debug('- proxyDeviceId:' + proxyDeviceId)
  logger.debug('- proxyDeviceInternalId:' + proxyDevice.proxyDeviceInternalId)
  logger.debug('- proxyDeviceTypeName:' + proxyDevice.proxyDeviceTypeName)
  logger.debug('- akcDtid:' + proxyDevice.akcDtid)
  logger.debug('- proxyDeviceData:' + proxyDevice.proxyDeviceData)

  // store new proxy device
  proxyDevice.proxyName = proxyName
  proxyDevice.proxyDeviceId = proxyDeviceId
  if(this._proxies[proxyName]._config.public.userParametersPerDevice != null){
    //copy the objects
    var userParamsDevice = JSON.parse(JSON.stringify(this._proxies[proxyName]._config.public.userParametersPerDevice))
    if(proxyDevice.userParametersPerDevice != null)
      userParamsDevice = proxyDevice.userParametersPerDevice
    else
      proxyDevice.userParametersPerDevice = userParamsDevice
  }
  // propagate new device
  this.emit('newDevice', proxyDevice)
}

ProxyFactory.prototype._onNewMessage = function (proxyName, proxyDeviceInternalId, message) {
  var proxyDeviceId = uniqueProxyDeviceId(proxyName, proxyDeviceInternalId)
  logger.debug('New message %s from %s:', JSON.stringify(message), proxyDeviceId)
  // propagate new message
  this.emit('newMessage', proxyDeviceId, message)
}

ProxyFactory.prototype._onNewAction = function (proxyDeviceId, actionName, actionParameters) {
  logger.debug('Call Proxy ' + proxyDeviceId + ' with action: ' + actionName + ' with args: ' + JSON.stringify(actionParameters))
  if (!proxyDeviceId || !actionName) {
    logger.error('Bad formatted action')
    return
  }
  var proxy = this._proxies[this.getProxyByProxyDeviceId(proxyDeviceId)]
  if (!proxy) {
    logger.warn('Can not send action ' + actionName + ' to this unknown device: ' + proxyDeviceId)
    return
  }
  var callback = function (err, proxyDevice)
  {
    if(err)
    {
      logger.warn('Cannot this unknown device:' + proxyDeviceId)
    }
    else if(proxyDevice)
    {
      try {
        if (typeof actionParameters === 'string') {
          actionParameters = JSON.parse(actionParameters)
        }
        logger.debug('Run ' + actionName + 'Action' + ' for: ' + JSON.stringify(proxyDevice) + ' with args: ' + JSON.stringify(actionParameters))
        proxy[actionName + 'Action'](proxyDevice, actionParameters)
      } catch (e) {
        logger.warn('Can not send action: ' + e)
      }
    }
  }
  this.emit('getDevice', proxyDeviceId, callback)
}

ProxyFactory.prototype._scheduleUpdate = function (scheduleUpdatePeriodMs, proxyName) {
  var self = this
  var proxy = this._proxies[proxyName]

  if (!this._closed) {
    this._scheduledUpdateTimeouts[proxyName] = setTimeout(function () {
      logger.silly('Scheduled update for: ' + proxyName)
      if (proxy.scheduledUpdate) {
        proxy.scheduledUpdate()
        self._scheduleUpdate(scheduleUpdatePeriodMs, proxyName)
      }
    }, scheduleUpdatePeriodMs)
  }
}

ProxyFactory.prototype._getProxiesStatuses = function(callback)
{
  var result = {'globalLevel':'OK', 'proxiesStatuses':[]}

  for(var proxyName in this._proxies)
  {
    if(typeof this._proxies[proxyName].getStatus == 'function')
    {
      var status = this._proxies[proxyName].getStatus()
      status['proxyName'] = proxyName
      result.proxiesStatuses.push(status)

      if(result.globalLevel == 'OK' && status.level == 'WARNING')
        result.globalLevel = 'WARNING'

      if(status.level == 'ERROR')
        result.globalLevel = 'ERROR'

    }

  }

  callback(result)
}
