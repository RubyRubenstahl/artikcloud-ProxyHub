var winston = require('winston')
require('winston-logrotate')

var proxyHubLogger = function(name, _config){
  var logConf = {
    level: _config.log.level,
    label: name,
    colorize: true,
    timestamp: function timestamp() {
      return new Date().toLocaleString()
    }
  }
  if(_config.log.filename == null){
    return new winston.Logger({
      transports: [new winston.transports.Console(logConf)]
    })
  } else {
    logConf.file = _config.log.filename
    logConf.timestamp = true
    logConf.maxDays = 3
    logConf.size = '10m'
    logConf.keep = 5
    var rotateTransport = new winston.transports.Rotate(logConf)
    return new winston.Logger({
      transports: [rotateTransport]
    })
  }
}



module.exports = proxyHubLogger
