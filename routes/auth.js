var express = require('express');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var router = express.Router();

router.post('/login', async function(req, res, next) {
  try {
    var email = String(req.body.email || '').toLowerCase().trim();
    var user = await User.findOne({ email: email });
    if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password)) {
      return res.status(401).render('login', { title: 'Entrar', loginError: 'E-mail ou senha inválidos.' });
    }
    req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

router.post('/logout', function(req, res, next) {
  req.session.destroy(function(error) {
    if (error) return next(error);
    res.redirect('/');
  });
});

router.post('/register', async function(req, res, next) {
  try {
    if (req.body.password !== req.body.confirmPassword) {
      return res.status(400).render('cadastro', { title: 'Criar conta', registerError: 'As senhas não coincidem.' });
    }
    var password = bcrypt.hashSync(String(req.body.password || ''), 10);
    var user = await User.create({
      name: req.body.name,
      email: req.body.email,
      password: password,
      phone: req.body.phone,
      address: req.body.address,
      city: req.body.city,
      state: req.body.state
    });
    req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
    res.redirect('/');
  } catch (error) {
    if (error.code === 11000) return res.status(400).render('cadastro', { title: 'Criar conta', registerError: 'Este e-mail já está cadastrado.' });
    next(error);
  }
});

module.exports = router;
