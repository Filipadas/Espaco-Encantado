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

var DEFAULT_PRODUCT_SPECIFICATIONS = [{ name: 'Tamanho', values: ['Pequeno', 'Médio', 'Grande'] }];

function normalizeSpecifications(rawSpecifications) {
  var seenNames = new Set();
  return (Array.isArray(rawSpecifications) ? rawSpecifications : []).map(function(specification) {
    var name = String(specification && specification.name || '').trim();
    var values = Array.isArray(specification && specification.values) ? specification.values : [];
    var seenValues = new Set();
    values = values.map(function(value) { return String(value || '').trim(); }).filter(function(value) {
      var key = value.toLocaleLowerCase();
      if (!value || seenValues.has(key)) return false;
      seenValues.add(key);
      return true;
    });
    var key = name.toLocaleLowerCase();
    if (!name || seenNames.has(key) || !values.length) return null;
    seenNames.add(key);
    return { name: name, values: values };
  }).filter(Boolean);
}

function getSubmittedSpecifications(body) {
  if (body.specificationPayload) {
    try {
      var payload = JSON.parse(body.specificationPayload);
      return normalizeSpecifications(Array.isArray(payload) ? payload : payload.specifications);
    }
    catch (error) { return []; }
  }
  var names = Array.isArray(body.specificationName) ? body.specificationName : (body.specificationName ? [body.specificationName] : []);
  var values = Array.isArray(body.specificationValues) ? body.specificationValues : (body.specificationValues ? [body.specificationValues] : []);
  return normalizeSpecifications(names.map(function(name, index) { return { name: name, values: String(values[index] || '').split(',') }; }));
}

function getSubmittedSpecificationDefinitions(body) {
  if (body.specificationPayload) {
    try {
      var payload = JSON.parse(body.specificationPayload);
      var entries = Array.isArray(payload) ? payload : payload.specifications || [];
      return normalizeSpecifications(entries.map(function(specification) {
        return { name: specification.name, values: specification.availableValues || specification.values };
      }));
    } catch (error) { return []; }
  }
  return getSubmittedSpecifications(body);
}

async function getSpecificationCatalog(product) {
  var settings = await SiteSettings.findOne({ key: 'main' }).select('productSpecifications productSpecificationsInitialized');
  var storedDefinitions = settings && settings.productSpecifications || [];
  var definitions = (settings && settings.productSpecificationsInitialized ? [] : DEFAULT_PRODUCT_SPECIFICATIONS).concat(storedDefinitions);
  var selectedSpecifications = normalizeSpecifications(product && product.specifications || []);
  var byName = new Map();
  definitions.concat(selectedSpecifications).forEach(function(specification) {
    var key = specification.name.toLocaleLowerCase();
    if (!byName.has(key)) byName.set(key, { name: specification.name, values: [], selectedValues: [], isSaved: definitions.some(function(definition) { return definition.name.toLocaleLowerCase() === key; }) });
    var entry = byName.get(key);
    specification.values.forEach(function(value) {
      if (!entry.values.some(function(existing) { return existing.toLocaleLowerCase() === value.toLocaleLowerCase(); })) entry.values.push(value);
    });
  });
  selectedSpecifications.forEach(function(specification) {
    var entry = byName.get(specification.name.toLocaleLowerCase());
    entry.selectedValues = specification.values.slice();
  });
  return Array.from(byName.values());
}

async function saveSpecificationDefinitions(specifications) {
  if (!specifications.length) return;
  var settings = await SiteSettings.findOne({ key: 'main' });
  var definitions = [];
  (settings && settings.productSpecificationsInitialized ? [] : DEFAULT_PRODUCT_SPECIFICATIONS).concat(settings && settings.productSpecifications || []).forEach(function(specification) {
    var existing = definitions.find(function(entry) { return entry.name.toLocaleLowerCase() === specification.name.toLocaleLowerCase(); });
    if (!existing) {
      definitions.push({ name: specification.name, values: Array.from(specification.values || []) });
      return;
    }
    Array.from(specification.values || []).forEach(function(value) {
      if (!existing.values.some(function(existingValue) { return existingValue.toLocaleLowerCase() === value.toLocaleLowerCase(); })) existing.values.push(value);
    });
  });
  specifications.forEach(function(specification) {
    var existing = definitions.find(function(entry) { return entry.name.toLocaleLowerCase() === specification.name.toLocaleLowerCase(); });
    if (!existing) {
      definitions.push({ name: specification.name, values: specification.values.slice() });
      return;
    }
    specification.values.forEach(function(value) {
      if (!existing.values.some(function(existingValue) { return existingValue.toLocaleLowerCase() === value.toLocaleLowerCase(); })) existing.values.push(value);
    });
  });
  await SiteSettings.findOneAndUpdate({ key: 'main' }, { $set: { productSpecifications: definitions, productSpecificationsInitialized: true }, $setOnInsert: { key: 'main' } }, { upsert: true, setDefaultsOnInsert: true });
}

