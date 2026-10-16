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

function oauthRedirectUri(req, provider) {
  var configured = process.env[provider.toUpperCase() + '_REDIRECT_URI'];
  return configured || req.protocol + '://' + req.get('host') + '/auth/' + provider + '/callback';
}

function beginOAuth(req, res, provider) {
  var state = crypto.randomBytes(32).toString('hex');
  var nonce = crypto.randomBytes(32).toString('hex');
  req.session.oauth = { provider: provider, state: state, nonce: nonce, returnTo: safeReturnTo(req.query.returnTo) };
  var params = new URLSearchParams({
    client_id: process.env[provider.toUpperCase() + '_CLIENT_ID'] || '',
    redirect_uri: oauthRedirectUri(req, provider),
    response_type: provider === 'apple' ? 'code id_token' : 'code',
    scope: provider === 'google' ? 'openid email profile' : 'email',
    state: state
  });
  if (provider === 'google') params.set('nonce', nonce);
  if (provider === 'apple') {
    params.set('response_mode', 'form_post');
    params.set('nonce', crypto.createHash('sha256').update(nonce).digest('hex'));
  }
  var authorizeUrl = provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth?' : 'https://appleid.apple.com/auth/authorize?';
  res.redirect(authorizeUrl + params.toString());
}

function appleClientSecret() {
  var teamId = process.env.APPLE_TEAM_ID;
  var keyId = process.env.APPLE_KEY_ID;
  var clientId = process.env.APPLE_CLIENT_ID;
  var privateKey = String(process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  var now = Math.floor(Date.now() / 1000);
  var header = base64Url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  var claims = base64Url(JSON.stringify({ iss: teamId, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: clientId }));
  var signingInput = header + '.' + claims;
  var signature = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return signingInput + '.' + signature;
}

async function verifyAppleIdentityToken(token, expectedNonce) {
  var parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Resposta de identidade da Apple inválida.');
  var header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  var claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || !header.kid || claims.iss !== 'https://appleid.apple.com' || claims.aud !== process.env.APPLE_CLIENT_ID || Number(claims.exp) <= Math.floor(Date.now() / 1000)) throw new Error('Não foi possível validar a conta Apple.');
  var keysResponse = await fetch('https://appleid.apple.com/auth/keys');
  if (!keysResponse.ok) throw new Error('Não foi possível validar a conta Apple.');
  var keys = await keysResponse.json();
  var jwk = (keys.keys || []).find(function(key) { return key.kid === header.kid && key.kty === 'RSA'; });
  if (!jwk) throw new Error('Chave de validação da Apple não encontrada.');
  var valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  var expectedAppleNonce = crypto.createHash('sha256').update(expectedNonce).digest('hex');
  if (!valid || claims.nonce !== expectedAppleNonce || !claims.sub || (claims.email && claims.email_verified !== true && claims.email_verified !== 'true')) throw new Error('Não foi possível validar a conta Apple.');
  return claims;
}

async function verifyGoogleIdentityToken(token, expectedNonce) {
  var parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Resposta de identidade do Google inválida.');
  var header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  var claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  var audience = claims.aud;
  if (header.alg !== 'RS256' || !header.kid || (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') || !(Array.isArray(audience) ? audience.indexOf(process.env.GOOGLE_CLIENT_ID) !== -1 : audience === process.env.GOOGLE_CLIENT_ID) || Number(claims.exp) <= Math.floor(Date.now() / 1000)) throw new Error('Não foi possível validar a conta Google.');
  var keysResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!keysResponse.ok) throw new Error('Não foi possível validar a conta Google.');
  var keys = await keysResponse.json();
  var jwk = (keys.keys || []).find(function(key) { return key.kid === header.kid && key.kty === 'RSA'; });
  if (!jwk) throw new Error('Chave de validação do Google não encontrada.');
  var valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!valid || claims.nonce !== expectedNonce || !claims.sub || claims.email_verified !== true) throw new Error('Não foi possível validar o perfil do Google.');
  return { id: claims.sub, email: claims.email, name: claims.name, picture: claims.picture };
}

async function finishSocialLogin(req, res, provider, identity) {
  var providerField = provider === 'google' ? 'googleId' : 'appleId';
  var email = String(identity.email || '').toLowerCase().trim();
  var user = await User.findOne({ [providerField]: identity.id });
  if (!user && email) {
    user = await User.findOne({ email: email });
    if (user) {
      user[providerField] = identity.id;
      await user.save();
    }
  }
  if (!user) {
    if (!email) throw new Error('O provedor não compartilhou um e-mail. Autorize o compartilhamento e tente novamente.');
    user = await User.create({
      name: identity.name || email.split('@')[0],
      email: email,
      password: bcrypt.hashSync(crypto.randomBytes(48).toString('hex'), 10),
      [providerField]: identity.id,
      profileImage: identity.picture || ''
    });
  }
  var oldUserId = req.session.user && req.session.user.id;
  var savedCart = oldUserId === String(user._id) ? req.session.cart : null;
  var destination = safeReturnTo(req.session.oauth.returnTo);
  await new Promise(function(resolve, reject) {
    req.session.regenerate(function(error) { if (error) return reject(error); resolve(); });
  });
  req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role, profileImage: user.profileImage };
  if (savedCart) req.session.cart = savedCart;
  res.redirect(destination);
}

