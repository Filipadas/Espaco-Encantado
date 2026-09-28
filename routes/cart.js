var express = require('express');
var router = express.Router();
var { requireLogin } = require('../middleware/auth');

router.get('/', requireLogin, function(req, res) {
  res.render('sacola', { title: 'Minha sacola', cart: req.session.cart || [] });
});

router.post('/add', requireLogin, function(req, res) {
  var cart = req.session.cart || [];
  cart.push({ name: req.body.name, price: Number(req.body.price) || 0 });
  req.session.cart = cart;
  res.redirect('/sacola');
});

router.post('/clear', requireLogin, function(req, res) {
  req.session.cart = [];
  res.redirect('/sacola');
});

module.exports = router;