async function saveSubcategoryDefinitions(category, subcategories) {
  if (!category || !subcategories.length) return;
  var settings = await SiteSettings.findOne({ key: 'main' });
  var definitions = (settings && settings.productSubcategories || []).map(function(item) { return { category: item.category, name: item.name }; });
  subcategories.forEach(function(name) {
    if (!definitions.some(function(item) { return item.category === category && item.name.toLocaleLowerCase() === name.toLocaleLowerCase(); })) definitions.push({ category: category, name: name });
  });
  await SiteSettings.findOneAndUpdate({ key: 'main' }, { $set: { productSubcategories: definitions }, $setOnInsert: { key: 'main' } }, { upsert: true, setDefaultsOnInsert: true });
}

async function deleteSubcategoryDefinition(category, name) {
  var settings = await SiteSettings.findOne({ key: 'main' });
  var definitions = (settings && settings.productSubcategories || []).filter(function(item) {
    return item.category !== category || item.name.toLocaleLowerCase() !== name.toLocaleLowerCase();
  });
  await SiteSettings.findOneAndUpdate({ key: 'main' }, { $set: { productSubcategories: definitions }, $setOnInsert: { key: 'main' } }, { upsert: true, setDefaultsOnInsert: true });
  await Product.updateMany({ category: category, subcategories: name }, { $pull: { subcategories: name } });
}

async function getSubcategoryCatalog(product) {
  var settings = await SiteSettings.findOne({ key: 'main' }).select('productSubcategories');
  var definitions = settings && settings.productSubcategories || [];
  var catalog = {};
  definitions.forEach(function(item) {
    if (!catalog[item.category]) catalog[item.category] = [];
    if (!catalog[item.category].some(function(name) { return name.toLocaleLowerCase() === item.name.toLocaleLowerCase(); })) catalog[item.category].push(item.name);
  });
  if (product && product.category) {
    (product.subcategories || []).forEach(function(name) {
      if (!catalog[product.category]) catalog[product.category] = [];
      if (!catalog[product.category].some(function(existing) { return existing.toLocaleLowerCase() === name.toLocaleLowerCase(); })) catalog[product.category].push(name);
    });
  }
  Object.keys(catalog).forEach(function(category) { catalog[category].sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); }); });
  return catalog;
}

function getSubmittedSubcategories(body) {
  var values = [];
  if (body.subcategoryPayload) {
    try { values = JSON.parse(body.subcategoryPayload); }
    catch (error) { values = []; }
  } else if (Array.isArray(body.subcategories)) values = body.subcategories;
  else if (body.subcategories) values = [body.subcategories];
  if (!Array.isArray(values)) values = [];
  return values.map(function(value) { return String(value || '').trim(); }).filter(function(value, index, names) {
    return value && names.findIndex(function(name) { return name.toLocaleLowerCase() === value.toLocaleLowerCase(); }) === index;
  });
}

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
    products = await inventory.getProductsAvailability(products);
    var categories = Array.from(new Set(products.map(function(product) { return product.category; }).filter(Boolean))).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });
    res.render('admin-produtos', { title: 'Gerenciar produtos', products: products, categories: categories });
  } catch (error) { next(error); }
});

