var mongoose = require('mongoose');
var bcrypt = require('bcryptjs');
var User = require('../models/User');

var mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/espaco_encantado';

function connectDatabase() {
  return mongoose.connect(mongoUri)
    .then(function() {
      console.log('MongoDB conectado');
      return User.findOneAndUpdate(
        { email: 'admin@espacoencantado.com' },
        {
          name: 'Administrador',
          email: 'admin@espacoencantado.com',
          password: bcrypt.hashSync('admin123', 10),
          role: 'admin'
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
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
