var express = require('express');
var Product = require('../models/Product');
var User = require('../models/User');
var inventory = require('../services/inventory');
var SiteSettings = require('../models/SiteSettings');
var Meeting = require('../models/Meeting');
var meetingHoursConfig = require('../utils/meeting-hours');
var database = require('../config/database');
var defaultHomeCarouselImages = require('../config/home-carousel-images');
var router = express.Router();
var catalogStates = {
  brinquedos: { categories: ['brinquedos', 'brinquedo'], label: 'brinquedo', title: 'Brinquedos' },
  decoracoes: { categories: ['decoracoes', 'decoração', 'decoracao'], label: 'decoração', title: 'Decorações' },
  'kit-montagem': { categories: ['kit-montagem', 'kit-mont'], label: 'kit-mont', title: 'Kit de montagem' },
  'festa-infantil': { categories: ['festa-infantil', 'infantil'], label: 'infantil', title: 'Festa infantil' }
};

function slugifySubcategory(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function searchScore(product, query) {
  var normalizedQuery = normalizeSearchText(query).trim();
  var name = normalizeSearchText(product.name);
  var description = normalizeSearchText(product.description);
  var specifications = (product.specifications || []).map(function(specification) {
    return normalizeSearchText(specification.name + ' ' + (specification.values || []).join(' '));
  }).join(' ');
  var subcategories = normalizeSearchText((product.subcategories || []).join(' '));
  var tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  var score = 0;
  if (name === normalizedQuery) score += 160;
  else if (name.indexOf(normalizedQuery) === 0) score += 130;
  else if (name.indexOf(normalizedQuery) !== -1) score += 100;
  if (description.indexOf(normalizedQuery) !== -1) score += 30;
  if (specifications.indexOf(normalizedQuery) !== -1) score += 45;
  if (subcategories.indexOf(normalizedQuery) !== -1) score += 35;
  tokens.forEach(function(token) {
    if (name.indexOf(token) !== -1) score += 25;
    else if (specifications.indexOf(token) !== -1) score += 18;
    else if (subcategories.indexOf(token) !== -1) score += 14;
    else if (description.indexOf(token) !== -1) score += 8;
  });
  return score;
}

function selectedSpecificationFilters(value) {
  var rawValues = Array.isArray(value) ? value : (value ? [value] : []);
  var filters = {};
  rawValues.forEach(function(raw) {
    try {
      var pair = JSON.parse(raw);
      if (Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1]) {
        if (!filters[pair[0]]) filters[pair[0]] = [];
        if (filters[pair[0]].indexOf(pair[1]) === -1) filters[pair[0]].push(pair[1]);
      }
    } catch (error) {}
  });
  return filters;
}

function matchesSpecificationFilters(product, filters) {
  return Object.keys(filters).every(function(name) {
    var specification = (product.specifications || []).find(function(item) { return item.name === name; });
    return specification && filters[name].some(function(value) { return (specification.values || []).indexOf(value) !== -1; });
  });
}

async function getFavoriteIds(req) {
  if (!req.session.user) return [];
  var user = await User.findById(req.session.user.id).select('favorites');
  return user ? (user.favorites || []).map(function(id) { return String(id); }) : [];
}

/* GET home page. */
router.get('/', async function(req, res, next) {
  try {
    var homeProducts = await Product.find().populate('components.product').sort({ createdAt: -1 }).limit(8);
    var settings = await SiteSettings.findOne({ key: 'main' }) || {};
    var today = new Date();
    var todayString = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var meetings = await Meeting.find({ date: { $gte: todayString }, status: { $in: ['requested', 'confirmed', 'unavailable'] } }).select('date time status');
    var queryMessages = {
      solicitada: 'Sua reunião foi solicitada.',
      ocupado: 'Esse horário acabou de ser ocupado. Escolha outro horário.',
      erro: 'Escolha uma data e um horário disponíveis.',
      bloqueado: 'O horário foi marcado como indisponível.',
      liberado: 'O horário voltou a ficar disponível.',
      admin: 'Administradores usam esta agenda para marcar indisponibilidades.'
    };
    res.render('index', { title: 'Express', homeProducts: await inventory.getProductsAvailability(homeProducts), favoriteIds: await getFavoriteIds(req), settings: settings, homeCarouselImages: settings.homeCarouselImages && settings.homeCarouselImages.length ? settings.homeCarouselImages : defaultHomeCarouselImages, meetingHours: meetingHoursConfig.getMeetingHours(settings.meetingHours), schedulerMeetings: meetings.map(function(meeting) { return { date: meeting.date, time: meeting.time, status: meeting.status }; }), schedulerMessage: queryMessages[req.query.reuniao] || '' });
  } catch (error) { next(error); }
});

