var express = require('express');
var mongoose = require('mongoose');
var multer = require('multer');
var path = require('path');
var bcrypt = require('bcryptjs');
var User = require('../models/User');
var Product = require('../models/Product');
var Rental = require('../models/Rental');
var Meeting = require('../models/Meeting');
var SiteSettings = require('../models/SiteSettings');
var inventory = require('../services/inventory');
var receipts = require('../services/receipts');
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

router.get('/usuarios', async function(req, res, next) {
  try {
    res.render('admin-usuarios', { title: 'Gerenciar usuários', users: await User.find().sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

router.get('/produtos', async function(req, res, next) {
  try {
    var products = await Product.find().populate('components.product').sort({ createdAt: -1 });
    res.render('admin-produtos', { title: 'Gerenciar produtos', products: await inventory.getProductsAvailability(products) });
  } catch (error) { next(error); }
});

router.get('/produtos/novo', async function(req, res, next) {
  try {
    res.render('admin-produtos-form', { title: 'Cadastrar produto', product: {}, formError: null, isEditing: false, availableProducts: await Product.find({ $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  } catch (error) { next(error); }
});

router.get('/produtos/:id/editar', async function(req, res, next) {
  try {
    var product = await Product.findById(req.params.id);
    if (!product) return res.status(404).render('erro', { title: 'Produto não encontrado', message: 'O produto solicitado não existe.', error: {}, status: 404 });
    res.render('admin-produtos-form', { title: 'Editar produto', product: product, formError: null, isEditing: true, availableProducts: await Product.find({ _id: { $ne: product._id }, $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
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

function buildOrderedImages(body, uploadedImages, fallbackImages) {
  var order = Array.isArray(body.carouselImageOrder) ? body.carouselImageOrder : (body.carouselImageOrder ? [body.carouselImageOrder] : []);
  if (!body.carouselOrderSubmitted) return fallbackImages.concat(uploadedImages);
  return order.map(function(token) {
    if (token.indexOf('existing:') === 0) return token.slice('existing:'.length);
    if (token.indexOf('upload:') === 0) return uploadedImages[Number(token.slice('upload:'.length))] || '';
    return '';
  }).filter(Boolean);
}

router.post('/produtos', upload.array('images', 10), async function(req, res, next) {
  try {
    var data = getProductData(req.body);
    var uploadedImages = (req.files || []).map(function(file) { return '/uploads/' + file.filename; });
    data.imageUrls = buildOrderedImages(req.body, uploadedImages, data.imageUrls);
    data.imageUrl = data.imageUrls[0] || data.imageUrl;
    await Product.create(data);
    res.redirect('/admin/produtos');
  } catch (error) {
    res.status(400).render('admin-produtos-form', { title: 'Cadastrar produto', product: req.body, formError: error.message || 'Preencha os dados do produto corretamente.', isEditing: false, availableProducts: await Product.find({ $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  }
});

router.post('/produtos/:id', upload.array('images', 10), async function(req, res, next) {
  try {
    var data = getProductData(req.body);
    var uploadedImages = (req.files || []).map(function(file) { return '/uploads/' + file.filename; });
    data.imageUrls = buildOrderedImages(req.body, uploadedImages, data.imageUrls);
    data.imageUrl = data.imageUrls[0] || data.imageUrl;
    await Product.findByIdAndUpdate(req.params.id, data, { runValidators: true });
    res.redirect('/admin/produtos');
  } catch (error) {
      res.status(400).render('admin-produtos-form', {
      title: 'Editar produto',
      product: Object.assign({}, req.body, { _id: req.params.id }),
      formError: 'Preencha os dados do produto corretamente.',
      isEditing: true,
      availableProducts: await Product.find({ _id: { $ne: req.params.id }, $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 })
    });
  }
});

router.get('/estoque', async function(req, res, next) {
  try {
    var products = await Product.find().populate('components.product').sort({ category: 1, name: 1 });
    var activeRentals = await Rental.find({ status: 'active' }).select('reservedComponents');
    var requested = {};
    activeRentals.forEach(function(rental) { (rental.reservedComponents || []).forEach(function(component) { requested[String(component.product)] = (requested[String(component.product)] || 0) + component.quantity; }); });
    products = await inventory.getProductsAvailability(products);
    products.forEach(function(product) { product.requestedQuantity = requested[String(product._id)] || 0; });
    res.render('admin-estoque', { title: 'Controle de estoque', products: products, stockError: null });
  } catch (error) { next(error); }
});

router.post('/estoque/:id', async function(req, res, next) {
  try {
    var amount = Number(req.body.amount);
    var product = await Product.findById(req.params.id);
    var composite = product && ['kit-montagem', 'festa-infantil'].indexOf(product.category) !== -1;
    if (!product || composite || !Number.isInteger(amount) || amount === 0) {
      if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) return res.status(400).json({ ok: false, message: 'A quantidade de kits e festas é calculada pelos componentes.' });
      return res.redirect('/admin/estoque');
    }
    var nextStock = (Number(product.stockTotal) || 0) + amount;
    if (nextStock < (Number(product.rentedQuantity) || 0)) {
      var products = await Product.find().populate('components.product').sort({ category: 1, name: 1 });
      if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) return res.status(400).json({ ok: false, message: 'Não é possível remover unidades que estão alugadas.' });
      return res.status(400).render('admin-estoque', { title: 'Controle de estoque', products: await inventory.getProductsAvailability(products), stockError: 'Não é possível remover unidades que estão alugadas.' });
    }
    await Product.findByIdAndUpdate(product._id, { stockTotal: nextStock });
    if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) {
      var updatedProduct = await inventory.findProductGraph(product._id);
      return res.json({ ok: true, stockTotal: updatedProduct.stockTotal, rentedQuantity: updatedProduct.rentedQuantity, availableUnits: inventory.availableUnits(updatedProduct) });
    }
    res.redirect('/admin/estoque');
  } catch (error) {
    if (req.get('Accept') && req.get('Accept').indexOf('application/json') !== -1) return res.status(500).json({ ok: false, message: error.message });
    next(error);
  }
});

router.get('/solicitacoes', async function(req, res, next) {
  try {
    res.render('admin-solicitacoes', { title: 'Solicitações', rentals: await Rental.find({ status: 'active' }).populate('user').sort({ dates: 1, createdAt: 1 }) });
  } catch (error) { next(error); }
});

router.get('/solicitacoes/:id', async function(req, res, next) {
  try {
    var rental = await Rental.findById(req.params.id).populate('user');
    if (!rental) return res.status(404).render('erro', { title: 'Solicitação não encontrada', message: 'Esta solicitação não existe.', error: {}, status: 404 });
    res.render('admin-solicitacao-detalhe', { title: 'Detalhes da solicitação', rental: rental });
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
    res.redirect('/admin/solicitacoes');
  } catch (error) { next(error); }
}

router.post('/solicitacoes/:id/conferencia', async function(req, res, next) {
  var session = await mongoose.startSession();
  try {
    session.startTransaction();
    var rental = await Rental.findOne({ _id: req.params.id, status: 'active' }).session(session);
    if (!rental) {
      await session.abortTransaction();
      return res.redirect('/admin/solicitacoes');
    }

    var submittedItems = rental.deliveryChecked ? req.body.returnedItem : req.body.deliveredItem;
    var checkedIds = new Set((Array.isArray(submittedItems) ? submittedItems : (submittedItems ? [submittedItems] : [])).map(String));
    var rentalItemIds = Array.from(new Set(rental.items.map(function(item) { return String(item.product); })));

    if (!rental.deliveryChecked) {
      rental.deliveredItems = rentalItemIds.filter(function(id) { return checkedIds.has(id); });
      if (rentalItemIds.length && rental.deliveredItems.length === rentalItemIds.length) {
        for (var deliveryIndex = 0; deliveryIndex < rental.reservedComponents.length; deliveryIndex += 1) {
          var deliveredComponent = rental.reservedComponents[deliveryIndex];
          await Product.updateOne({ _id: deliveredComponent.product }, { $inc: { rentedQuantity: deliveredComponent.quantity } }).session(session);
        }
        rental.deliveryChecked = true;
      }
    } else {
      rental.returnedItems = rentalItemIds.filter(function(id) { return checkedIds.has(id); });
      if (rentalItemIds.length && rental.returnedItems.length === rentalItemIds.length) {
        for (var returnIndex = 0; returnIndex < rental.reservedComponents.length; returnIndex += 1) {
          var returnedComponent = rental.reservedComponents[returnIndex];
          await Product.updateOne({ _id: returnedComponent.product }, { $inc: { rentedQuantity: -returnedComponent.quantity } }).session(session);
        }
        rental.returnChecked = true;
        rental.status = 'returned';
      }
    }

    await rental.save({ session: session });
    await session.commitTransaction();
    res.redirect('/admin/solicitacoes/' + rental._id);
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    next(error);
  } finally {
    await session.endSession();
  }
});

router.post('/solicitacoes/:id/cancelar', function(req, res, next) { closeRental(req, res, next, 'cancelled'); });

async function createRentalReceipt(req, res, next) {
  try {
    var rental = await Rental.findById(req.params.id);
    if (!rental) return res.status(404).render('erro', { title: 'Solicitação não encontrada', message: 'Esta solicitação não existe.', error: {}, status: 404 });
    var viewData = await receipts.getReceiptViewData(rental);
    viewData.isAdminView = true;
    res.render('comprovante', viewData);
  } catch (error) { next(error); }
}

router.post('/solicitacoes/:id/comprovante', createRentalReceipt);
router.post('/comprovantes/:id/criar', createRentalReceipt);
router.post('/comprovantes/:id', createRentalReceipt);

async function showRentalReceipt(req, res, next) {
  try {
    var rental = await Rental.findById(req.params.id);
    if (!rental) return res.status(404).render('erro', { title: 'Comprovante não encontrado', message: 'Este comprovante ainda não foi criado.', error: {}, status: 404 });
    var viewData = await receipts.getReceiptViewData(rental);
    viewData.isAdminView = true;
    res.render('comprovante', viewData);
  } catch (error) { next(error); }
}

router.get('/solicitacoes/:id/comprovante', showRentalReceipt);
router.get('/comprovantes/:id', showRentalReceipt);
router.get('/comprovantes/:id/visualizar', showRentalReceipt);

router.get('/comprovantes', async function(req, res, next) {
  try {
    res.render('admin-comprovantes', { title: 'Comprovantes de locação', rentals: await Rental.find().populate('user').sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

router.get('/reunioes', async function(req, res, next) {
  try {
    res.render('admin-reunioes', { title: 'Solicitações de reunião', meetings: await Meeting.find().populate('user').sort({ date: 1, time: 1 }) });
  } catch (error) { next(error); }
});

router.get('/configuracoes', async function(req, res, next) {
  try {
    res.render('admin-configuracoes', { title: 'Configurações do site', settings: await SiteSettings.findOne({ key: 'main' }) || new SiteSettings(), formError: null });
  } catch (error) { next(error); }
});

router.post('/configuracoes', async function(req, res, next) {
  try {
    await SiteSettings.findOneAndUpdate({ key: 'main' }, { key: 'main', loginWelcome: req.body.loginWelcome, loginSubtitle: req.body.loginSubtitle, meetingHours: req.body.meetingHours, salonHours: req.body.salonHours }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
    res.redirect('/admin/configuracoes');
  } catch (error) { next(error); }
});

router.post('/produtos/:id/excluir', async function(req, res, next) {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin/produtos');
  } catch (error) { next(error); }
});

module.exports = router;