router.get('/produtos/novo', async function(req, res, next) {
  try {
    res.render('admin-produtos-form', { title: 'Cadastrar produto', product: {}, specificationCatalog: await getSpecificationCatalog({}), subcategoryCatalog: await getSubcategoryCatalog({}), formError: null, isEditing: false, availableProducts: await Product.find({ $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  } catch (error) { next(error); }
});

router.get('/produtos/:id/editar', async function(req, res, next) {
  try {
    var product = await Product.findById(req.params.id);
    if (!product) return res.status(404).render('erro', { title: 'Produto não encontrado', message: 'O produto solicitado não existe.', error: {}, status: 404 });
    res.render('admin-produtos-form', { title: 'Editar produto', product: product, specificationCatalog: await getSpecificationCatalog(product), subcategoryCatalog: await getSubcategoryCatalog(product), formError: null, isEditing: true, availableProducts: await Product.find({ _id: { $ne: product._id }, $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
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
  var specifications = getSubmittedSpecifications(body);
  var subcategories = getSubmittedSubcategories(body);
  if (isComposite && !components.length) throw new Error('Kits e festas infantis precisam de pelo menos um componente.');
  return {
    name: body.name,
    category: body.category,
    price: body.price,
    description: body.description,
    imageUrl: body.imageUrl || (body.imageUrls && body.imageUrls[0]) || '',
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : (body.imageUrls ? [body.imageUrls] : []),
    specifications: specifications,
    subcategories: subcategories,
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
    await saveSpecificationDefinitions(getSubmittedSpecificationDefinitions(req.body));
    await saveSubcategoryDefinitions(req.body.category, data.subcategories);
    var uploadedImages = (req.files || []).map(function(file) { return '/uploads/' + file.filename; });
    data.imageUrls = buildOrderedImages(req.body, uploadedImages, data.imageUrls);
    data.imageUrl = data.imageUrls[0] || data.imageUrl;
    await Product.create(data);
    res.redirect('/admin/produtos');
  } catch (error) {
    var submittedProduct = Object.assign({}, req.body, { specifications: getSubmittedSpecifications(req.body), subcategories: getSubmittedSubcategories(req.body) });
    res.status(400).render('admin-produtos-form', { title: 'Cadastrar produto', product: submittedProduct, specificationCatalog: await getSpecificationCatalog(submittedProduct), subcategoryCatalog: await getSubcategoryCatalog(submittedProduct), formError: error.message || 'Preencha os dados do produto corretamente.', isEditing: false, availableProducts: await Product.find({ $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 }) });
  }
});

router.post('/produtos/:id', upload.array('images', 10), async function(req, res, next) {
  try {
    var data = getProductData(req.body);
    await saveSpecificationDefinitions(getSubmittedSpecificationDefinitions(req.body));
    await saveSubcategoryDefinitions(req.body.category, data.subcategories);
    var uploadedImages = (req.files || []).map(function(file) { return '/uploads/' + file.filename; });
    data.imageUrls = buildOrderedImages(req.body, uploadedImages, data.imageUrls);
    data.imageUrl = data.imageUrls[0] || data.imageUrl;
    await Product.findByIdAndUpdate(req.params.id, data, { runValidators: true });
    res.redirect('/admin/produtos');
  } catch (error) {
      var submittedProduct = Object.assign({}, req.body, { _id: req.params.id, specifications: getSubmittedSpecifications(req.body), subcategories: getSubmittedSubcategories(req.body) });
      res.status(400).render('admin-produtos-form', {
      title: 'Editar produto',
      product: submittedProduct,
      specificationCatalog: await getSpecificationCatalog(submittedProduct),
      subcategoryCatalog: await getSubcategoryCatalog(submittedProduct),
      formError: 'Preencha os dados do produto corretamente.',
      isEditing: true,
      availableProducts: await Product.find({ _id: { $ne: req.params.id }, $or: [{ components: { $exists: false } }, { components: { $size: 0 } }] }).sort({ name: 1 })
    });
  }
});

router.post('/especificacoes/excluir', async function(req, res, next) {
  try {
    var name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, message: 'Especificação inválida.' });
    var settings = await SiteSettings.findOne({ key: 'main' });
    var definitions = (settings && settings.productSpecificationsInitialized ? [] : DEFAULT_PRODUCT_SPECIFICATIONS).concat(settings && settings.productSpecifications || []);
    definitions = definitions.filter(function(specification) { return specification.name.toLocaleLowerCase() !== name.toLocaleLowerCase(); });
    await SiteSettings.findOneAndUpdate({ key: 'main' }, { $set: { productSpecifications: definitions, productSpecificationsInitialized: true }, $setOnInsert: { key: 'main' } }, { upsert: true, setDefaultsOnInsert: true });
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir especificação:', error);
    res.status(500).json({ ok: false, message: 'Não foi possível excluir a especificação. ' + (error.message || '') });
  }
});

router.post('/especificacoes', async function(req, res, next) {
  try {
    var name = String(req.body.name || '').trim();
    var values = Array.isArray(req.body.values) ? req.body.values : [];
    if (!values.length && typeof req.body.values === 'string') {
      try { values = JSON.parse(req.body.values); }
      catch (error) { values = req.body.values.split(','); }
    }
    if (!Array.isArray(values)) values = [];
    values = values.map(function(value) { return String(value || '').trim(); }).filter(Boolean);
    if (!name || name.length > 80 || !values.length || values.some(function(value) { return value.length > 80; })) {
      return res.status(400).json({ ok: false, message: 'Informe o nome da especificação e pelo menos uma opção (até 80 caracteres).' });
    }
    await saveSpecificationDefinitions([{ name: name, values: values }]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao salvar especificação:', error);
    res.status(500).json({ ok: false, message: 'Não foi possível salvar a especificação. ' + (error.message || '') });
  }
});

router.post('/subcategorias', async function(req, res) {
  try {
    var category = String(req.body.category || '').trim();
    var name = String(req.body.name || '').trim();
    var allowedCategories = ['brinquedos', 'decoracoes', 'kit-montagem', 'festa-infantil'];
    if (allowedCategories.indexOf(category) === -1 || !name || name.length > 80) {
      return res.status(400).json({ ok: false, message: 'Informe uma categoria e um nome de subcategoria válido (até 80 caracteres).' });
    }
    await saveSubcategoryDefinitions(category, [name]);
    res.json({ ok: true, category: category, name: name });
  } catch (error) {
    console.error('Erro ao salvar subcategoria:', error);
    res.status(500).json({ ok: false, message: 'Não foi possível salvar a subcategoria. ' + (error.message || '') });
  }
});

router.post('/subcategorias/excluir', async function(req, res) {
  try {
    var category = String(req.body.category || '').trim();
    var name = String(req.body.name || '').trim();
    var allowedCategories = ['brinquedos', 'decoracoes', 'kit-montagem', 'festa-infantil'];
    if (allowedCategories.indexOf(category) === -1 || !name) {
      return res.status(400).json({ ok: false, message: 'Subcategoria inválida.' });
    }
    await deleteSubcategoryDefinition(category, name);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao excluir subcategoria:', error);
    res.status(500).json({ ok: false, message: 'Não foi possível excluir a subcategoria. ' + (error.message || '') });
  }
});

router.post('/especificacoes/valores', async function(req, res, next) {
  try {
    var name = String(req.body.name || '').trim();
    var values = [];
    try { values = JSON.parse(String(req.body.values || '[]')); }
    catch (error) { values = []; }
    if (!name || !Array.isArray(values) || !values.length) return res.status(400).json({ ok: false, message: 'Selecione ao menos uma opção para salvar.' });
    values = values.map(function(value) { return String(value || '').trim(); }).filter(function(value) { return value && value.length <= 80; });
    if (!values.length) return res.status(400).json({ ok: false, message: 'As opções informadas são inválidas.' });
    await saveSpecificationDefinitions([{ name: name, values: values }]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Erro ao salvar opções da especificação:', error);
    res.status(500).json({ ok: false, message: 'Não foi possível salvar as opções. ' + (error.message || '') });
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
    var categories = Array.from(new Set(products.map(function(product) { return product.category; }).filter(Boolean))).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });
    res.render('admin-estoque', { title: 'Controle de estoque', products: products, categories: categories, stockError: null });
  } catch (error) { next(error); }
});

router.post('/estoque/:id', async function(req, res, next) {
  try {
    var amount = Number(req.body.amount);
    var product = await Product.findById(req.params.id);
    var composite = product && ['kit-montagem', 'festa-infantil'].indexOf(product.category) !== -1;
    var wantsJson = (req.get('Accept') || '').indexOf('application/json') !== -1;
    if (!product) {
      if (wantsJson) return res.status(404).json({ ok: false, message: 'Produto não encontrado.' });
      return res.redirect('/admin/estoque');
    }
    if (composite) {
      if (wantsJson) return res.status(400).json({ ok: false, message: 'A quantidade de kits e festas é calculada pelos componentes.' });
      return res.redirect('/admin/estoque');
    }
    if (!Number.isInteger(amount) || amount === 0) {
      if (wantsJson) return res.status(400).json({ ok: false, message: 'Ajuste de estoque inválido.' });
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