router.get('/catalogo', async function(req, res, next) {
  var requestedState = String(req.query.estado || 'brinquedos');
  var selectedState = Object.prototype.hasOwnProperty.call(catalogStates, requestedState) ? requestedState : 'brinquedos';
  try {
    var selectedCategory = catalogStates[selectedState];
    var rawProducts = await Product.find({ category: { $in: selectedCategory.categories } }).populate('components.product').sort({ name: 1 });
    var products = await inventory.getProductsAvailability(rawProducts);
    var searchQuery = String(req.query.busca || '').trim();
    var settings = await SiteSettings.findOne({ key: 'main' }).select('productSubcategories');
    var subcategoryNames = [];
    (settings && settings.productSubcategories || []).forEach(function(item) {
      if (selectedCategory.categories.indexOf(item.category) !== -1 && !subcategoryNames.some(function(name) { return name.toLocaleLowerCase() === item.name.toLocaleLowerCase(); })) subcategoryNames.push(item.name);
    });
    products.forEach(function(product) {
      (product.subcategories || []).forEach(function(name) {
        if (!subcategoryNames.some(function(existing) { return existing.toLocaleLowerCase() === name.toLocaleLowerCase(); })) subcategoryNames.push(name);
      });
    });
    var subcategoryRows = subcategoryNames.sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function(name) {
      return { name: name, slug: slugifySubcategory(name), products: products.filter(function(product) { return (product.subcategories || []).some(function(item) { return item.toLocaleLowerCase() === name.toLocaleLowerCase(); }); } ) };
    }).filter(function(row) { return row.products.length > 0; });
    if (searchQuery) products = products.filter(function(product) { return (product.name + ' ' + (product.description || '')).toLocaleLowerCase().indexOf(searchQuery.toLocaleLowerCase()) !== -1; });
    res.render('catalogo', {
      title: selectedCategory.title,
      selectedState: selectedState,
      selectedCategory: selectedCategory.label,
      categoryTitle: selectedCategory.title,
      selectedSubcategoryTitle: searchQuery ? 'Pesquisa: ' + searchQuery : '',
      searchQuery: searchQuery,
      searchAction: '/catalogo',
      searchState: selectedState,
      products: products,
      favoriteIds: await getFavoriteIds(req),
      subcategoryRows: subcategoryRows,
      listingMode: Boolean(searchQuery),
      favoritesOnly: false
    });
  } catch (error) { next(error); }
});

router.get('/pesquisa/sugestoes', async function(req, res) {
  try {
    var query = String(req.query.q || '').trim();
    if (query.length < 2) return res.json({ products: [] });
    var products = await Product.find().select('name description imageUrl category specifications subcategories').lean();
    var suggestions = products.map(function(product) { return { product: product, score: searchScore(product, query) }; })
      .filter(function(item) { return item.score > 0; })
      .sort(function(a, b) { return b.score - a.score || a.product.name.localeCompare(b.product.name, 'pt-BR'); })
      .slice(0, 3)
      .map(function(item) { return item.product; });
    res.json({ products: suggestions });
  } catch (error) {
    console.error('Erro ao buscar sugestões:', error);
    res.status(500).json({ products: [] });
  }
});

