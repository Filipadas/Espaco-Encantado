var express = require('express');
var Product = require('../models/Product');
var User = require('../models/User');
var inventory = require('../services/inventory');
var SiteSettings = require('../models/SiteSettings');
var router = express.Router();

/* GET home page. */
router.get('/', async function(req, res, next) {
  try {
    var homeProducts = await Product.find().populate('components.product').sort({ createdAt: -1 }).limit(8);
    res.render('index', { title: 'Express', homeProducts: await inventory.getProductsAvailability(homeProducts), settings: await SiteSettings.findOne({ key: 'main' }) || {} });
  } catch (error) { next(error); }
});

router.get('/catalogo', async function(req, res, next) {
  var states = {
    brinquedos: 'brinquedo',
    decoracoes: 'decoração',
    'kit-montagem': 'kit-mont',
    'festa-infantil': 'infantil'
  };
  var requestedState = String(req.query.estado || 'brinquedos');
  var selectedState = Object.prototype.hasOwnProperty.call(states, requestedState) ? requestedState : 'brinquedos';
  try {
    var products = await Product.find({ category: selectedState }).populate('components.product').sort({ name: 1 });
    res.render('catalogo', {
      title: 'Catálogo',
      selectedState: selectedState,
      selectedCategory: states[selectedState],
      products: await inventory.getProductsAvailability(products),
      favoritesOnly: false
    });
  } catch (error) { next(error); }
});

router.get('/favoritos', async function(req, res, next) {
  try {
    var products = await Product.find().populate('components.product').sort({ name: 1 });
    res.render('catalogo', {
      title: 'Favoritos',
      selectedState: 'brinquedos',
      selectedCategory: 'brinquedo',
      products: await inventory.getProductsAvailability(products),
      favoritesOnly: true
    });
  } catch (error) { next(error); }
});

router.get('/produto/:id', async function(req, res, next) {
  try {
    var product = await inventory.findProductGraph(req.params.id);
    if (!product) return res.status(404).render('error', { title: 'Produto não encontrado', message: 'Este produto não está disponível.', error: {}, status: 404 });
    product.availableUnits = inventory.availableUnits(product);
    var similarProducts = await Product.find({ category: product.category, _id: { $ne: product._id } }).limit(8);
    res.render('product-detail', { title: product.name, product: product, similarProducts: similarProducts });
  } catch (error) { next(error); }
});

router.get('/login', async function(req, res, next) {
  var returnTo = String(req.query.returnTo || '/');
  res.render('login', { title: 'Entrar', settings: await SiteSettings.findOne({ key: 'main' }) || {}, returnTo: returnTo.charAt(0) === '/' && returnTo.charAt(1) !== '/' ? returnTo : '/' });
});

router.get('/cadastro', function(req, res, next) {
  res.render('cadastro', { title: 'Criar conta' });
});

router.get('/perfil', async function(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  try { res.render('perfil', { title: 'Meu perfil', profile: await User.findById(req.session.user.id) }); } catch (error) { next(error); }
});

module.exports = router;
