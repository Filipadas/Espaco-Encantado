var express = require('express');
var bcrypt = require('bcryptjs');
var crypto = require('crypto');
var multer = require('multer');
var path = require('path');
var User = require('../models/User');
var SiteSettings = require('../models/SiteSettings');
var database = require('../config/database');
var business = require('../config/business');
var cepLookup = require('../utils/cep').lookupCep;
var router = express.Router();
var profileImageUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads'),
    filename: function(req, file, callback) {
      var extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      callback(null, 'avatar-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + extensions[file.mimetype]);
    }
  }),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, callback) {
    var allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    callback(allowedTypes.indexOf(file.mimetype) !== -1 ? null : new Error('Envie uma imagem JPG, PNG, WebP ou GIF.'), allowedTypes.indexOf(file.mimetype) !== -1);
  }
});

function uploadRegistrationImage(req, res, next) {
  profileImageUpload.single('profileImage')(req, res, function(error) {
    if (!error) return next();
    var message = error.code === 'LIMIT_FILE_SIZE' ? 'A foto deve ter no máximo 5 MB.' : (error.message || 'Não foi possível enviar a foto.');
    res.status(400).render('cadastro', { title: 'Criar conta', registerError: message, formData: req.body || {} });
  });
}

function safeReturnTo(value) {
  var target = String(value || '/');
  return target.charAt(0) === '/' && target.charAt(1) !== '/' ? target : '/';
}

function base64Url(value) { return Buffer.from(value).toString('base64url'); }

function renderLogin(res, status, message, returnTo) {
  var settingsQuery = database.getConnectionState() === 'conectado' ? SiteSettings.findOne({ key: 'main' }) : Promise.resolve(null);
  return Promise.resolve(settingsQuery).catch(function() { return null; }).then(function(settings) {
    res.status(status).render('entrar', { title: 'Entrar', settings: settings || {}, loginError: message, returnTo: safeReturnTo(returnTo) });
  });
}



router.get('/sair', function(req, res) {
  if (!req.session.user) return res.redirect('/');
  res.render('sair', { title: 'Sair da conta' });
});



router.get('/recuperar-senha', function(req, res) {
  res.render('recuperar-senha', { title: 'Recuperar senha', formError: null, returnTo: safeReturnTo(req.query.returnTo) });
});

router.post('/recuperar-senha/enviar', async function(req, res, next) {
  var returnTo = safeReturnTo(req.body.returnTo);
  var email = String(req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).render('recuperar-senha', { title: 'Recuperar senha', formError: 'Digite seu e-mail cadastrado.', returnTo: returnTo });
  try {
    var user = await User.findOne({ email: email });
    if (!user) return res.status(400).render('recuperar-senha', { title: 'Recuperar senha', formError: 'E-mail não encontrado.', returnTo: returnTo });
    req.session.recovery = { email: user.email, verified: false };
    res.render('recuperar-senha-codigo', { title: 'Recuperar senha', email: user.email, returnTo: returnTo, formError: null });
  } catch (error) {
    next(error);
  }
});

router.post('/recuperar-senha/codigo', function(req, res) {
  var returnTo = safeReturnTo(req.body.returnTo);
  var email = String(req.body.email || '').toLowerCase().trim();
  var code = String(req.body.code || '').trim();
  if (!req.session.recovery || req.session.recovery.email !== email) return res.status(400).render('recuperar-senha', { title: 'Recuperar senha', formError: 'Inicie a recuperação de senha novamente.', returnTo: returnTo });
  if (code !== '12345') return res.status(400).render('recuperar-senha-codigo', { title: 'Recuperar senha', email: email, returnTo: returnTo, formError: 'Código inválido.' });
  req.session.recovery.verified = true;
  res.render('recuperar-senha-nova', { title: 'Recuperar senha', email: email, returnTo: returnTo, formError: null });
});

router.post('/recuperar-senha/nova', async function(req, res, next) {
  var returnTo = safeReturnTo(req.body.returnTo);
  var email = String(req.body.email || '').toLowerCase().trim();
  var password = String(req.body.password || '');
  var confirmPassword = String(req.body.confirmPassword || '');
  if (!req.session.recovery || !req.session.recovery.verified || req.session.recovery.email !== email) return res.status(400).render('recuperar-senha', { title: 'Recuperar senha', formError: 'Inicie a recuperação de senha novamente.', returnTo: returnTo });
  if (password.length < 6) return res.status(400).render('recuperar-senha-nova', { title: 'Recuperar senha', email: email, returnTo: returnTo, formError: 'A senha deve ter pelo menos 6 caracteres.' });
  if (password !== confirmPassword) return res.status(400).render('recuperar-senha-nova', { title: 'Recuperar senha', email: email, returnTo: returnTo, formError: 'As senhas não coincidem.' });
  try {
    var hashed = bcrypt.hashSync(password, 10);
    await User.findOneAndUpdate({ email: email }, { password: hashed });
    delete req.session.recovery;
    res.redirect('/entrar' + (returnTo && returnTo !== '/' ? '?returnTo=' + encodeURIComponent(returnTo) : ''));
  } catch (error) {
    next(error);
  }
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

router.get('/cadastro/cep/:cep', async function(req, res) {
  var cep = String(req.params.cep || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(cep)) return res.status(400).json({ ok: false, message: 'Digite um CEP com 8 números.' });
  try {
    var location = await cepLookup(cep);
    if (!location) return res.status(404).json({ ok: false, message: 'CEP não encontrado.' });
    res.json({ ok: true, cep: location.cep, city: location.city, state: location.state });
  } catch (error) {
    res.status(503).json({ ok: false, message: 'Não foi possível consultar o CEP agora. Tente novamente.' });
  }
});

router.post('/cadastro', uploadRegistrationImage, async function(req, res, next) {
  try {
    var formData = { name: req.body.name, email: req.body.email, phone: req.body.phone, birthDate: req.body.birthDate, address: req.body.address, city: req.body.city, state: req.body.state, cep: req.body.cep };
    if (req.body.password !== req.body.confirmPassword) {
      return res.status(400).render('cadastro', { title: 'Criar conta', registerError: 'As senhas não coincidem.', formData: formData });
    }
    var cep = String(req.body.cep || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(cep)) return res.status(400).render('cadastro', { title: 'Criar conta', registerError: 'Informe um CEP válido com 8 números.', formData: formData });
    var location;
    try { location = await cepLookup(cep); }
    catch (error) { return res.status(503).render('cadastro', { title: 'Criar conta', registerError: 'Não foi possível consultar o CEP agora. Tente novamente.', formData: formData }); }
    if (!location) return res.status(400).render('cadastro', { title: 'Criar conta', registerError: 'CEP não encontrado. Confira o número digitado.', formData: formData });
    var password = bcrypt.hashSync(String(req.body.password || ''), 10);
    var user = await User.create({
      name: req.body.name,
      email: req.body.email,
      password: password,
      phone: req.body.phone,
      address: req.body.address,
      city: location.city,
      state: location.state,
      cep: location.cep,
      profileImage: req.file ? '/uploads/' + req.file.filename : ''
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