router.get('/pesquisa', async function(req, res, next) {
  try {
    var query = String(req.query.q || '').trim();
    if (!query) return res.redirect('/catalogo');
    var rawProducts = await Product.find().populate('components.product');
    var matches = rawProducts.map(function(product) { return { product: product, score: searchScore(product, query) }; })
      .filter(function(item) { return item.score > 0; })
      .sort(function(a, b) { return b.score - a.score || a.product.name.localeCompare(b.product.name, 'pt-BR'); });
    var matchedProducts = matches.map(function(item) { return item.product; });
    var facets = {};
    matchedProducts.forEach(function(product) {
      (product.specifications || []).forEach(function(specification) {
        if (!facets[specification.name]) facets[specification.name] = [];
        (specification.values || []).forEach(function(value) {
          if (!facets[specification.name].some(function(existing) { return existing.value === value; })) {
            facets[specification.name].push({ value: value, count: matchedProducts.filter(function(candidate) {
              var candidateSpec = (candidate.specifications || []).find(function(item) { return item.name === specification.name; });
              return candidateSpec && (candidateSpec.values || []).indexOf(value) !== -1;
            }).length });
          }
        });
      });
    });
    Object.keys(facets).forEach(function(name) { facets[name].sort(function(a, b) { return a.value.localeCompare(b.value, 'pt-BR'); }); });
    var selectedFilters = selectedSpecificationFilters(req.query.spec);
    var filteredProducts = matchedProducts.filter(function(product) { return matchesSpecificationFilters(product, selectedFilters); });
    var products = await inventory.getProductsAvailability(filteredProducts);
    var sortOrder = String(req.query.ordenar || 'relevancia');
    if (sortOrder === 'nome-asc') products.sort(function(a, b) { return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }); });
    else if (sortOrder === 'nome-desc') products.sort(function(a, b) { return b.name.localeCompare(a.name, 'pt-BR', { sensitivity: 'base' }); });
    else if (sortOrder === 'preco-asc') products.sort(function(a, b) { return Number(a.price) - Number(b.price); });
    else if (sortOrder === 'preco-desc') products.sort(function(a, b) { return Number(b.price) - Number(a.price); });
    else if (sortOrder === 'disponibilidade') products.sort(function(a, b) { return Number(b.availableUnits) - Number(a.availableUnits); });
    else sortOrder = 'relevancia';
    res.render('pesquisa', { title: 'Resultados da pesquisa', searchQuery: query, products: products, selectedSortOrder: sortOrder, specificationFacets: Object.keys(facets).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function(name) { return { name: name, values: facets[name] }; }), selectedSpecifications: selectedFilters });
  } catch (error) { next(error); }
});

router.get('/catalogo/:estado/:subcategoria', async function(req, res, next) {
  var selectedState = String(req.params.estado || '');
  var category = catalogStates[selectedState];
  if (!category) return res.status(404).render('erro', { title: 'Categoria não encontrada', message: 'Esta categoria não existe.', error: {}, status: 404 });
  try {
    var rawProducts = await Product.find({ category: { $in: category.categories } }).populate('components.product').sort({ name: 1 });
    var categoryProducts = await inventory.getProductsAvailability(rawProducts);
    var requestedSubcategory = String(req.params.subcategoria || '');
    var isGeneral = requestedSubcategory === 'geral';
    var selectedProducts = isGeneral ? categoryProducts : categoryProducts.filter(function(product) {
      return (product.subcategories || []).some(function(name) { return slugifySubcategory(name) === requestedSubcategory; });
    });
    var selectedSubcategoryTitle = isGeneral ? 'Todos os produtos' : (selectedProducts[0] && (selectedProducts[0].subcategories || []).find(function(name) { return slugifySubcategory(name) === requestedSubcategory; })) || requestedSubcategory.replace(/-/g, ' ');
    var searchQuery = String(req.query.busca || '').trim();
    if (searchQuery) selectedProducts = selectedProducts.filter(function(product) { return (product.name + ' ' + (product.description || '')).toLocaleLowerCase().indexOf(searchQuery.toLocaleLowerCase()) !== -1; });
    res.render('catalogo', {
      title: (isGeneral ? category.title + ' - Todos os produtos' : selectedSubcategoryTitle) + (searchQuery ? ' - Pesquisa' : ''),
      selectedState: selectedState,
      selectedCategory: category.label,
      categoryTitle: category.title,
      selectedSubcategoryTitle: searchQuery ? selectedSubcategoryTitle + ' — Pesquisa: ' + searchQuery : selectedSubcategoryTitle,
      searchQuery: searchQuery,
      searchAction: '/catalogo/' + selectedState + '/' + requestedSubcategory,
      products: selectedProducts,
      categoryHasProducts: categoryProducts.length > 0,
      favoriteIds: await getFavoriteIds(req),
      subcategoryRows: [],
      listingMode: true,
      favoritesOnly: false
    });
  } catch (error) { next(error); }
});

router.get('/favoritos', async function(req, res, next) {
  if (!req.session.user) return res.redirect('/entrar?returnTo=' + encodeURIComponent(req.originalUrl));
  try {
    var favoriteIds = await getFavoriteIds(req);
    var products = await Product.find({ _id: { $in: favoriteIds } }).populate('components.product').sort({ name: 1 });
    var searchQuery = String(req.query.busca || '').trim();
    if (searchQuery) products = products.filter(function(product) { return (product.name + ' ' + (product.description || '')).toLocaleLowerCase().indexOf(searchQuery.toLocaleLowerCase()) !== -1; });
    res.render('catalogo', {
      title: 'Favoritos',
      selectedState: 'brinquedos',
      selectedCategory: 'brinquedo',
      searchQuery: searchQuery,
      searchAction: '/favoritos',
      products: await inventory.getProductsAvailability(products),
      favoriteIds: favoriteIds,
      favoritesOnly: true
    });
  } catch (error) { next(error); }
});

