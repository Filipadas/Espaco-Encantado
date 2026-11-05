var express = require('express');
var path = require('path');
require('dotenv').config();
var session = require('express-session');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var createError = require('http-errors');
var database = require('./config/database');
var siteSettings = require('./utils/site-settings');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var productsRouter = require('./routes/products');
var authRouter = require('./routes/auth');
var adminRouter = require('./routes/admin');
var cartRouter = require('./routes/cart');
var meetingsRouter = require('./routes/meetings');

var app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY));

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
// Disponível nas views: garante que a descrição do produto sempre termine com ponto final.
app.locals.withFinalPeriod = require('./utils/product-description');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'espaco-encantado-teste',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8,
    sameSite: process.env.APPLE_REDIRECT_URI ? 'none' : 'lax',
    secure: process.env.APPLE_REDIRECT_URI ? 'auto' : false
  }
}));
app.use(function(req, res, next) {
  res.locals.currentPath = req.path;
  res.locals.whatsappNumber = siteSettings.defaultSettings.whatsappNumber;
  res.locals.whatsappDisplayNumber = siteSettings.formatWhatsAppNumber(siteSettings.defaultSettings.whatsappNumber);
  res.locals.instagramUrl = siteSettings.defaultSettings.instagramUrl;
  res.locals.facebookUrl = siteSettings.defaultSettings.facebookUrl;
  res.locals.storeAddress = siteSettings.defaultSettings.storeAddress;
  res.locals.currentUser = req.session.user || null;
  res.locals.isAdmin = Boolean(req.session.user && req.session.user.role === 'admin');
  res.locals.isAdminPanel = req.path.indexOf('/admin') === 0;
  res.locals.isCatalogPage = req.path === '/catalogo' || req.path === '/favoritos';
  res.locals.isProductPage = req.path.indexOf('/produto/') === 0;
  res.locals.isLogoutPage = req.path === '/sair';
  res.locals.isDeleteAccountPage = req.path === '/usuarios/excluir';
  res.locals.isPasswordRecoveryPage = req.path.indexOf('/recuperar-senha') === 0;
  res.locals.isRequestPage = req.path.indexOf('/admin/solicitacoes') === 0;
  res.locals.hideNavbar = req.path.indexOf('/admin/agenda') === 0;
  res.locals.adminBackUrl = req.path === '/admin' ? '/' : '/admin';
  res.locals.adminBackLabel = req.path === '/admin' ? 'Voltar para a tela inicial' : 'Voltar para o painel administrativo';
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Carrega os dados de contato configurados pelo administrador (WhatsApp e redes sociais).
app.use(async function(req, res, next) {
  try {
    var settings = await siteSettings.getSiteSettings();
    res.locals.whatsappNumber = settings.whatsappNumber;
    res.locals.whatsappDisplayNumber = siteSettings.formatWhatsAppNumber(settings.whatsappNumber);
    res.locals.instagramUrl = settings.instagramUrl;
    res.locals.facebookUrl = settings.facebookUrl;
    res.locals.storeAddress = settings.storeAddress;
  } catch (error) {
    console.error('Não foi possível carregar os dados de contato do site:', error.message);
  }
  next();
});

database.connectDatabase();

app.use('/', indexRouter);
app.use('/usuarios', usersRouter);
app.use('/api/produtos', productsRouter);
app.use('/', authRouter);
app.use('/admin', adminRouter);
app.use('/sacola', cartRouter);
app.use('/reunioes', meetingsRouter);

//Página de error 404
app.use(function(req, res, next) {
  next(createError(404));
});


app.use(function(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('erro', {
    title: 'Erro',
    message: res.locals.message,
    error: res.locals.error,
    status: err.status || 500
  });
});

if (require.main === module) {
  var http = require('http');
  var port = process.env.PORT || '3000';
  app.set('port', port);

  var server = http.createServer(app);
  server.listen(port, function() {
    console.log('Server running on http://localhost:' + port);
  });
}

module.exports = app;

