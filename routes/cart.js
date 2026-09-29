var express = require('express');
var mongoose = require('mongoose');
var Product = require('../models/Product');
var Rental = require('../models/Rental');
var inventory = require('../services/inventory');
var { requireLogin } = require('../middleware/auth');
var router = express.Router();

function wantsJson(req) {
  return req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1;
}

router.get('/', requireLogin, function(req, res) {
  res.render('sacola', {
    title: 'Minha sacola',
    cart: req.session.cart || [],
    cartError: req.session.cartError,
    rentalSuccess: req.query.sucesso === '1'
  });
  delete req.session.cartError;
});

router.post('/add', requireLogin, async function(req, res, next) {
  try {
    var product = await inventory.findProductGraph(req.body.productId);
    var available = product ? inventory.availableUnits(product) : 0;
    if (!product || available < 1) {
      if (wantsJson(req)) return res.status(409).json({ ok: false, message: 'Este produto já está sendo utilizado e não está disponível.' });
      req.session.cartError = 'Este produto já está sendo utilizado e não está disponível.';
      return res.redirect('/catalogo?estado=' + encodeURIComponent(product ? product.category : 'brinquedos'));
    }
    var cart = req.session.cart || [];
    var existing = cart.find(function(item) { return String(item.productId) === String(product._id); });
    if (existing) {
      if (existing.quantity >= available) {
        if (wantsJson(req)) return res.status(409).json({ ok: false, message: 'A quantidade solicitada não está disponível.' });
        req.session.cartError = 'A quantidade solicitada não está disponível.';
        return res.redirect('/catalogo?estado=' + encodeURIComponent(product.category));
      }
      existing.quantity += 1;
    } else {
      cart.push({ productId: product._id.toString(), name: product.name, price: product.price, imageUrl: product.imageUrl, quantity: 1 });
    }
    req.session.cart = cart;
    if (wantsJson(req)) return res.json({ ok: true, message: 'Produto adicionado à sacola.' });
    res.redirect('/sacola');
  } catch (error) { next(error); }
});

router.post('/update', requireLogin, async function(req, res, next) {
  try {
    var cart = req.session.cart || [];
    var item = cart.find(function(entry) { return String(entry.productId) === String(req.body.productId); });
    var delta = Number(req.body.delta);
    if (!item || !Number.isInteger(delta) || Math.abs(delta) !== 1) return res.redirect('/sacola');
    var product = await inventory.findProductGraph(item.productId);
    var available = product ? inventory.availableUnits(product) : 0;
    var nextQuantity = item.quantity + delta;
    if (nextQuantity > available) {
      if (wantsJson(req)) return res.status(409).json({ ok: false, message: 'Não há estoque suficiente para aumentar a quantidade.' });
      req.session.cartError = 'Não há estoque suficiente para aumentar a quantidade.';
      return res.redirect('/sacola');
    }
    if (nextQuantity <= 0) req.session.cart = cart.filter(function(entry) { return entry !== item; });
    else item.quantity = nextQuantity;
    if (wantsJson(req)) return res.json({ ok: true, message: nextQuantity <= 0 ? 'Produto removido da sacola.' : 'Quantidade atualizada.' });
    res.redirect('/sacola');
  } catch (error) { next(error); }
});

router.post('/confirm', requireLogin, async function(req, res) {
  var session = await mongoose.startSession();
  try {
    var cart = req.session.cart || [];
    if (!cart.length) {
      req.session.cartError = 'Sua sacola está vazia.';
      return res.redirect('/sacola');
    }
    var expanded = {};
    var products = [];
    for (var index = 0; index < cart.length; index += 1) {
      var item = cart[index];
      var product = await inventory.findProductGraph(item.productId);
      if (!product) throw new Error('Um produto da sacola não existe mais.');
      inventory.expandProduct(product, Number(item.quantity) || 1, expanded);
      products.push({ product: product._id, name: product.name, quantity: item.quantity, price: product.price });
    }
    session.startTransaction();
    var componentIds = Object.keys(expanded);
    var componentProducts = await Product.find({ _id: { $in: componentIds } }).session(session);
    for (var componentIndex = 0; componentIndex < componentProducts.length; componentIndex += 1) {
      var component = componentProducts[componentIndex];
      var quantity = expanded[String(component._id)];
      var available = (Number(component.stockTotal) || 0) - (Number(component.rentedQuantity) || 0);
      if (available < quantity) throw new Error('Um dos produtos escolhidos já está sendo utilizado.');
      var update = await Product.updateOne({ _id: component._id, $expr: { $gte: [{ $subtract: [{ $ifNull: ['$stockTotal', 0] }, { $ifNull: ['$rentedQuantity', 0] }] }, quantity] } }, { $inc: { rentedQuantity: quantity } }).session(session);
      if (!update.modifiedCount) throw new Error('O estoque mudou enquanto o aluguel era confirmado.');
    }
    if (componentProducts.length !== componentIds.length) throw new Error('Um componente do kit não foi encontrado.');
    await Rental.create([{ user: req.session.user.id, items: products, reservedComponents: componentIds.map(function(id) { return { product: id, quantity: expanded[id] }; }) }], { session: session });
    await session.commitTransaction();
    req.session.cart = [];
    res.redirect('/sacola?sucesso=1');
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    req.session.cartError = error.message;
    res.redirect('/sacola');
  } finally {
    session.endSession();
  }
});

router.post('/clear', requireLogin, function(req, res) {
  req.session.cart = [];
  res.redirect('/sacola');
});

module.exports = router;