router.post('/favoritos/toggle', async function(req, res, next) {
  if (!req.session.user) {
    var returnTo = String(req.body.returnTo || '/catalogo');
    if (returnTo.charAt(0) !== '/' || returnTo.charAt(1) === '/') returnTo = '/catalogo';
    return res.status(401).json({ ok: false, loginUrl: '/entrar?returnTo=' + encodeURIComponent(returnTo) });
  }
  try {
    var productId = String(req.body.productId || '');
    if (!/^[a-f0-9]{24}$/i.test(productId)) return res.status(400).json({ ok: false, message: 'Produto inválido.' });
    var product = await Product.findById(productId).select('_id');
    if (!product) return res.status(404).json({ ok: false, message: 'Este produto não está mais disponível.' });
    var user = await User.findById(req.session.user.id).select('favorites');
    if (!user) return res.status(401).json({ ok: false, loginUrl: '/entrar?returnTo=' + encodeURIComponent('/catalogo') });
    var alreadyFavorite = (user.favorites || []).some(function(id) { return String(id) === productId; });
    if (alreadyFavorite) user.favorites.pull(product._id);
    else user.favorites.addToSet(product._id);
    await user.save();
    res.json({ ok: true, favorited: !alreadyFavorite, productId: productId });
  } catch (error) { next(error); }
});

router.get('/produto/:id/semelhantes', async function(req, res, next) {
  try {
    var product = await Product.findById(req.params.id);
    if (!product) return res.status(404).render('erro', { title: 'Produto não encontrado', message: 'Este produto não está disponível.', error: {}, status: 404 });
    var categoryKey = Object.keys(catalogStates).find(function(key) { return catalogStates[key].categories.indexOf(product.category) !== -1; }) || 'brinquedos';
    var category = catalogStates[categoryKey];
    var similarProducts = await Product.find({ category: product.category, _id: { $ne: product._id } }).populate('components.product').sort({ name: 1 });
    res.render('catalogo', {
      title: 'Produtos semelhantes a ' + product.name,
      selectedState: categoryKey,
      selectedCategory: category.label,
      categoryTitle: category.title,
      selectedSubcategoryTitle: 'Semelhantes a ' + product.name,
      products: await inventory.getProductsAvailability(similarProducts),
      favoriteIds: await getFavoriteIds(req),
      subcategoryRows: [],
      listingMode: true,
      favoritesOnly: false
    });
  } catch (error) { next(error); }
});

router.get('/produto/:id', async function(req, res, next) {
  try {
    var product = await inventory.findProductGraph(req.params.id);
    if (!product) return res.status(404).render('erro', { title: 'Produto não encontrado', message: 'Este produto não está disponível.', error: {}, status: 404 });
    product.availableUnits = inventory.availableUnits(product);
    var similarProducts = await Product.find({ category: product.category, _id: { $ne: product._id } }).limit(8);
    res.render('produto', { title: product.name, product: product, similarProducts: similarProducts, favoriteIds: await getFavoriteIds(req) });
  } catch (error) { next(error); }
});

router.get('/entrar', async function(req, res, next) {
  var returnTo = String(req.query.returnTo || '/');
  var settings = {};
  if (database.getConnectionState() === 'conectado') {
    try { settings = await SiteSettings.findOne({ key: 'main' }) || {}; }
    catch (error) {
      if (database.getConnectionState() === 'conectado' && error.name !== 'MongooseError') return next(error);
    }
  }
  res.render('entrar', { title: 'Entrar', settings: settings, returnTo: returnTo.charAt(0) === '/' && returnTo.charAt(1) !== '/' ? returnTo : '/' });
});

router.get('/cadastro', function(req, res, next) {
  res.render('cadastro', { title: 'Criar conta' });
});

router.get('/perfil', async function(req, res, next) {
  if (!req.session.user) return res.redirect('/entrar');
  try { res.render('perfil', { title: 'Meu perfil', profile: await User.findById(req.session.user.id) }); } catch (error) { next(error); }
});

module.exports = router;
