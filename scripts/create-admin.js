require('dotenv').config();

var bcrypt = require('bcryptjs');
var mongoose = require('mongoose');
var readline = require('readline');
var User = require('../models/User');
var database = require('../config/database');

function ask(question) {
  var terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(function(resolve) {
    terminal.question(question, function(answer) {
      terminal.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question) {
  return new Promise(function(resolve, reject) {
    var input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      return reject(new Error('Execute este comando em um terminal interativo para digitar a senha com segurança.'));
    }

    var answer = '';
    process.stdout.write(question);
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();

    function finish(error) {
      input.setRawMode(false);
      input.pause();
      input.removeListener('keypress', onKeypress);
      process.stdout.write('\n');
      if (error) return reject(error);
      resolve(answer);
    }

    function onKeypress(character, key) {
      if (key && (key.name === 'return' || key.name === 'enter')) return finish();
      if (key && key.ctrl && key.name === 'c') return finish(new Error('Operação cancelada.'));
      if (key && key.name === 'backspace') {
        answer = answer.slice(0, -1);
        return;
      }
      if (character && !key.ctrl && !key.meta) answer += character;
    }

    input.on('keypress', onKeypress);
  });
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error('Configure MONGO_URI no ambiente do servidor antes de executar este comando.');

  var name = await ask('Nome do administrador: ');
  var email = (await ask('E-mail do administrador: ')).toLowerCase();
  var password = await askSecret('Senha (mínimo 12 caracteres): ');
  var confirmation = await askSecret('Confirme a senha: ');

  if (!name || !email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um nome e um e-mail válido.');
  if (password.length < 12) throw new Error('A senha precisa ter pelo menos 12 caracteres.');
  if (password !== confirmation) throw new Error('As senhas não coincidem.');

  await mongoose.connect(await database.getMongoConnectionUri(), { serverSelectionTimeoutMS: 10000 });
  var user = await User.findOne({ email: email });
  if (!user) user = new User({ name: name, email: email });
  user.name = name;
  user.password = bcrypt.hashSync(password, 12);
  user.role = 'admin';
  await user.save();
  console.log('Conta administrativa salva no MongoDB.');
}

main().catch(function(error) {
  console.error('Não foi possível criar a conta administrativa:', error.message);
  process.exitCode = 1;
}).finally(function() {
  if (mongoose.connection.readyState !== 0) mongoose.disconnect();
});
