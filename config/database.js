var mongoose = require('mongoose');
var childProcess = require('child_process');

var mongoUri = process.env.MONGO_URI;

function resolveWindowsDns(query) {
  return new Promise(function(resolve, reject) {
    childProcess.execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    }, function(error, stdout) {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout.trim() || '[]')); }
      catch (parseError) { reject(parseError); }
    });
  });
}

async function getMongoConnectionUri() {
  if (!mongoUri) throw new Error('Configure MONGO_URI no ambiente do servidor.');
  if (process.platform !== 'win32' || !mongoUri.toLowerCase().startsWith('mongodb+srv://')) return mongoUri;

  var source = new URL(mongoUri);
  var host = source.hostname.replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/i.test(host)) return mongoUri;

  var srvQuery = "Resolve-DnsName -Type SRV -Name '_mongodb._tcp." + host + "' | Select-Object NameTarget,Port | ConvertTo-Json -Compress";
  var txtQuery = "Resolve-DnsName -Type TXT -Name '" + host + "' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Strings | ConvertTo-Json -Compress";
  var results = await Promise.all([resolveWindowsDns(srvQuery), resolveWindowsDns(txtQuery)]);
  var records = Array.isArray(results[0]) ? results[0] : [results[0]];
  var servers = records.filter(function(record) { return record && record.NameTarget && record.Port; }).map(function(record) {
    return String(record.NameTarget).replace(/\.$/, '') + ':' + Number(record.Port);
  });
  if (!servers.length) throw new Error('Não foi possível localizar os servidores do MongoDB no DNS.');

  var options = new URLSearchParams(source.search);
  var txtRecords = Array.isArray(results[1]) ? results[1] : [results[1]];
  String(txtRecords.filter(Boolean).join('&')).split('&').forEach(function(entry) {
    var separator = entry.indexOf('=');
    if (separator > 0) {
      var key = entry.slice(0, separator);
      if (!options.has(key)) options.set(key, entry.slice(separator + 1));
    }
  });
  if (!options.has('tls') && !options.has('ssl')) options.set('tls', 'true');

  var credentials = source.username ? source.username + (source.password ? ':' + source.password : '') + '@' : '';
  var queryString = options.toString();
  return 'mongodb://' + credentials + servers.join(',') + source.pathname + (queryString ? '?' + queryString : '');
}

function connectDatabase() {
  return getMongoConnectionUri().then(function(uri) { return mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 }); })
    .then(function() {
      console.log('MongoDB conectado');
    })
    .catch(function(error) {
      console.error('Nao foi possivel conectar ao MongoDB:', error.message);
    });
}

function getConnectionState() {
  var states = ['desconectado', 'conectado', 'conectando', 'desconectando'];
  return states[mongoose.connection.readyState] || 'desconhecido';
}

module.exports = {
  connectDatabase: connectDatabase,
  getMongoConnectionUri: getMongoConnectionUri,
  getConnectionState: getConnectionState
};
