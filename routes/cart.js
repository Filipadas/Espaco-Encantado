var express = require('express');
var mongoose = require('mongoose');
var Product = require('../models/Product');
var Rental = require('../models/Rental');
var User = require('../models/User');
var inventory = require('../services/inventory');
var { requireLogin } = require('../middleware/auth');
var router = express.Router();

async function getUserCart(req) {
  var user = await User.findById(req.session.user.id).select('cart');
  var hasSessionCart = Array.isArray(req.session.cart);
  var cart = Array.isArray(req.session.cart)
    ? req.session.cart
    : (user && Array.isArray(user.cart) ? user.cart.map(function(item) {
      return {
        productId: item.productId,
        name: item.name,
        price: item.price,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        requestDate: item.requestDate || ''
      };
    }) : []);
  req.session.cart = cart;
  if (hasSessionCart) await saveUserCart(req, cart);
  return cart;
}

async function saveUserCart(req, cart) {
  req.session.cart = cart;
  await User.updateOne({ _id: req.session.user.id }, { $set: { cart: cart.map(function(item) {
    return {
      productId: String(item.productId),
      name: item.name,
      price: Number(item.price) || 0,
      imageUrl: item.imageUrl || '',
      quantity: Math.max(1, Number(item.quantity) || 1),
      requestDate: item.requestDate || ''
    };
  }) } });
}

router.get('/', requireLogin, async function(req, res, next) {
  try {
    var deliveryProfile = await User.findById(req.session.user.id).select('address city state cep addresses');
    var cart = await getUserCart(req);
    var activeRentals = await Rental.find({ status: 'active' }).select('dates items reservedComponents');
    var blocked = {};
    activeRentals.forEach(function(rental) {
      var dates = rental.dates || [];
      (rental.items || []).forEach(function(item) {
        blocked[String(item.product)] = (blocked[String(item.product)] || []).concat(dates);
      });
      (rental.reservedComponents || []).forEach(function(component) {
        blocked[String(component.product)] = (blocked[String(component.product)] || []).concat(dates);
      });
    });
    cart.forEach(function(item) {
      var unavailable = blocked[String(item.productId)] || [];
      item.availableDates = [];
      for (var day = 0; day < 60 && item.availableDates.length < 30; day += 1) {
        var date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + day);
        var value = date.toISOString().slice(0, 10);
        if (unavailable.indexOf(value) === -1) item.availableDates.push(value);
      }
      if (!item.requestDate || item.availableDates.indexOf(item.requestDate) === -1) item.requestDate = item.availableDates[0];
    });
  res.render('sacola', {
    title: 'Minha sacola',
    cart: cart,
    deliveryProfile: deliveryProfile || {},
    cartError: req.session.cartError,
    rentalSuccess: req.query.sucesso === '1'
  });
  } catch (error) { next(error); }
  delete req.session.cartError;
});

async function addToCart(req, res, next, fromProductPage) {
  try {
    var wantsJson = !fromProductPage && req.get('X-Cart-Request') === 'json';
    var product = await inventory.findProductGraph(req.body.productId);
    var available = product ? inventory.availableUnits(product) : 0;
    if (!product) {
      if (wantsJson) return res.status(404).json({ ok: false, message: 'Produto não encontrado.' });
      req.session.cartError = 'Este produto não foi encontrado.';
      return res.redirect(fromProductPage ? '/sacola' : '/catalogo');
    }
    if (available < 1) {
      if (wantsJson) return res.status(409).json({ ok: false, available: available, message: 'Este produto não está disponível no estoque.' });
      req.session.cartError = 'Este produto já está sendo utilizado e não está disponível.';
      return res.redirect(fromProductPage ? '/sacola' : '/catalogo?estado=' + encodeURIComponent(product.category));
    }
    var cart = await getUserCart(req);
    var existing = cart.find(function(item) { return String(item.productId) === String(product._id); });
    if (existing) {
      existing.quantity = Math.max(0, Number(existing.quantity) || 0);
      if (existing.quantity >= available) {
        if (wantsJson) return res.json({ ok: true, available: available, inCart: existing.quantity, message: 'Este produto já está na sua sacola na quantidade máxima disponível.' });
        req.session.cartError = 'A quantidade solicitada não está disponível.';
        return res.redirect(fromProductPage ? '/sacola' : '/catalogo?estado=' + encodeURIComponent(product.category));
      }
      existing.quantity += 1;
    } else {
      cart.push({ productId: product._id.toString(), name: product.name, price: product.price, imageUrl: product.imageUrl, quantity: 1, requestDate: '' });
    }
    await saveUserCart(req, cart);
    if (wantsJson) return res.json({ ok: true, available: available, inCart: existing ? existing.quantity : 1, message: 'Produto adicionado à sacola.' });
    res.redirect('/sacola');
  } catch (error) { next(error); }
}

router.post('/add', requireLogin, function(req, res, next) {
  addToCart(req, res, next, false);
});

router.post('/add-from-product', requireLogin, function(req, res, next) {
  addToCart(req, res, next, true);
});

