var mongoose = require('mongoose');
var bcrypt = require('bcryptjs');
var dns = require('dns');
var User = require('../models/User');
var Product = require('../models/Product');

var mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/espaco_encantado';
var adminEmail = String(process.env.ADMIN_EMAIL || 'admin@espacoencantado.com').toLowerCase().trim();
var adminPassword = String(process.env.ADMIN_PASSWORD || 'admin123');

dns.setServers(['1.1.1.1', '8.8.8.8']);

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
    'Kit Festa Estrelas': [{ product: products['Painel Jardim Encantado']._id, quantity: 1 }, { product: products['Mesa Provençal Branca']._id, quantity: 1 }],
    'Kit Festa Safari': [{ product: products['Painel Jardim Encantado']._id, quantity: 1 }, { product: products['Piscina de Bolinhas Arco-Íris']._id, quantity: 1 }],
    'Festa Infantil Mundo Mágico': [{ product: products['Castelo Inflável Aurora']._id, quantity: 1 }, { product: products['Painel Jardim Encantado']._id, quantity: 1 }],
    'Festa Infantil Pequeno Explorador': [{ product: products['Piscina de Bolinhas Arco-Íris']._id, quantity: 1 }, { product: products['Mesa Provençal Branca']._id, quantity: 1 }]
  };
  return Promise.all(Object.keys(kitComponents).map(function(name) {
    return Product.findByIdAndUpdate(products[name]._id, { components: kitComponents[name] });
  }));
}

function connectDatabase() {
  return mongoose.connect(mongoUri)
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
