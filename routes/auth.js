var express = require('express');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var SiteSettings = require('../models/SiteSettings');
var database = require('../config/database');
var router = express.Router();

function safeReturnTo(value) {
  var target = String(value || '/');
  return target.charAt(0) === '/' && target.charAt(1) !== '/' ? target : '/';
}

router.get('/sair', function(req, res) {
  if (!req.session.user) return res.redirect('/');
  res.render('sair', { title: 'Sair da conta' });
});

router.post('/entrar', async function(req, res, next) {
  var returnTo = safeReturnTo(req.body.returnTo);
  if (database.getConnectionState() !== 'conectado') {
    return res.status(503).render('entrar', {
      title: 'Entrar',
      settings: {},
      loginError: 'Não foi possível conectar ao banco de dados. Tente novamente em alguns instantes.',
      returnTo: returnTo
    });
  }
  try {
    var email = String(req.body.email || '').toLowerCase().trim();
    var user = await User.findOne({ email: email });
    if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password)) {
      return res.status(401).render('entrar', { title: 'Entrar', settings: await SiteSettings.findOne({ key: 'main' }) || {}, loginError: 'E-mail ou senha inválidos.', returnTo: returnTo });
    }
    if (req.session.user && req.session.user.id !== user._id.toString()) delete req.session.cart;
    req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role, profileImage: user.profileImage };
    res.redirect(safeReturnTo(req.body.returnTo));
  } catch (error) {
    next(error);
  }
});

router.post('/sair', function(req, res, next) {
  req.session.destroy(function(error) {
    if (error) return next(error);
    res.redirect('/');
  });
});

router.post('/cadastro', async function(req, res, next) {
  try {
    var formData = { name: req.body.name, email: req.body.email, phone: req.body.phone, birthDate: req.body.birthDate, address: req.body.address, city: req.body.city, state: req.body.state, cep: req.body.cep };
    if (req.body.password !== req.body.confirmPassword) {
      return res.status(400).render('cadastro', { title: 'Criar conta', registerError: 'As senhas não coincidem.', formData: formData });
    }
    var password = bcrypt.hashSync(String(req.body.password || ''), 10);
    var user = await User.create({
      name: req.body.name,
      email: req.body.email,
      password: password,
      phone: req.body.phone,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state,
      cep: req.body.cep
    });
    if (req.session.user && req.session.user.id !== user._id.toString()) delete req.session.cart;
    req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role, profileImage: user.profileImage };
    res.redirect('/');
  } catch (error) {
    if (error.code === 11000) return res.status(400).render('cadastro', { title: 'Criar conta', registerError: 'Este e-mail já está cadastrado.', formData: req.body });
    next(error);
  }
});

module.exports = router;

