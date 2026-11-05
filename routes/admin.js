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
var defaultHomeCarouselImages = require('../config/home-carousel-images');
var meetingHistoryUtils = require('../utils/meeting-history');
var customerWhatsApp = require('../utils/customer-whatsapp').customerWhatsAppUrl;
var withFinalPeriod = require('../utils/product-description');
var siteSettings = require('../utils/site-settings');
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
var carouselUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads'),
    filename: function(req, file, callback) {
      callback(null, 'home-carousel-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase());
    }
  }),
  limits: { files: 3, fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, callback) { callback(null, file.mimetype.indexOf('image/') === 0); }
});
var carouselImageFields = carouselUpload.fields([{ name: 'carouselImage0', maxCount: 1 }, { name: 'carouselImage1', maxCount: 1 }, { name: 'carouselImage2', maxCount: 1 }]);

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

function dashboardMonthKey(year, month) {
  return year + '-' + String(month + 1).padStart(2, '0');
}

function shiftDashboardMonth(year, month, amount) {
  var date = new Date(year, month + amount, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

function parseDashboardMonth(value) {
  var now = new Date();
  var selected = { year: now.getFullYear(), month: now.getMonth() };
  var match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) return selected;
  var year = Number(match[1]);
  var month = Number(match[2]) - 1;
  if (year >= 2000 && year <= 2100 && month >= 0 && month <= 11) {
    selected.year = year;
    selected.month = month;
  }
  return selected;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatCompactCurrency(value) {
  if (Number(value || 0) >= 1000) {
    return 'R$ ' + (Number(value) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  }
  return 'R$ ' + Math.round(Number(value || 0)).toLocaleString('pt-BR');
}

function capitalizeFirst(value) {
  var text = String(value || '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function rentalDashboardRevenue(rental) {
  return (rental.items || []).reduce(function(total, item) {
    return total + (Number(item.price) || 0) * (Number(item.quantity) || 0);
  }, 0);
}

function rentalDashboardItemCount(rental) {
  return (rental.items || []).reduce(function(total, item) {
    return total + (Number(item.quantity) || 0);
  }, 0);
}

async function getMonthlyDashboard(selected) {
  var selectedStart = new Date(selected.year, selected.month, 1);
  var selectedEnd = new Date(selected.year, selected.month + 1, 1);
  var rangeStart = new Date(selected.year, selected.month - 5, 1);
  var now = new Date();
  var currentKey = dashboardMonthKey(now.getFullYear(), now.getMonth());
  var selectedKey = dashboardMonthKey(selected.year, selected.month);

  var data = await Promise.all([
    Rental.find({ createdAt: { $gte: rangeStart, $lt: selectedEnd } }).select('status items createdAt').lean(),
    Meeting.find({ createdAt: { $gte: selectedStart, $lt: selectedEnd }, status: { $in: ['requested', 'confirmed'] } }).select('status').lean(),
    User.countDocuments({ role: 'user', createdAt: { $gte: selectedStart, $lt: selectedEnd } })
  ]);

  var rangeRentals = data[0];
  var meetings = data[1];
  var newCustomers = data[2];
  var monthRentals = rangeRentals.filter(function(rental) {
    return rental.createdAt >= selectedStart && rental.createdAt < selectedEnd;
  });
  var validRentals = monthRentals.filter(function(rental) { return rental.status !== 'cancelled'; });
  var revenue = validRentals.reduce(function(total, rental) { return total + rentalDashboardRevenue(rental); }, 0);
  var itemCount = validRentals.reduce(function(total, rental) { return total + rentalDashboardItemCount(rental); }, 0);
  var approvedCount = monthRentals.filter(function(rental) { return rental.status === 'active' || rental.status === 'returned'; }).length;
  var analysisCount = monthRentals.filter(function(rental) { return rental.status === 'analysis'; }).length;
  var confirmedMeetings = meetings.filter(function(meeting) { return meeting.status === 'confirmed'; }).length;

  var productTotals = {};
  validRentals.forEach(function(rental) {
    (rental.items || []).forEach(function(item) {
      var key = String(item.product || item.name || 'produto');
      if (!productTotals[key]) productTotals[key] = { name: item.name || 'Produto', quantity: 0, revenue: 0 };
      productTotals[key].quantity += Number(item.quantity) || 0;
      productTotals[key].revenue += (Number(item.price) || 0) * (Number(item.quantity) || 0);
    });
  });
  var topProducts = Object.keys(productTotals).map(function(key) { return productTotals[key]; })
    .sort(function(a, b) { return b.quantity - a.quantity || b.revenue - a.revenue; })
    .slice(0, 5)
    .map(function(product) {
      return { name: product.name, quantity: product.quantity, revenueFormatted: formatCurrency(product.revenue) };
    });

  var totalForStatus = monthRentals.length;
  var statusDefinitions = [
    { key: 'analysis', label: 'Em análise', modifier: 'is-analysis' },
    { key: 'active', label: 'Ativas', modifier: 'is-active' },
    { key: 'returned', label: 'Devolvidas', modifier: 'is-returned' },
    { key: 'cancelled', label: 'Canceladas', modifier: 'is-cancelled' }
  ];
  var statusBreakdown = statusDefinitions.map(function(status) {
    var count = monthRentals.filter(function(rental) { return rental.status === status.key; }).length;
    return {
      label: status.label,
      modifier: status.modifier,
      count: count,
      percent: totalForStatus ? Math.round(count / totalForStatus * 100) : 0
    };
  });

  var series = [];
  for (var offset = 5; offset >= 0; offset -= 1) {
    var monthStart = new Date(selected.year, selected.month - offset, 1);
    var monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
    var monthRentalsInSeries = rangeRentals.filter(function(rental) {
      return rental.createdAt >= monthStart && rental.createdAt < monthEnd && rental.status !== 'cancelled';
    });
    var monthRevenue = monthRentalsInSeries.reduce(function(total, rental) { return total + rentalDashboardRevenue(rental); }, 0);
    series.push({
      label: capitalizeFirst(monthStart.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')),
      title: capitalizeFirst(monthStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })),
      revenue: monthRevenue,
      valueFormatted: formatCompactCurrency(monthRevenue),
      count: monthRentalsInSeries.length,
      isCurrent: monthStart.getTime() === selectedStart.getTime()
    });
  }
  var maxRevenue = series.reduce(function(max, point) { return Math.max(max, point.revenue); }, 0);
  series.forEach(function(point) {
    point.height = point.revenue > 0 && maxRevenue > 0 ? Math.max(6, Math.round(point.revenue / maxRevenue * 100)) : 0;
  });

  var previous = shiftDashboardMonth(selected.year, selected.month, -1);
  var next = shiftDashboardMonth(selected.year, selected.month, 1);
  var nextKey = dashboardMonthKey(next.year, next.month);

  return {
    selectedKey: selectedKey,
    currentKey: currentKey,
    previousKey: dashboardMonthKey(previous.year, previous.month),
    nextKey: nextKey,
    canGoNext: nextKey <= currentKey,
    label: capitalizeFirst(selectedStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })),
    stats: {
      rentalCount: monthRentals.length,
      validRentalCount: validRentals.length,
      revenue: revenue,
      revenueFormatted: formatCurrency(revenue),
      averageTicketFormatted: formatCurrency(validRentals.length ? revenue / validRentals.length : 0),
      itemCount: itemCount,
      newCustomers: newCustomers,
      meetings: meetings.length,
      confirmedMeetings: confirmedMeetings,
      approvalRate: monthRentals.length ? Math.round(approvedCount / monthRentals.length * 100) : 0,
      analysisCount: analysisCount
    },
    statusBreakdown: statusBreakdown,
    series: series,
    topProducts: topProducts
  };
}

router.get('/', async function(req, res, next) {
  try {
    res.render('admin', {
      title: 'Painel administrativo',
      dashboard: await getMonthlyDashboard(parseDashboardMonth(req.query.mes))
    });
  } catch (error) { next(error); }
});

router.get('/usuarios', async function(req, res, next) {
  try {
    res.render('admin-usuarios', { title: 'Gerenciar usuários', users: await User.find().sort({ createdAt: -1 }), currentAdminId: req.session.user.id, userMessage: req.session.userMessage });
    delete req.session.userMessage;
  } catch (error) { next(error); }
});

router.post('/usuarios/:id/perfil', async function(req, res, next) {
  try {
    if (['admin', 'user'].indexOf(req.body.role) === -1) {
      req.session.userMessage = 'Selecione Administrador ou Cliente.';
      return res.redirect('/admin/usuarios');
    }
    var user = await User.findById(req.params.id);
    if (!user) {
      req.session.userMessage = 'Esta conta não foi encontrada.';
      return res.redirect('/admin/usuarios');
    }
    if (String(user._id) === String(req.session.user.id)) {
      req.session.userMessage = 'A função da sua própria conta não pode ser alterada.';
      return res.redirect('/admin/usuarios');
    }
    user.role = req.body.role;
    await user.save();
    req.session.userMessage = 'Perfil de ' + user.name + ' atualizado.';
    res.redirect('/admin/usuarios');
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

function normalizeSubcategoryName(name) {
  return String(name || '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Subcategorias de balão personalizado: o produto precisa de um texto (do cliente ou pré-definido).
function isCustomTextSubcategory(name) {
  var normalized = normalizeSubcategoryName(name);
  // "balões" normalizado é "baloes" (não "balao"), por isso a checagem cobre as duas formas.
  var isBalloon = normalized.indexOf('balao') !== -1 || normalized.indexOf('baloe') !== -1;
  return isBalloon && normalized.indexOf('personaliza') !== -1;
}

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
  var allowCustomText = body.allowCustomText === 'on';
  var predefinedCustomText = allowCustomText ? '' : String(body.predefinedCustomText || '').trim().slice(0, 200);
  if (subcategories.some(isCustomTextSubcategory) && !allowCustomText && !predefinedCustomText) {
    throw new Error('Defina se o texto do balão personalizado é escolhido pelo cliente ou informe o texto pré-personalizado.');
  }
  return {
    name: body.name,
    category: body.category,
    price: body.price,
    // Teste lógico: a descrição precisa terminar com ponto final (o ponto é adicionado se faltar).
    description: typeof body.description === 'string' ? withFinalPeriod(body.description) : body.description,
    imageUrl: body.imageUrl || (body.imageUrls && body.imageUrls[0]) || '',
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : (body.imageUrls ? [body.imageUrls] : []),
    specifications: specifications,
    subcategories: subcategories,
    allowCustomText: allowCustomText,
    predefinedCustomText: predefinedCustomText,
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

function isValidCalendarDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

async function hasActiveScheduleConflict(rental, exceptId) {
  var dates = new Set(rental.dates || []);
  var components = new Set((rental.reservedComponents || []).map(function(item) { return String(item.product); }));
  if (!dates.size || !components.size) return false;
  var query = { status: 'active' };
  if (exceptId) query._id = { $ne: exceptId };
  var activeRentals = await Rental.find(query).select('dates reservedComponents salonRental salonDate salonTime');
  return activeRentals.some(function(activeRental) {
    var dateOverlap = (activeRental.dates || []).some(function(date) { return dates.has(date); });
    var componentOverlap = (activeRental.reservedComponents || []).some(function(component) { return components.has(String(component.product)); });
    var salonOverlap = rental.salonRental && activeRental.salonRental && rental.salonDate === activeRental.salonDate && rental.salonTime === activeRental.salonTime;
    return (dateOverlap && componentOverlap) || salonOverlap;
  });
}

router.get('/solicitacoes', async function(req, res, next) {
  try {
    var rentals = await Rental.find({ status: { $in: ['analysis', 'active'] } }).populate('user').sort({ createdAt: -1 });
    var rentalHistory = await Rental.find({ status: { $in: ['returned', 'cancelled'] } }).populate('user').sort({ updatedAt: -1, createdAt: -1 });
    res.render('admin-solicitacoes', { title: 'Solicitações', rentals: rentals, rentalHistory: rentalHistory });
  } catch (error) { next(error); }
});

router.get('/solicitacoes/:id', async function(req, res, next) {
  try {
    var rental = await Rental.findById(req.params.id).populate('user');
    if (!rental) return res.status(404).render('erro', { title: 'Solicitação não encontrada', message: 'Esta solicitação não existe.', error: {}, status: 404 });
    res.render('admin-solicitacao-detalhe', { title: 'Detalhes da solicitação', rental: rental, formError: req.session.rentalFormError, formSuccess: req.session.rentalFormSuccess });
    delete req.session.rentalFormError;
    delete req.session.rentalFormSuccess;
  } catch (error) { next(error); }
});

router.post('/solicitacoes/:id/editar', async function(req, res, next) {
  try {
    var rental = await Rental.findById(req.params.id);
    if (!rental) return res.status(404).render('erro', { title: 'Solicitação não encontrada', message: 'Esta solicitação não existe.', error: {}, status: 404 });
    if (rental.deliveryChecked || ['returned', 'cancelled'].indexOf(rental.status) !== -1) {
      req.session.rentalFormError = 'Uma solicitação já entregue, devolvida ou cancelada não pode ser editada.';
      return res.redirect('/admin/solicitacoes/' + rental._id);
    }
    var productIds = Array.isArray(req.body.itemProductId) ? req.body.itemProductId : (req.body.itemProductId ? [req.body.itemProductId] : []);
    var quantities = Array.isArray(req.body.itemQuantity) ? req.body.itemQuantity : (req.body.itemQuantity ? [req.body.itemQuantity] : []);
    var itemDates = Array.isArray(req.body.itemDate) ? req.body.itemDate : (req.body.itemDate ? [req.body.itemDate] : []);
    var itemCustomTexts = Array.isArray(req.body.itemCustomText) ? req.body.itemCustomText : (req.body.itemCustomText ? [req.body.itemCustomText] : []);
    if (productIds.length !== rental.items.length || quantities.length !== rental.items.length || itemDates.length !== rental.items.length) throw new Error('Confira os produtos, quantidades e datas da solicitação.');
    var expanded = {};
    var uniqueDates = [];
    for (var index = 0; index < rental.items.length; index += 1) {
      var item = rental.items[index];
      var quantity = Number(quantities[index]);
      var date = String(itemDates[index] || '');
      var customText = String(itemCustomTexts[index] || '').trim().slice(0, 200);
      if (String(productIds[index]) !== String(item.product) || !Number.isInteger(quantity) || quantity < 1 || !isValidCalendarDate(date)) throw new Error('Confira a quantidade e a data de cada item.');
      var product = await inventory.findProductGraph(item.product);
      if (!product) throw new Error('Um produto desta solicitação não existe mais.');
      if (!customText && product.predefinedCustomText) customText = String(product.predefinedCustomText).trim().slice(0, 200);
      if (product.allowCustomText && !customText) throw new Error('Informe o texto de personalização de ' + product.name + '.');
      inventory.expandProduct(product, quantity, expanded);
      item.quantity = quantity;
      item.date = date;
      item.customText = customText;
      if (uniqueDates.indexOf(date) === -1) uniqueDates.push(date);
    }
    var deliveryAddress = String(req.body.deliveryAddress || '').trim();
    var deliveryCity = String(req.body.deliveryCity || '').trim();
    var deliveryState = String(req.body.deliveryState || '').trim().toUpperCase();
    var deliveryCep = String(req.body.deliveryCep || '').trim();
    var deliveryDate = String(req.body.deliveryDate || '');
    var deliveryTime = String(req.body.deliveryTime || '');
    var salonRental = req.body.salonRental === 'on';
    var salonDate = String(req.body.salonDate || '');
    var salonTime = String(req.body.salonTime || '');
    if (!deliveryAddress || !deliveryCity || !/^[A-Z]{2}$/.test(deliveryState) || !deliveryCep || !isValidCalendarDate(deliveryDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)) throw new Error('Preencha corretamente o endereço e os dados da entrega.');
    if (salonRental && (!isValidCalendarDate(salonDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(salonTime))) throw new Error('Preencha a data e o horário do salão.');
    var componentIds = Object.keys(expanded);
    var components = await Product.find({ _id: { $in: componentIds } });
    if (components.length !== componentIds.length) throw new Error('Um componente do kit não foi encontrado.');
    for (var componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
      var component = components[componentIndex];
      if ((Number(component.stockTotal) || 0) - (Number(component.rentedQuantity) || 0) < expanded[String(component._id)]) throw new Error('A quantidade solicitada excede o estoque disponível para ' + component.name + '.');
    }
    rental.dates = uniqueDates;
    rental.reservedComponents = componentIds.map(function(id) { return { product: id, quantity: expanded[id] }; });
    rental.deliveryAddress = deliveryAddress;
    rental.deliveryCity = deliveryCity;
    rental.deliveryState = deliveryState;
    rental.deliveryCep = deliveryCep;
    rental.deliveryDate = deliveryDate;
    rental.deliveryTime = deliveryTime;
    rental.salonRental = salonRental;
    rental.salonDate = salonRental ? salonDate : undefined;
    rental.salonTime = salonRental ? salonTime : undefined;
    if (rental.status === 'active' && await hasActiveScheduleConflict(rental, rental._id)) throw new Error('Os itens, as datas ou o horário do salão conflitam com outro aluguel ativo.');
    await rental.save();
    await rental.populate('user');
    var itemSummary = rental.items.map(function(item) { return '- ' + item.quantity + 'x ' + item.name + (item.customText ? ' (texto: ' + item.customText + ')' : '') + ' (uso em ' + item.date.split('-').reverse().join('/') + ')'; });
    var editMessage = [
      'Sua solicitação de locação foi atualizada pela loja.',
      '',
      'Itens:',
      ...itemSummary,
      'Entrega prevista: ' + rental.deliveryDate.split('-').reverse().join('/') + ' às ' + rental.deliveryTime,
      'Endereço: ' + rental.deliveryAddress + ', ' + rental.deliveryCity + '/' + rental.deliveryState + ' — CEP ' + rental.deliveryCep
    ];
    if (rental.salonRental) editMessage.push('Salão: ' + rental.salonDate.split('-').reverse().join('/') + ' às ' + rental.salonTime);
    var editWhatsAppUrl = customerWhatsApp(rental.user, editMessage);
    if (editWhatsAppUrl) return res.redirect(editWhatsAppUrl);
    req.session.rentalFormSuccess = 'As alterações foram salvas. Não foi possível abrir o WhatsApp porque o cliente não tem um telefone válido cadastrado.';
    res.redirect('/admin/solicitacoes/' + rental._id);
  } catch (error) {
    req.session.rentalFormError = error.message || 'Não foi possível editar a solicitação.';
    res.redirect('/admin/solicitacoes/' + req.params.id);
  }
});

router.post('/solicitacoes/:id/confirmar', async function(req, res, next) {
  try {
    var rental = await Rental.findOne({ _id: req.params.id, status: 'analysis' }).populate('user');
    if (!rental) {
      req.session.rentalFormError = 'Esta solicitação não está mais aguardando aprovação.';
      return res.redirect('/admin/solicitacoes/' + req.params.id);
    }
    var componentIds = (rental.reservedComponents || []).map(function(component) { return String(component.product); });
    var components = await Product.find({ _id: { $in: componentIds } });
    if (components.length !== componentIds.length) throw new Error('Um componente desta solicitação não foi encontrado.');
    for (var index = 0; index < components.length; index += 1) {
      var component = components[index];
      var requested = rental.reservedComponents.find(function(entry) { return String(entry.product) === String(component._id); });
      if ((Number(component.stockTotal) || 0) - (Number(component.rentedQuantity) || 0) < requested.quantity) throw new Error('Não há estoque suficiente de ' + component.name + ' para aprovar esta solicitação.');
    }
    if (await hasActiveScheduleConflict(rental, rental._id)) throw new Error('Os itens, as datas ou o horário do salão conflitam com outro aluguel ativo.');
    rental.status = 'active';
    await rental.save();
    var approvalMessage = [
      'Sua solicitação de locação foi aprovada e está ativa.',
      'Entrega prevista: ' + rental.deliveryDate.split('-').reverse().join('/') + ' às ' + rental.deliveryTime,
      'Endereço: ' + rental.deliveryAddress + ', ' + rental.deliveryCity + '/' + rental.deliveryState,
      'Itens: ' + rental.items.map(function(item) { return item.quantity + 'x ' + item.name; }).join(', ')
    ];
    var approvalWhatsAppUrl = customerWhatsApp(rental.user, approvalMessage);
    if (approvalWhatsAppUrl) return res.redirect(approvalWhatsAppUrl);
    req.session.rentalFormSuccess = 'Solicitação aprovada e marcada como ativa. O cliente não tem um telefone válido cadastrado.';
    res.redirect('/admin/solicitacoes/' + rental._id);
  } catch (error) {
    req.session.rentalFormError = error.message || 'Não foi possível aprovar a solicitação.';
    res.redirect('/admin/solicitacoes/' + req.params.id);
  }
});

async function closeRental(req, res, next, status) {
  try {
    var rental = await Rental.findOneAndUpdate({ _id: req.params.id, status: { $in: ['analysis', 'active'] } }, { status: status }, { new: true }).populate('user');
    if (rental && rental.deliveryChecked && !rental.returnChecked) {
      await Promise.all(rental.reservedComponents.map(function(component) { return Product.findByIdAndUpdate(component.product, { $inc: { rentedQuantity: -component.quantity } }); }));
      rental.returnChecked = true;
      await rental.save();
    }
    if (rental) {
      var cancelMessage = status === 'cancelled'
        ? ['Sua solicitação de locação foi cancelada pela loja.', 'Se precisar de ajuda, responda a esta mensagem.']
        : ['A locação foi encerrada pela loja.'];
      var cancelWhatsAppUrl = customerWhatsApp(rental.user, cancelMessage);
      if (cancelWhatsAppUrl) return res.redirect(cancelWhatsAppUrl);
    }
    res.redirect('/admin/solicitacoes');
  } catch (error) { next(error); }
}

router.post('/solicitacoes/:id/conferencia', async function(req, res, next) {
  var session = await mongoose.startSession();
  try {
    session.startTransaction();
    var rental = await Rental.findOne({ _id: req.params.id, status: 'active' }).populate('user').session(session);
    if (!rental) {
      await session.abortTransaction();
      return res.redirect('/admin/solicitacoes');
    }

    var isReturnChecklist = rental.deliveryChecked;
    var submittedItems = isReturnChecklist ? req.body.returnedItem : req.body.deliveredItem;
    var checkedIds = new Set((Array.isArray(submittedItems) ? submittedItems : (submittedItems ? [submittedItems] : [])).map(String));
    var rentalItemIds = Array.from(new Set(rental.items.map(function(item) { return String(item.product); })));
    var allItemsChecked = rentalItemIds.length > 0 && rentalItemIds.every(function(id) { return checkedIds.has(id); });

    if (!allItemsChecked) {
      await session.abortTransaction();
      req.session.rentalFormError = isReturnChecklist
        ? 'Assinale todos os produtos antes de confirmar a devolução.'
        : 'Assinale todos os produtos antes de confirmar a entrega.';
      return res.redirect('/admin/solicitacoes/' + rental._id);
    }

    if (!rental.deliveryChecked) {
      rental.deliveredItems = rentalItemIds;
      rental.returnedItems = [];
      rental.returnChecked = false;
      for (var deliveryIndex = 0; deliveryIndex < rental.reservedComponents.length; deliveryIndex += 1) {
        var deliveredComponent = rental.reservedComponents[deliveryIndex];
        await Product.updateOne({ _id: deliveredComponent.product }, { $inc: { rentedQuantity: deliveredComponent.quantity } }).session(session);
      }
      rental.deliveryChecked = true;
    } else {
      rental.returnedItems = rentalItemIds;
      for (var returnIndex = 0; returnIndex < rental.reservedComponents.length; returnIndex += 1) {
        var returnedComponent = rental.reservedComponents[returnIndex];
        await Product.updateOne({ _id: returnedComponent.product }, { $inc: { rentedQuantity: -returnedComponent.quantity } }).session(session);
      }
      rental.returnChecked = true;
      rental.status = 'returned';
    }

    await rental.save({ session: session });
    await session.commitTransaction();
    var checkedItems = isReturnChecklist ? rental.returnedItems : rental.deliveredItems;
    var checkedNames = rental.items.filter(function(item) { return checkedItems.map(String).indexOf(String(item.product)) !== -1; }).map(function(item) { return item.name; });
    var checklistMessage = isReturnChecklist
      ? ['A loja atualizou a conferência de devolução da sua locação.', 'Itens conferidos: ' + (checkedNames.length ? checkedNames.join(', ') : 'nenhum') + ' (' + checkedNames.length + ' de ' + rental.items.length + ').', rental.returnChecked ? 'A devolução foi concluída.' : 'A conferência será concluída quando todos os itens forem recebidos.']
      : ['A loja atualizou a conferência de entrega da sua locação.', 'Itens entregues: ' + (checkedNames.length ? checkedNames.join(', ') : 'nenhum') + ' (' + checkedNames.length + ' de ' + rental.items.length + ').', rental.deliveryChecked ? 'A entrega foi concluída.' : 'A conferência será concluída quando todos os itens forem entregues.'];
    var checklistWhatsAppUrl = customerWhatsApp(rental.user, checklistMessage);
    if (checklistWhatsAppUrl) return res.redirect(checklistWhatsAppUrl);
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
    var meetingMessages = { confirmada: 'A reunião foi confirmada.' };
    var allMeetings = await Meeting.find().populate('user').sort({ date: 1, time: 1 });
    var now = new Date();
    var meetings = allMeetings.filter(function(meeting) { return !meetingHistoryUtils.isHistorical(meeting, now); });
    var meetingHistory = allMeetings.filter(function(meeting) { return meetingHistoryUtils.isHistorical(meeting, now); }).sort(function(a, b) {
      return (b.date + 'T' + b.time).localeCompare(a.date + 'T' + a.time);
    });
    res.render('admin-reunioes', { title: 'Solicitações de reunião', meetings: meetings, meetingHistory: meetingHistory, meetingMessage: meetingMessages[req.query.reuniao] || '' });
  } catch (error) { next(error); }
});

router.get('/agenda', async function(req, res, next) {
  try {
    var meetingMessages = { confirmada: 'A reunião foi confirmada.' };
    var allMeetings = await Meeting.find().populate('user').sort({ date: 1, time: 1 });
    var now = new Date();
    var meetings = allMeetings.filter(function(meeting) { return !meetingHistoryUtils.isHistorical(meeting, now); });
    var meetingHistory = allMeetings.filter(function(meeting) { return meetingHistoryUtils.isHistorical(meeting, now); }).sort(function(a, b) {
      return (b.date + 'T' + b.time).localeCompare(a.date + 'T' + a.time);
    });
    var rentals = await Rental.find({ status: { $in: ['analysis', 'active'] } }).populate('user').sort({ createdAt: -1 });
    res.render('admin-agenda', {
      title: 'Agenda',
      meetings: meetings,
      meetingHistory: meetingHistory,
      meetingMessage: meetingMessages[req.query.reuniao] || '',
      rentals: rentals,
      initialView: req.query.view === 'reunioes' ? 'reunioes' : (req.query.view === 'solicitacoes' ? 'solicitacoes' : 'completa')
    });
  } catch (error) { next(error); }
});

router.post('/reunioes/:id/confirmar', async function(req, res, next) {
  try {
    var meeting = await Meeting.findOneAndUpdate({ _id: req.params.id, status: 'requested' }, { status: 'confirmed' }, { new: true }).populate('user');
    if (meeting) {
      var meetingMessage = ['Sua reunião foi confirmada para ' + meeting.date.split('-').reverse().join('/') + ' às ' + meeting.time + '.', 'Esperamos você!'];
      var meetingWhatsAppUrl = customerWhatsApp(meeting.user, meetingMessage);
      if (meetingWhatsAppUrl) return res.redirect(meetingWhatsAppUrl);
    }
    res.redirect('/admin/reunioes?reuniao=confirmada');
  } catch (error) { next(error); }
});

function renderConfigForm(res, settings, options) {
  options = options || {};
  var whatsappNumber = settings.whatsappNumber || siteSettings.defaultSettings.whatsappNumber;
  res.status(options.status || 200).render('admin-configuracoes', {
    title: 'Configurações do site',
    settings: settings,
    whatsappDisplay: siteSettings.formatWhatsAppNumber(whatsappNumber) || whatsappNumber,
    formError: options.formError || null,
    formSuccess: options.formSuccess || null
  });
}

router.get('/configuracoes', async function(req, res, next) {
  try {
    var settings = await SiteSettings.findOne({ key: 'main' }) || new SiteSettings();
    renderConfigForm(res, settings, {
      formSuccess: req.query.salvo === '1' ? 'Configurações salvas com sucesso.' : null
    });
  } catch (error) { next(error); }
});

router.post('/configuracoes', async function(req, res, next) {
  try {
    var whatsappNumber = siteSettings.normalizeWhatsAppNumber(req.body.whatsappNumber);
    var instagramUrl = siteSettings.sanitizeSocialUrl(req.body.instagramUrl);
    var facebookUrl = siteSettings.sanitizeSocialUrl(req.body.facebookUrl);
    var storeAddress = String(req.body.storeAddress || '').trim();
    var submittedSettings = {
      loginWelcome: req.body.loginWelcome,
      loginSubtitle: req.body.loginSubtitle,
      meetingHours: req.body.meetingHours,
      salonHours: req.body.salonHours,
      whatsappNumber: whatsappNumber || req.body.whatsappNumber,
      instagramUrl: instagramUrl === null ? req.body.instagramUrl : instagramUrl,
      facebookUrl: facebookUrl === null ? req.body.facebookUrl : facebookUrl,
      storeAddress: storeAddress
    };
    var formError = '';
    if (!whatsappNumber || whatsappNumber.length < 12 || whatsappNumber.length > 13) {
      formError = 'Informe um número de WhatsApp válido, com DDD.';
    } else if (instagramUrl === null) {
      formError = 'Informe um link válido para o Instagram.';
    } else if (facebookUrl === null) {
      formError = 'Informe um link válido para o Facebook.';
    }
    if (formError) return renderConfigForm(res, submittedSettings, { status: 400, formError: formError });

    await SiteSettings.findOneAndUpdate({ key: 'main' }, {
      $set: {
        whatsappNumber: whatsappNumber,
        instagramUrl: instagramUrl,
        facebookUrl: facebookUrl,
        storeAddress: storeAddress,
        loginWelcome: req.body.loginWelcome,
        loginSubtitle: req.body.loginSubtitle,
        meetingHours: req.body.meetingHours,
        salonHours: req.body.salonHours
      },
      $setOnInsert: { key: 'main' }
    }, { upsert: true, setDefaultsOnInsert: true });
    res.redirect('/admin/configuracoes?salvo=1');
  } catch (error) { next(error); }
});

router.get('/carrossel', async function(req, res, next) {
  try {
    var settings = await SiteSettings.findOne({ key: 'main' });
    var savedImages = settings && settings.homeCarouselImages && settings.homeCarouselImages.length ? settings.homeCarouselImages : defaultHomeCarouselImages;
    var images = [0, 1, 2].map(function(index) { return savedImages[index] || ''; });
    res.render('admin-carrossel', { title: 'Fotos do carrossel', images: images, carouselError: null });
  } catch (error) { next(error); }
});

router.post('/carrossel', carouselImageFields, async function(req, res, next) {
  try {
    var settings = await SiteSettings.findOne({ key: 'main' });
    var savedImages = settings && settings.homeCarouselImages && settings.homeCarouselImages.length ? settings.homeCarouselImages : defaultHomeCarouselImages;
    var existingImages = [0, 1, 2].map(function(index) { return savedImages[index] || ''; });
    var images = [];
    for (var index = 0; index < 3; index += 1) {
      if (req.body['removeCarouselImage' + index] === 'on') continue;
      var file = req.files && req.files['carouselImage' + index] && req.files['carouselImage' + index][0];
      var submitted = String(req.body['currentCarouselImage' + index] || existingImages[index] || defaultHomeCarouselImages[index] || '').trim();
      var safePath = /^\/(images|uploads)\/[A-Za-z0-9_./-]+$/.test(submitted) && submitted.indexOf('..') === -1 ? submitted : '';
      var image = file ? '/uploads/' + file.filename : safePath;
      if (image) images.push(image);
    }
    if (!images.length) {
      return res.status(400).render('admin-carrossel', { title: 'Fotos do carrossel', images: existingImages, carouselError: 'Mantenha ou envie pelo menos uma foto para o carrossel.' });
    }
    await SiteSettings.findOneAndUpdate({ key: 'main' }, { $set: { homeCarouselImages: images }, $setOnInsert: { key: 'main' } }, { upsert: true, setDefaultsOnInsert: true });
    res.redirect('/admin/carrossel');
  } catch (error) { next(error); }
});

router.post('/produtos/:id/excluir', async function(req, res, next) {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin/produtos');
  } catch (error) { next(error); }
});

module.exports = router;
