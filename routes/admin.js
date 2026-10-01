var express = require('express');
var multer = require('multer');
var path = require('path');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var Product = require('../models/Product');
var Rental = require('../models/Rental');
var Meeting = require('../models/Meeting');
var SiteSettings = require('../models/SiteSettings');
var inventory = require('../services/inventory');
var { requireAdmin } = require('../middleware/auth');
var router = express.Router();
var upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads'),
    filename: function(req, file, callback) {
      callback(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase());
    }
  }),
  limits: { files: 10, fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, callback) {
    callback(null, file.mimetype.indexOf('image/') === 0);
  }
});

router.use(requireAdmin);

router.get('/', function(req, res) {
  res.render('admin', { title: 'Painel administrativo' });
});

router.get('/users', async function(req, res, next) {
  try {
    res.render('admin-users', { title: 'Gerenciar usuários', users: await User.find().sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

router.get('/products', async function(req, res, next) {
  try {
    var products = await Product.find().populate('components.product').sort({ createdAt: -1 });
    res.render('admin-products', { title: 'Gerenciar produtos', products: await inventory.getProductsAvailability(products) });
  } catch (error) { next(error); }
});

router.get('/products/new', async function(req, res, next) {
  try {
    res.render('admin-product-form', { title: 'Cadastrar produto', product: {}, formError: null, isEditing: false, availableProducts: await Product.find({ $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  } catch (error) { next(error); }
});

router.get('/products/:id/edit', async function(req, res, next) {
  try {
    var product = await Product.findById(req.params.id);
    if (!product) return res.status(404).render('error', { title: 'Produto não encontrado', message: 'O produto solicitado não existe.', error: {}, status: 404 });
    res.render('admin-product-form', { title: 'Editar produto', product: product, formError: null, isEditing: true, availableProducts: await Product.find({ _id: { $ne: product._id }, $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  } catch (error) { next(error); }
});

function getProductData(body) {
  var componentProducts = Array.isArray(body.componentProduct) ? body.componentProduct : (body.componentProduct ? [body.componentProduct] : []);
  var componentQuantities = Array.isArray(body.componentQuantity) ? body.componentQuantity : (body.componentQuantity ? [body.componentQuantity] : []);
  var componentCategories = Array.isArray(body.componentCategory) ? body.componentCategory : (body.componentCategory ? [body.componentCategory] : []);
  var components = componentProducts.map(function(product, index) {
    return { product: product, category: componentCategories[index] === 'decoracoes' ? 'decoracoes' : 'brinquedos', quantity: Number(componentQuantities[index]) || 1 };
  }).filter(function(component) { return component.product; });
  var isComposite = ['kit-montagem', 'festa-infantil'].indexOf(body.category) !== -1;
  var specificationNames = Array.isArray(body.specificationName) ? body.specificationName : (body.specificationName ? [body.specificationName] : []);
  var specificationValues = Array.isArray(body.specificationValues) ? body.specificationValues : (body.specificationValues ? [body.specificationValues] : []);
  var specifications = specificationNames.map(function(name, index) { return { name: name, values: String(specificationValues[index] || '').split(',').map(function(value) { return value.trim(); }).filter(Boolean) }; }).filter(function(specification) { return specification.name && specification.values.length; });
  if (isComposite && !components.length) throw new Error('Kits e festas infantis precisam de pelo menos um componente.');
  return {
    name: body.name,
    category: body.category,
    price: body.price,
    description: body.description,
    imageUrl: body.imageUrl || (body.imageUrls && body.imageUrls[0]) || '',
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : (body.imageUrls ? [body.imageUrls] : []),
    specifications: specifications,
    stockTotal: body.stockTotal,
    components: isComposite ? components : []
  };
}

router.post('/products', upload.array('images', 10), async function(req, res, next) {
  try {
    var data = getProductData(req.body);
    var uploadedImages = (req.files || []).map(function(file) { return '/uploads/' + file.filename; });
    data.imageUrls = data.imageUrls.concat(uploadedImages);
    data.imageUrl = data.imageUrls[0] || data.imageUrl;
    await Product.create(data);
    res.redirect('/admin/products');
  } catch (error) {
    res.status(400).render('admin-product-form', { title: 'Cadastrar produto', product: req.body, formError: error.message || 'Preencha os dados do produto corretamente.', isEditing: false, availableProducts: await Product.find({ $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  }
});

router.post('/products/:id', upload.array('images', 10), async function(req, res, next) {
  try {
    var data = getProductData(req.body);
    var uploadedImages = (req.files || []).map(function(file) { return '/uploads/' + file.filename; });
    data.imageUrls = data.imageUrls.concat(uploadedImages);
    data.imageUrl = data.imageUrls[0] || data.imageUrl;
    await Product.findByIdAndUpdate(req.params.id, data, { runValidators: true });
    res.redirect('/admin/products');
  } catch (error) {
    res.status(400).render('admin-product-form', {
      title: 'Editar produto',
      product: Object.assign({}, req.body, { _id: req.params.id }),
      formError: 'Preencha os dados do produto corretamente.',
      isEditing: true,
      availableProducts: await Product.find({ _id: { $ne: req.params.id }, $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 })
    });
  }
});

router.get('/stock', async function(req, res, next) {
  try {
    var products = await Product.find().populate('components.product').sort({ category: 1, name: 1 });
    var activeRentals = await Rental.find({ status: 'active' }).select('reservedComponents');
    var requested = {};
    activeRentals.forEach(function(rental) { (rental.reservedComponents || []).forEach(function(component) { requested[String(component.product)] = (requested[String(component.product)] || 0) + component.quantity; }); });
    products = await inventory.getProductsAvailability(products);
    products.forEach(function(product) { product.requestedQuantity = requested[String(product._id)] || 0; });
    res.render('admin-stock', { title: 'Controle de estoque', products: products, stockError: null });
  } catch (error) { next(error); }
});

router.post('/stock/:id', async function(req, res, next) {
  try {
    var amount = Number(req.body.amount);
    var product = await Product.findById(req.params.id);
    var composite = product && ['kit-montagem', 'festa-infantil'].indexOf(product.category) !== -1;
    if (!product || composite || !Number.isInteger(amount) || amount === 0) {
      if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) return res.status(400).json({ ok: false, message: 'A quantidade de kits e festas é calculada pelos componentes.' });
      return res.redirect('/admin/stock');
    }
    var nextStock = (Number(product.stockTotal) || 0) + amount;
    if (nextStock < (Number(product.rentedQuantity) || 0)) {
      var products = await Product.find().populate('components.product').sort({ category: 1, name: 1 });
      if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) return res.status(400).json({ ok: false, message: 'Não é possível remover unidades que estão alugadas.' });
      return res.status(400).render('admin-stock', { title: 'Controle de estoque', products: await inventory.getProductsAvailability(products), stockError: 'Não é possível remover unidades que estão alugadas.' });
    }
    await Product.findByIdAndUpdate(product._id, { stockTotal: nextStock });
    if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) {
      var updatedProduct = await inventory.findProductGraph(product._id);
      return res.json({ ok: true, stockTotal: updatedProduct.stockTotal, rentedQuantity: updatedProduct.rentedQuantity, availableUnits: inventory.availableUnits(updatedProduct) });
    }
    res.redirect('/admin/stock');
  } catch (error) {
    if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) return res.status(500).json({ ok: false, message: error.message });
    next(error);
  }
});

router.get('/rentals', async function(req, res, next) {
  try {
    res.render('admin-rentals', { title: 'Solicitações', rentals: await Rental.find({ status: 'active' }).populate('user').sort({ dates: 1, createdAt: 1 }) });
  } catch (error) { next(error); }
});

router.get('/rentals/:id', async function(req, res, next) {
  try {
    var rental = await Rental.findById(req.params.id).populate('user');
    if (!rental) return res.status(404).render('error', { title: 'Solicitação não encontrada', message: 'Esta solicitação não existe.', error: {}, status: 404 });
    res.render('admin-rental-detail', { title: 'Detalhes da solicitação', rental: rental });
  } catch (error) { next(error); }
});

async function closeRental(req, res, next, status) {
  try {
    var rental = await Rental.findOneAndUpdate({ _id: req.params.id, status: 'active' }, { status: status }, { new: true });
    if (rental && rental.deliveryChecked && !rental.returnChecked) {
      await Promise.all(rental.reservedComponents.map(function(component) { return Product.findByIdAndUpdate(component.product, { $inc: { rentedQuantity: -component.quantity } }); }));
      rental.returnChecked = true;
      await rental.save();
    }
    res.redirect('/admin/rentals');
  } catch (error) { next(error); }
}

async function markRentalDelivery(req, res, next, returning) {
  try {
    var rental = await Rental.findOne({ _id: req.params.id, status: 'active' });
    if (!rental) return res.redirect('/admin/rentals');
    if (!returning && !rental.deliveryChecked) {
      await Promise.all(rental.reservedComponents.map(function(component) { return Product.findByIdAndUpdate(component.product, { $inc: { rentedQuantity: component.quantity } }); }));
      rental.deliveryChecked = true;
    }
    if (returning && rental.deliveryChecked && !rental.returnChecked) {
      await Promise.all(rental.reservedComponents.map(function(component) { return Product.findByIdAndUpdate(component.product, { $inc: { rentedQuantity: -component.quantity } }); }));
      rental.returnChecked = true;
      rental.status = 'returned';
    }
    await rental.save();
    res.redirect('/admin/rentals/' + rental._id);
  } catch (error) { next(error); }
}

router.post('/rentals/:id/checklist', async function(req, res, next) {
  try {
    var rental = await Rental.findOne({ _id: req.params.id, status: 'active' });
    if (!rental) return res.redirect('/admin/rentals');
    var delivered = Array.isArray(req.body.deliveredItem) ? req.body.deliveredItem : (req.body.deliveredItem ? [req.body.deliveredItem] : []);
    var returned = Array.isArray(req.body.returnedItem) ? req.body.returnedItem : (req.body.returnedItem ? [req.body.returnedItem] : []);
    rental.deliveredItems = delivered;
    rental.returnedItems = returned;
    if (delivered.length === rental.items.length && !rental.deliveryChecked) {
      await Promise.all(rental.reservedComponents.map(function(component) { return Product.findByIdAndUpdate(component.product, { $inc: { rentedQuantity: component.quantity } }); }));
      rental.deliveryChecked = true;
    }
    if (returned.length === rental.items.length && rental.deliveryChecked && !rental.returnChecked) {
      await Promise.all(rental.reservedComponents.map(function(component) { return Product.findByIdAndUpdate(component.product, { $inc: { rentedQuantity: -component.quantity } }); }));
      rental.returnChecked = true;
      rental.status = 'returned';
    }
    await rental.save();
    res.redirect('/admin/rentals/' + rental._id);
  } catch (error) { next(error); }
});

router.post('/rentals/:id/deliver', function(req, res, next) { markRentalDelivery(req, res, next, false); });
router.post('/rentals/:id/return', function(req, res, next) { markRentalDelivery(req, res, next, true); });

router.post('/rentals/:id/finalize', function(req, res, next) { closeRental(req, res, next, 'returned'); });
router.post('/rentals/:id/cancel', function(req, res, next) { closeRental(req, res, next, 'cancelled'); });

router.post('/rentals/:id/invoice', async function(req, res, next) {
  try {
    await Rental.findByIdAndUpdate(req.params.id, { invoiceGenerated: true });
    res.redirect('/admin/rentals/' + req.params.id);
  } catch (error) { next(error); }
});

router.get('/invoices', async function(req, res, next) {
  try {
    res.render('admin-invoices', { title: 'Notas fiscais', rentals: await Rental.find().populate('user').sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

router.get('/meetings', async function(req, res, next) {
  try {
    res.render('admin-meetings', { title: 'Solicitações de reunião', meetings: await Meeting.find().populate('user').sort({ date: 1, time: 1 }) });
  } catch (error) { next(error); }
});

router.get('/settings', async function(req, res, next) {
  try {
    res.render('admin-settings', { title: 'Configurações do site', settings: await SiteSettings.findOne({ key: 'main' }) || new SiteSettings(), formError: null });
  } catch (error) { next(error); }
});

router.post('/settings', async function(req, res, next) {
  try {
    await SiteSettings.findOneAndUpdate({ key: 'main' }, { key: 'main', loginWelcome: req.body.loginWelcome, loginSubtitle: req.body.loginSubtitle, meetingHours: req.body.meetingHours, salonHours: req.body.salonHours }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
    res.redirect('/admin/settings');
  } catch (error) { next(error); }
});

router.post('/products/:id/delete', async function(req, res, next) {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin/products');
  } catch (error) { next(error); }
});

module.exports = router;
