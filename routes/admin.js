var express = require('express');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var Product = require('../models/Product');
var { requireAdmin } = require('../middleware/auth');
var router = express.Router();

router.use(requireAdmin);

router.get('/', function(req, res) {
  res.render('admin', { title: 'Painel administrativo' });
});

router.get('/users', async function(req, res, next) {
  try {
    res.render('admin-users', { title: 'Gerenciar usuários', users: await User.find().sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

router.post('/users/:id/role', async function(req, res, next) {
  try {
    await User.findByIdAndUpdate(req.params.id, { role: req.body.role === 'admin' ? 'admin' : 'user' });
    res.redirect('/admin/users');
  } catch (error) { next(error); }
});

router.get('/products', async function(req, res, next) {
  try {
    res.render('admin-products', { title: 'Gerenciar produtos', products: await Product.find().sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

router.get('/products/new', function(req, res) {
  res.render('admin-product-form', { title: 'Cadastrar produto', product: {}, formError: null });
});

router.post('/products', async function(req, res, next) {
  try {
    await Product.create({ name: req.body.name, category: req.body.category, price: req.body.price, description: req.body.description });
    res.redirect('/admin/products');
  } catch (error) {
    res.status(400).render('admin-product-form', { title: 'Cadastrar produto', product: req.body, formError: 'Preencha nome, categoria e preço corretamente.' });
  }
});

router.post('/products/:id/delete', async function(req, res, next) {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin/products');
  } catch (error) { next(error); }
});

module.exports = router;
