'use strict'

var Express = require('express')
var passport = require('passport')
var OAuth2Strategy = require('passport-oauth').OAuth2Strategy
var https = require('https')
var url = require('url')
var winston = require('winston')
var Promise = require('promise')
var Fs = require('fs')
var path = require('path')
var proxyHubLogger = require('./proxy-hub-logger')

var logger = new winston.Logger()

var IdentityProvider = Express.Router()

IdentityProvider.init = function (config) {
  this._config = config
  IdentityProvider._token = {}
  var _authRoot = this._config.optionalArtikOnBoarding ? this._config.optionalArtikOnBoarding.authPath || '/auth' : '/auth'

  // init log level
  logger = proxyHubLogger('IDENTITY_PROVIDER', this._config)

  // This router should added under a Express which already usd express-session
  // The following config are hard-coded & this router should be binded to /auth
  var passportOptions = {
    authorizationURL: IdentityProvider._config.optionalArtikOnBoarding.authUrl + '/authorize',
    tokenURL: IdentityProvider._config.optionalArtikOnBoarding.authUrl + '/token',
    clientID: IdentityProvider._config.optionalArtikOnBoarding.clientId,
    clientSecret: IdentityProvider._config.optionalArtikOnBoarding.clientSecret,
    callbackURL: IdentityProvider._config.optionalArtikOnBoarding.callbackUrl
  }
  passport.use('artikcloud', new OAuth2Strategy(passportOptions, function (accessToken, refreshToken, profile, done) {
    logger.debug('accessToken', accessToken)
    logger.debug('refreshToken', refreshToken)
    done(null, true)
    IdentityProvider._token = accessToken
  }))
  passport.serializeUser(function (user, done) {
    logger.debug('serializeUser')
    done(null, user)
  })
  passport.deserializeUser(function (id, done) {
    logger.debug('deserializeUser')
    done(null, id)
  })

  IdentityProvider.use(passport.initialize())
  IdentityProvider.use(passport.session())

  // Redirect the user to the OAuth 2.0 provider for authentication.  When
  // complete, the provider will redirect the user back to the application at
  //     /provider/callback
  IdentityProvider.get('/artikcloud', function (req, res, next) {
    logger.debug('GET ' + _authRoot + '/artikcloud/')
    var clientParams = [IdentityProvider._config.optionalArtikOnBoarding.clientId, IdentityProvider._config.optionalArtikOnBoarding.clientSecret]
    var isLegal = function isLegal (str) {
      return (/^[a-zA-Z0-9]+$/.test(str)
      )
    }
    if (!clientParams.every(isLegal)) {
      logger.warn('AKC app clientID or clientSecret illegal or not exist, [clientID, clientSecret]: ' + clientParams)
      res.send('<a href="/">AKC app clientID or clientSecret illegal or not exist, click here to redirect to index page ...</a>')
      return
    }
    if (req.session.userToken) {
      logger.debug('req.session.userToken', req.session.userToken)
      res.redirect(_authRoot + '/artikcloud/user_identity')
    } else {
      logger.debug('!req.session.userToken')
      next()
    }
  }, passport.authenticate('artikcloud', {}))

  // The OAuth 2.0 provider has redirected the user back to the application.
  // Finish the authentication process by attempting to obtain an access
  // token.  If authorization was granted, the user will be logged in.
  // Otherwise, authentication has failed.
  IdentityProvider.get('/artikcloud/callback', function (req, res, next) {
    logger.debug('GET ' + _authRoot + '/artikcloud/callback')
    next()
  }, passport.authenticate('artikcloud', {
    successRedirect: _authRoot + '/artikcloud/user_identity'
  }))

  IdentityProvider.get('/artikcloud/user_identity', function (req, res) {
    req.session.loginstatus = true
    var _handleUserIdResponse = function _handleUserIdResponse (chunk) {
      logger.debug('_handleUserIdResponse')
      logger.debug('BODY: ' + chunk)
      var content = JSON.parse(chunk)
      if (content.error) {
        logger.warn(content.error)
        req.session.userToken = null
        res.redirect(_authRoot + '/artikcloud')
        // invalid userToken! go back to auth/artikcloud!
        return
      }
      if(IdentityProvider._config.optionalArtikOnBoarding.userId == ''){
        IdentityProvider._config.optionalArtikOnBoarding.userId = content.data.id
        try {
          var configPath = path.resolve(path.resolve(path.dirname('')), 'config.json')
          Fs.writeFileSync(configPath, JSON.stringify(IdentityProvider._config, null, 2))
        }
        catch (err) {
          logger.error('unable to write to ProxyHub config.json')
        }
      }

      req.session.userId = content.data.id
      req.session.loginstatus = true
      res.redirect('/')
    // supposed here is /auth/artikcloud/user_identity, so ../../.. means index
    }
    var _getUserId = function _getUserId () {
      return new Promise(function (resolve, reject) {
        logger.debug('_getUserId')
        var apiUrl = url.parse(IdentityProvider._config.artikCloud.apiUrl)
        var options = {
          host: apiUrl.host,
          path: apiUrl.pathname + '/users/self',
          headers: {
            'Authorization': 'bearer ' + req.session.userToken
          }
        }
        https.get(options, function (res) {
          logger.debug('Got response: ' + res)
          res.on('data', function (chunk) {
            resolve(chunk)
          })
        }).on('error', function (err) {
          reject('Got error: ' + err.message)
        })
      })
    }

    var _checkStoreSessionToken = function _checkStoreSessionToken () {
      logger.debug('_checkReq')
      if (!req.session.userToken) {
        req.session.userToken = IdentityProvider._token
      }
    }

    logger.debug('GET /auth/artikcloud/user_identity')
    _checkStoreSessionToken()
    _getUserId().then(_handleUserIdResponse).catch(logger.error)
  })

  IdentityProvider.get('/loginstatus', function (req, res) {
    logger.debug('GET', '/loginstatus')
    logger.debug('request.session', req.session)
    var result = {}
    if (req.session) {
      var configUserId = IdentityProvider._config.optionalArtikOnBoarding.userId
      result.state = (req.session.loginstatus && (IdentityProvider._config.optionalArtikOnBoarding.multipleAccounts || req.session.userId === configUserId || configUserId === ''))
      if(!result.state){
        if(req.session.loginstatus){
          result.code = 403
          result.message = 'This proxy hub is already claimed by an other user he needs to logout before you can use it.'
        } else if (!IdentityProvider._config.optionalArtikOnBoarding.multipleAccounts && configUserId !== '') {
          result.code = 401
          result.message = 'You need to signin in order to access the content.'
        }
      }
    }
    res.json(result)
  })

  IdentityProvider.delete('/uid', function (req, res) {
    logger.debug('DELETE', '/uid')
    logger.debug('request.session', req.session)
    var result = {}
    if (req.session) {
      var isOwner = (req.session.loginstatus && (IdentityProvider._config.optionalArtikOnBoarding.multipleAccounts || req.session.userId === IdentityProvider._config.optionalArtikOnBoarding.userId))
      if(!isOwner){
        if(req.session.loginstatus){
          result.code = 403
          result.message = 'This proxy hub is already claimed by an other user he needs to logout before you can use it.'
        } else {
          result.code = 401
          result.message = 'You need to signin in order to access the content.'
        }
      } else {
        result.code = 200
        result.message = 'The owner of the proxy hub has been reset successfully the device connected to ARTIK Cloud will still work with you account until you disconnect them.'
        IdentityProvider._config.optionalArtikOnBoarding.userId = ''
        try {
          var configPath = path.resolve(path.resolve(path.dirname('')), 'config.json')
          Fs.writeFileSync(configPath, JSON.stringify(IdentityProvider._config, null, 2))
        }
        catch (err) {
          logger.error('unable to write to ProxyHub config.json')
          result.code = 500
          result.message = 'An internal server occur please retry later or reboot your proxyhub.'
        }
      }
    }
    res.status(result.code).json(result)
  })

  IdentityProvider.get('/logout', function (req, res) {
    logger.debug('GET', '/logout')
    logger.debug('request.session', req.session)
    req.session.loginstatus = false
    var response = res
    return new Promise(function () {
      logger.debug('_getUserId')
      var apiUrl = url.parse(IdentityProvider._config.optionalArtikOnBoarding.authUrl)
      logger.warn('logout: ' + apiUrl.host)
      logger.warn('logout: ' + '/logout')
      logger.warn('host: ' + req.get('host'))
      logger.warn('origin: ' + req.get('origin'))
      var options = {
        host: apiUrl.host,
        path: '/logout?redirect_uri=https%3A%2F%2F' + req.get('host'),
        headers: {
          'Authorization': 'bearer ' + req.session.userToken
        }
      }
      https.get(options, function (res) {
        logger.info('Logout ok: ' + res.statusCode)
        logger.info('Logout ok: ' + res.statusMessage)
        logger.info('Logout ok: ' + res.location)

        req.session.userToken = null
        response.redirect('/')
      }).on('error', function (err) {
        logger.error('Logout error: ' + err.message)
        response.redirect('/')
      })
    })
  })
}

module.exports = IdentityProvider