router.post('/adjust', requireLogin, async function(req, res, next) {
  try {
    var delta = Number(req.body.delta);
    var cart = await getUserCart(req);
    var item = cart.find(function(entry) { return String(entry.productId) === String(req.body.productId); });
    if (!item || !Number.isInteger(delta) || !delta) return res.redirect('/sacola');
    if (delta > 0) {
      var product = await inventory.findProductGraph(item.productId);
      if (!product || item.quantity >= inventory.availableUnits(product)) {
        req.session.cartError = 'Não há estoque disponível para adicionar outra unidade.';
        return res.redirect('/sacola');
      }
    }
    item.quantity += delta;
    if (item.quantity <= 0) cart = cart.filter(function(entry) { return entry !== item; });
    await saveUserCart(req, cart);
    res.redirect('/sacola');
  } catch (error) { next(error); }
});

router.post('/date', requireLogin, async function(req, res, next) {
  try {
    var cart = await getUserCart(req);
    var item = cart.find(function(entry) { return String(entry.productId) === String(req.body.productId); });
    if (item) {
      item.requestDate = req.body.date;
      await saveUserCart(req, cart);
    }
    res.redirect('/sacola');
  } catch (error) { next(error); }
});

router.post('/confirm', requireLogin, async function(req, res) {
  var session = await mongoose.startSession();
  try {
    var cart = await getUserCart(req);
    if (!cart.length) {
      req.session.cartError = 'Sua sacola está vazia.';
      return res.redirect('/sacola');
    }
    var deliveryAddress = String(req.body.deliveryAddress || '').trim();
    var deliveryCity = String(req.body.deliveryCity || '').trim();
    var deliveryState = String(req.body.deliveryState || '').trim().toUpperCase();
    var deliveryCep = String(req.body.deliveryCep || '').trim();
    var deliveryDate = String(req.body.deliveryDate || '').trim();
    var deliveryTime = String(req.body.deliveryTime || '').trim();
    if (!deliveryAddress || !deliveryCity || !/^[A-Z]{2}$/.test(deliveryState) || !deliveryCep || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !/^\d{2}:\d{2}$/.test(deliveryTime)) {
      req.session.cartError = 'Informe o endereço completo, CEP, data e horário previstos para a entrega.';
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
      if (!item.requestDate) throw new Error('Escolha uma data para cada produto da solicitação.');
      products[products.length - 1].date = item.requestDate;
    }
    session.startTransaction();
    var componentIds = Object.keys(expanded);
    var componentProducts = await Product.find({ _id: { $in: componentIds } }).session(session);
    for (var componentIndex = 0; componentIndex < componentProducts.length; componentIndex += 1) {
      var component = componentProducts[componentIndex];
      var quantity = expanded[String(component._id)];
      var available = (Number(component.stockTotal) || 0) - (Number(component.rentedQuantity) || 0);
      if (available < quantity) throw new Error('Um dos produtos escolhidos já está sendo utilizado.');
    }
    if (componentProducts.length !== componentIds.length) throw new Error('Um componente do kit não foi encontrado.');
    await Rental.create([{ user: req.session.user.id, items: products, dates: products.map(function(item) { return item.date; }).filter(function(date, index, dates) { return dates.indexOf(date) === index; }), deliveryAddress: deliveryAddress, deliveryCity: deliveryCity, deliveryState: deliveryState, deliveryCep: deliveryCep, deliveryDate: deliveryDate, deliveryTime: deliveryTime, salonRental: req.body.salonRental === 'on', salonDate: req.body.salonDate, salonTime: req.body.salonTime, reservedComponents: componentIds.map(function(id) { return { product: id, quantity: expanded[id] }; }) }], { session: session });
    await User.updateOne({ _id: req.session.user.id }, { $set: { cart: [] } }).session(session);
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

router.post('/clear', requireLogin, async function(req, res, next) {
  try {
    await saveUserCart(req, []);
    res.redirect('/sacola');
  } catch (error) { next(error); }
});

async function showCustomerReceipt(req, res, next) {
  try {
    var rental = await Rental.findOne({ _id: req.params.id, user: req.session.user.id }).populate('user');
    if (!rental) return res.status(404).render('error', { title: 'Comprovante não encontrado', message: 'Este comprovante não está disponível para sua conta.', error: {}, status: 404 });
    if (!rental.invoiceGenerated || !rental.invoiceNumber || !rental.invoiceGeneratedAt) {
      rental.invoiceGenerated = true;
      rental.invoiceNumber = rental.invoiceNumber || 'EE-' + new Date().getFullYear() + '-' + String(rental._id).slice(-8).toUpperCase();
      rental.invoiceGeneratedAt = rental.invoiceGeneratedAt || new Date();
      await rental.save();
    }
    var invoiceTotal = rental.items.reduce(function(total, item) { return total + Number(item.price) * Number(item.quantity); }, 0);
    res.render('invoice', { title: 'Comprovante de locação', rental: rental, invoiceTotal: invoiceTotal, invoiceDate: (rental.invoiceGeneratedAt || rental.createdAt).toLocaleDateString('pt-BR'), isAdminView: false });
  } catch (error) { next(error); }
}

router.get('/nota/:id', requireLogin, showCustomerReceipt);
router.get('/comprovante/:id', requireLogin, showCustomerReceipt);

router.get('/historico', requireLogin, async function(req, res, next) {
  try {
    res.render('rental-history', { title: 'Histórico de solicitações', rentals: await Rental.find({ user: req.session.user.id }).sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

module.exports = router;
