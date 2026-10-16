var express = require('express');
var mongoose = require('mongoose');
var Product = require('../models/Product');
var Rental = require('../models/Rental');
var receipts = require('../services/receipts');
var User = require('../models/User');
var inventory = require('../services/inventory');
var { requireLogin } = require('../middleware/auth');
var business = require('../config/business');
var router = express.Router();

function isValidCalendarDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function listAvailableDates(unavailable) {
  var dates = [];
  for (var day = 0; day < 60 && dates.length < 30; day += 1) {
    var date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + day);
    var value = date.toISOString().slice(0, 10);
    if (unavailable.indexOf(value) === -1) dates.push(value);
  }
  return dates;
}

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
    var deliveryProfile = await User.findById(req.session.user.id).select('name phone address city state cep addresses');
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
      item.availableDates = listAvailableDates(unavailable);
      if (!item.requestDate || item.availableDates.indexOf(item.requestDate) === -1) item.requestDate = item.availableDates[0];
    });
  res.render('sacola', {
    title: 'Minha sacola',
    cart: cart,
    deliveryProfile: deliveryProfile || {},
    whatsappNumber: req.app.locals.whatsappNumber || res.locals.whatsappNumber,
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

router.post('/adicionar', requireLogin, function(req, res, next) {
  addToCart(req, res, next, false);
});

router.post('/adicionar-do-produto', requireLogin, function(req, res, next) {
  addToCart(req, res, next, true);
});

router.post('/ajustar', requireLogin, async function(req, res, next) {
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

router.post('/data', requireLogin, async function(req, res, next) {
  try {
    var cart = await getUserCart(req);
    var item = cart.find(function(entry) { return String(entry.productId) === String(req.body.productId); });
    if (!item) return res.redirect('/sacola');
    var activeRentals = await Rental.find({ status: 'active' }).select('dates items reservedComponents');
    var unavailable = [];
    activeRentals.forEach(function(rental) {
      var dates = rental.dates || [];
      (rental.items || []).forEach(function(rentalItem) {
        if (String(rentalItem.product) === String(item.productId)) unavailable = unavailable.concat(dates);
      });
      (rental.reservedComponents || []).forEach(function(component) {
        if (String(component.product) === String(item.productId)) unavailable = unavailable.concat(dates);
      });
    });
    var requestedDate = String(req.body.date || '');
    if (listAvailableDates(unavailable).indexOf(requestedDate) === -1) {
      req.session.cartError = 'Escolha uma data disponível para este produto.';
      return res.redirect('/sacola');
    }
    item.requestDate = requestedDate;
    await saveUserCart(req, cart);
    res.redirect('/sacola');
  } catch (error) { next(error); }
});

router.post('/solicitar', requireLogin, async function(req, res) {
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
    var salonRental = req.body.salonRental === 'on';
    var salonDate = String(req.body.salonDate || '').trim();
    var salonTime = String(req.body.salonTime || '').trim();
    if (!deliveryAddress || !deliveryCity || !/^[A-Z]{2}$/.test(deliveryState) || !deliveryCep || !isValidCalendarDate(deliveryDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)) {
      req.session.cartError = 'Informe o endereço, CEP, cidade, estado, data e horário previstos para a entrega.';
      return res.redirect('/sacola');
    }
    if (salonRental && (!isValidCalendarDate(salonDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(salonTime))) {
      req.session.cartError = 'Informe a data e o horário do aluguel do salão.';
      return res.redirect('/sacola');
    }
    var expanded = {};
    var products = [];
    var activeRentals = await Rental.find({ status: 'active' }).select('dates items reservedComponents');
    var unavailableDates = {};
    activeRentals.forEach(function(rental) {
      var dates = rental.dates || [];
      (rental.items || []).forEach(function(rentalItem) {
        unavailableDates[String(rentalItem.product)] = (unavailableDates[String(rentalItem.product)] || []).concat(dates);
      });
      (rental.reservedComponents || []).forEach(function(component) {
        unavailableDates[String(component.product)] = (unavailableDates[String(component.product)] || []).concat(dates);
      });
    });
    for (var index = 0; index < cart.length; index += 1) {
      var item = cart[index];
      var quantity = Number(item.quantity);
      var product = await inventory.findProductGraph(item.productId);
      if (!product) throw new Error('Um produto da sacola não existe mais.');
      if (!Number.isInteger(quantity) || quantity < 1 || !isValidCalendarDate(item.requestDate)) throw new Error('Confira a quantidade e a data de cada produto da solicitação.');
      if (listAvailableDates(unavailableDates[String(item.productId)] || []).indexOf(item.requestDate) === -1) throw new Error('A data escolhida para ' + product.name + ' não está mais disponível. Escolha outra data.');
      if (inventory.availableUnits(product) < quantity) throw new Error('A quantidade solicitada de ' + product.name + ' não está disponível no estoque.');
      inventory.expandProduct(product, quantity, expanded);
      products.push({ product: product._id, name: product.name, quantity: quantity, price: product.price, date: item.requestDate });
    }
    var componentIds = Object.keys(expanded);
    var componentProducts = await Product.find({ _id: { $in: componentIds } });
    if (componentProducts.length !== componentIds.length) throw new Error('Um componente do kit não foi encontrado.');
    for (var componentIndex = 0; componentIndex < componentProducts.length; componentIndex += 1) {
      var component = componentProducts[componentIndex];
      if ((Number(component.stockTotal) || 0) - (Number(component.rentedQuantity) || 0) < expanded[String(component._id)]) throw new Error('Um dos produtos escolhidos já está sendo utilizado.');
    }
    var dates = products.map(function(item) { return item.date; }).filter(function(date, index, allDates) { return allDates.indexOf(date) === index; });
    var customer = await User.findById(req.session.user.id).select('name phone');
    await Rental.create({ user: req.session.user.id, items: products, dates: dates, deliveryAddress: deliveryAddress, deliveryCity: deliveryCity, deliveryState: deliveryState, deliveryCep: deliveryCep, deliveryDate: deliveryDate, deliveryTime: deliveryTime, salonRental: salonRental, salonDate: salonRental ? salonDate : undefined, salonTime: salonRental ? salonTime : undefined, reservedComponents: componentIds.map(function(id) { return { product: id, quantity: expanded[id] }; }), status: 'analysis' });
    var lines = [
      'Olá! Gostaria de enviar uma solicitação para a Espaço Encantado.',
      '', '*DADOS DO CLIENTE*',
      'Nome: ' + (customer && customer.name || req.session.user.name || ''),
      customer && customer.phone ? 'Telefone: ' + customer.phone : null,
      'Data da solicitação: ' + new Date().toLocaleDateString('pt-BR'),
      '', '*ITENS SOLICITADOS*'
    ].filter(function(line) { return line !== null; });
    var total = 0;
    products.forEach(function(item, itemIndex) {
      var subtotal = item.price * item.quantity;
      total += subtotal;
      lines.push((itemIndex + 1) + '. ' + item.name, '   Quantidade: ' + item.quantity, '   Data de utilização: ' + item.date.split('-').reverse().join('/'), '   Valor unitário: R$ ' + item.price.toFixed(2).replace('.', ','), '   Subtotal: R$ ' + subtotal.toFixed(2).replace('.', ','));
    });
    lines.push('', 'Total estimado: R$ ' + total.toFixed(2).replace('.', ','), '', '*ENTREGA*', 'Endereço: ' + deliveryAddress, 'Cidade: ' + deliveryCity + ' - ' + deliveryState, 'CEP: ' + deliveryCep, 'Data prevista: ' + deliveryDate.split('-').reverse().join('/'), 'Horário previsto: ' + deliveryTime);
    if (salonRental) lines.push('', '*ALUGUEL DO SALÃO*', 'Sim, desejo alugar o salão.', 'Data do evento: ' + salonDate.split('-').reverse().join('/'), 'Horário: ' + salonTime);
    lines.push('', 'Gostaria de confirmar a disponibilidade dos itens e, se aplicável, do salão, além dos valores e das condições da solicitação.', '', 'Aguardo o retorno. Obrigado(a)!');
    var whatsappUrl = 'https://wa.me/' + business.whatsappNumber + '?text=' + encodeURIComponent(lines.join('\n'));
    res.redirect(whatsappUrl);
  } catch (error) {
    req.session.cartError = error.message || 'Não foi possível registrar a solicitação.';
    res.redirect('/sacola');
  }
});

router.post('/confirmar', requireLogin, async function(req, res) {
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
    await Rental.create([{ user: req.session.user.id, items: products, dates: products.map(function(item) { return item.date; }).filter(function(date, index, dates) { return dates.indexOf(date) === index; }), deliveryAddress: deliveryAddress, deliveryCity: deliveryCity, deliveryState: deliveryState, deliveryCep: deliveryCep, deliveryDate: deliveryDate, deliveryTime: deliveryTime, salonRental: req.body.salonRental === 'on', salonDate: req.body.salonDate, salonTime: req.body.salonTime, reservedComponents: componentIds.map(function(id) { return { product: id, quantity: expanded[id] }; }), status: 'analysis' }], { session: session });
    await session.commitTransaction();
    res.redirect('/sacola?sucesso=1');
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    req.session.cartError = error.message;
    res.redirect('/sacola');
  } finally {
    session.endSession();
  }
});

router.post('/limpar', requireLogin, async function(req, res, next) {
  try {
    await saveUserCart(req, []);
    res.redirect('/sacola');
  } catch (error) { next(error); }
});

async function showCustomerReceipt(req, res, next) {
  try {
    var rental = await Rental.findOne({ _id: req.params.id, user: req.session.user.id }).populate('user');
    if (!rental) return res.status(404).render('erro', { title: 'Comprovante não encontrado', message: 'Este comprovante não está disponível para sua conta.', error: {}, status: 404 });
    var viewData = await receipts.getReceiptViewData(rental);
    viewData.isAdminView = false;
    res.render('comprovante', viewData);
  } catch (error) { next(error); }
}

router.get('/nota/:id', requireLogin, showCustomerReceipt);
router.get('/comprovante/:id', requireLogin, showCustomerReceipt);

router.get('/historico', requireLogin, async function(req, res, next) {
  try {
    res.render('sacola-historico', { title: 'Histórico de solicitações', rentals: await Rental.find({ user: req.session.user.id }).sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

module.exports = router;
