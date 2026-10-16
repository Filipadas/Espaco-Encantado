var mongoose = require('mongoose');
var bcrypt = require('bcryptjs');
var childProcess = require('child_process');
var User = require('../models/User');
var Product = require('../models/Product');

var mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/espaco_encantado';
var adminEmail = String(process.env.ADMIN_EMAIL || 'admin@espacoencantado.com').toLowerCase().trim();
var adminPassword = String(process.env.ADMIN_PASSWORD || 'admin123');

async function seedTestProducts() {
  var definitions = [
    { name: 'Castelo Inflável Aurora', category: 'brinquedos', price: 180, stockTotal: 4, description: 'Brinquedo inflável colorido para festas.' },
    { name: 'Piscina de Bolinhas Arco-Íris', category: 'brinquedos', price: 145, stockTotal: 5, description: 'Piscina de bolinhas para crianças.' },
    { name: 'Painel Jardim Encantado', category: 'decoracoes', price: 95, stockTotal: 3, description: 'Painel decorativo com tema jardim.' },
    { name: 'Mesa Provençal Branca', category: 'decoracoes', price: 75, stockTotal: 6, description: 'Mesa para doces e lembranças.' },
    { name: 'Kit Festa Estrelas', category: 'kit-montagem', price: 260, stockTotal: 0, description: 'Kit completo com decoração de estrelas.' },
    { name: 'Kit Festa Safari', category: 'kit-montagem', price: 310, stockTotal: 0, description: 'Kit completo com decoração safari.' },
    { name: 'Festa Infantil Mundo Mágico', category: 'festa-infantil', price: 420, stockTotal: 0, description: 'Composição infantil com brinquedo e decoração.' },
    { name: 'Festa Infantil Pequeno Explorador', category: 'festa-infantil', price: 495, stockTotal: 0, description: 'Composição para uma festa cheia de aventura.' }
  ];
  var products = {};
  for (var index = 0; index < definitions.length; index += 1) {
    var definition = definitions[index];
    products[definition.name] = await Product.findOne({ name: definition.name });
    if (!products[definition.name]) products[definition.name] = await Product.create(definition);
  }
  var kitComponents = {
    'Kit Festa Estrelas': [{ product: products['Painel Jardim Encantado']._id, category: 'decoracoes', quantity: 1 }, { product: products['Mesa Provençal Branca']._id, category: 'decoracoes', quantity: 1 }],
    'Kit Festa Safari': [{ product: products['Painel Jardim Encantado']._id, category: 'decoracoes', quantity: 1 }, { product: products['Piscina de Bolinhas Arco-Íris']._id, category: 'brinquedos', quantity: 1 }],
    'Festa Infantil Mundo Mágico': [{ product: products['Castelo Inflável Aurora']._id, category: 'brinquedos', quantity: 1 }, { product: products['Painel Jardim Encantado']._id, category: 'decoracoes', quantity: 1 }],
    'Festa Infantil Pequeno Explorador': [{ product: products['Piscina de Bolinhas Arco-Íris']._id, category: 'brinquedos', quantity: 1 }, { product: products['Mesa Provençal Branca']._id, category: 'decoracoes', quantity: 1 }]
  };
  return Promise.all(Object.keys(kitComponents).map(function(name) {
    return Product.findByIdAndUpdate(products[name]._id, { components: kitComponents[name] });
  }));
}

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
      return User.findOne({ email: adminEmail }).then(function(user) {
        if (user) return user;
        return User.create({
          name: 'Administrador',
          email: adminEmail,
          password: bcrypt.hashSync(adminPassword, 10),
          role: 'admin'
        });
      }).then(function() { return seedTestProducts(); });
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
  getConnectionState: getConnectionState
};
