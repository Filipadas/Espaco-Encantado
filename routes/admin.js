var express = require('express');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var Product = require('../models/Product');
var Rental = require('../models/Rental');
var Meeting = require('../models/Meeting');
var inventory = require('../services/inventory');
var upload = require('../middleware/uploads');
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

router.get('/users/:id/edit', async function(req, res, next) {
  try {
    var profile = await User.findById(req.params.id);
    if (!profile) return res.status(404).render('error', { title: 'Usuário não encontrado', message: 'O usuário solicitado não existe.', error: {}, status: 404 });
    res.render('profile-form', { title: 'Editar perfil', profile: profile, isAdminEditing: true, formError: null });
  } catch (error) { next(error); }
});

router.post('/users/:id', upload.single('image'), async function(req, res, next) {
  try {
    var data = { name: req.body.name, email: req.body.email, phone: req.body.phone, address: req.body.address, city: req.body.city, state: req.body.state };
    if (req.file) data.imageUrl = '/uploads/' + req.file.filename;
    if (req.body.password) data.password = bcrypt.hashSync(String(req.body.password), 10);
    await User.findByIdAndUpdate(req.params.id, data, { runValidators: true });
    res.redirect('/admin/users');
  } catch (error) {
    var profile = await User.findById(req.params.id);
    res.status(400).render('profile-form', { title: 'Editar perfil', profile: Object.assign(profile ? profile.toObject() : {}, req.body), isAdminEditing: true, formError: 'Não foi possível salvar este perfil.' });
  }
});

router.post('/users/:id/role', async function(req, res, next) {
  try {
    await User.findByIdAndUpdate(req.params.id, { role: req.body.role === 'admin' ? 'admin' : 'user' });
    res.redirect('/admin/users');
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

function getProductData(body, imageUrl) {
  var componentProducts = Array.isArray(body.componentProduct) ? body.componentProduct : (body.componentProduct ? [body.componentProduct] : []);
  var componentQuantities = Array.isArray(body.componentQuantity) ? body.componentQuantity : (body.componentQuantity ? [body.componentQuantity] : []);
  var componentCategories = Array.isArray(body.componentCategory) ? body.componentCategory : (body.componentCategory ? [body.componentCategory] : []);
  var components = componentProducts.map(function(product, index) {
    return { product: product, category: componentCategories[index], quantity: Number(componentQuantities[index]) || 1 };
  }).filter(function(component) { return component.product; });
  var isComposite = ['kit-montagem', 'festa-infantil'].indexOf(body.category) !== -1;
  if (isComposite && !components.length) throw new Error('Kits e festas infantis precisam de pelo menos um componente.');
  return {
    name: body.name,
    category: body.category,
    price: body.price,
    description: body.description,
    imageUrl: imageUrl || body.imageUrl,
    stockTotal: body.stockTotal,
    components: isComposite ? components : []
  };
}

router.post('/products', upload.single('image'), async function(req, res, next) {
  try {
    await Product.create(getProductData(req.body, req.file && '/uploads/' + req.file.filename));
    res.redirect('/admin/products');
  } catch (error) {
    res.status(400).render('admin-product-form', { title: 'Cadastrar produto', product: req.body, formError: error.message || 'Preencha os dados do produto corretamente.', isEditing: false, availableProducts: await Product.find({ $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  }
});

router.post('/products/:id', upload.single('image'), async function(req, res, next) {
  try {
    var currentProduct = await Product.findById(req.params.id);
    var data = getProductData(req.body, req.file && '/uploads/' + req.file.filename || currentProduct && currentProduct.imageUrl);
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
    res.render('admin-stock', { title: 'Controle de estoque', products: await inventory.getProductsAvailability(products), stockError: null });
  } catch (error) { next(error); }
});

router.post('/stock/:id', async function(req, res, next) {
  try {
    var amount = Number(req.body.amount);
    var product = await Product.findById(req.params.id);
    if (!product || !Number.isInteger(amount) || amount === 0) return res.redirect('/admin/stock');
    var nextStock = (Number(product.stockTotal) || 0) + amount;
    if (nextStock < (Number(product.rentedQuantity) || 0)) {
      var products = await Product.find().populate('components.product').sort({ category: 1, name: 1 });
      return res.status(400).render('admin-stock', { title: 'Controle de estoque', products: await inventory.getProductsAvailability(products), stockError: 'Não é possível remover unidades que estão alugadas.' });
    }
    await Product.findByIdAndUpdate(product._id, { stockTotal: nextStock }, { runValidators: true });
    res.redirect('/admin/stock');
  } catch (error) { next(error); }
});

router.get('/rentals', async function(req, res, next) {
  try {
    res.render('admin-rentals', { title: 'Aluguéis ativos', rentals: await Rental.find({ status: 'active' }).populate('user').sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

router.get('/meetings', async function(req, res, next) {
  try {
    res.render('admin-meetings', { title: 'Solicitações de reunião', meetings: await Meeting.find().populate('user').sort({ date: 1, time: 1 }) });
  } catch (error) { next(error); }
});

router.post('/rentals/:id/return', async function(req, res, next) {
  try {
    var rental = await Rental.findOneAndUpdate({ _id: req.params.id, status: 'active' }, { status: 'returned' }, { new: true });
    if (rental) {
      await Promise.all(rental.reservedComponents.map(function(component) {
        return Product.findByIdAndUpdate(component.product, { $inc: { rentedQuantity: -component.quantity } });
      }));
    }
    res.redirect('/admin/rentals');
  } catch (error) { next(error); }
});

router.post('/products/:id/delete', async function(req, res, next) {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin/products');
  } catch (error) { next(error); }
});

module.exports = router;