async function completeOAuth(req, res, provider) {
  var oauth = req.session.oauth;
  var callbackData = provider === 'apple' ? req.body : req.query;
  var returnedState = callbackData.state;
  if (!oauth || oauth.provider !== provider || !returnedState || returnedState !== oauth.state) throw new Error('A validação do login expirou. Tente novamente.');
  if (callbackData.error) throw new Error('O login foi cancelado ou não foi autorizado.');
  if (!callbackData.code) throw new Error('O provedor não retornou o código de acesso.');
  var params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: callbackData.code,
    redirect_uri: oauthRedirectUri(req, provider),
    client_id: process.env[provider.toUpperCase() + '_CLIENT_ID'] || '',
    client_secret: provider === 'google' ? process.env.GOOGLE_CLIENT_SECRET || '' : appleClientSecret()
  });
  var tokenResponse = await fetch(provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://appleid.apple.com/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
  });
  var tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.access_token) throw new Error('Não foi possível concluir o login com ' + (provider === 'google' ? 'Google.' : 'Apple.'));
  var identity;
  if (provider === 'google') {
    identity = await verifyGoogleIdentityToken(tokens.id_token, oauth.nonce);
  } else {
    var apple = await verifyAppleIdentityToken(tokens.id_token || callbackData.id_token, oauth.nonce);
    var appleUser = callbackData.user ? JSON.parse(callbackData.user) : {};
    var appleName = appleUser.name ? [appleUser.name.firstName, appleUser.name.lastName].filter(Boolean).join(' ') : '';
    identity = { id: apple.sub, email: apple.email || appleUser.email, name: appleName };
  }
  await finishSocialLogin(req, res, provider, identity);
}

router.get('/sair', function(req, res) {
  if (!req.session.user) return res.redirect('/');
  res.render('sair', { title: 'Sair da conta' });
});

router.get('/auth/google', function(req, res, next) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return renderLogin(res, 503, 'Login Google ainda não configurado. Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no ambiente.', req.query.returnTo).catch(next);
  beginOAuth(req, res, 'google');
});

router.get('/auth/google/callback', async function(req, res) {
  try {
    if (database.getConnectionState() !== 'conectado') throw new Error('O banco de dados está indisponível. Tente novamente em instantes.');
    await completeOAuth(req, res, 'google');
  } catch (error) {
    delete req.session.oauth;
    await renderLogin(res, 400, error.message || 'Não foi possível entrar com Google.', '/');
  }
});

router.get('/auth/apple', function(req, res, next) {
  if (!process.env.APPLE_CLIENT_ID || !process.env.APPLE_TEAM_ID || !process.env.APPLE_KEY_ID || !process.env.APPLE_PRIVATE_KEY || !process.env.APPLE_REDIRECT_URI) return renderLogin(res, 503, 'Login Apple ainda não configurado. Configure as credenciais do Sign in with Apple e um callback HTTPS em domínio registrado.', req.query.returnTo).catch(next);
  beginOAuth(req, res, 'apple');
});

router.post('/auth/apple/callback', async function(req, res) {
  try {
    if (database.getConnectionState() !== 'conectado') throw new Error('O banco de dados está indisponível. Tente novamente em instantes.');
    await completeOAuth(req, res, 'apple');
  } catch (error) {
    delete req.session.oauth;
    await renderLogin(res, 400, error.message || 'Não foi possível entrar com Apple.', '/');
  }
});

router.get('/recuperar-senha', function(req, res) {
  res.render('recuperar-senha', { title: 'Recuperar senha', formError: null, returnTo: safeReturnTo(req.query.returnTo) });
});

router.post('/recuperar-senha', function(req, res) {
  var contact = String(req.body.contact || '').trim();
  if (!contact) return res.status(400).render('recuperar-senha', { title: 'Recuperar senha', formError: 'Digite o e-mail ou telefone cadastrado.', returnTo: safeReturnTo(req.body.returnTo) });
  var message = 'Olá! Preciso de ajuda para recuperar o acesso à minha conta Espaço Encantado. Meu e-mail ou telefone cadastrado é: ' + contact;
  var whatsappUrl = 'https://wa.me/' + business.whatsappNumber + '?text=' + encodeURIComponent(message);
  res.redirect(whatsappUrl);
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

