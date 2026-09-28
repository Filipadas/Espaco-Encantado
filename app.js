var express = require('express');
var path = require('path');
require('dotenv').config();
var session = require('express-session');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var createError = require('http-errors');
var database = require('./config/database');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var productsRouter = require('./routes/products');
var authRouter = require('./routes/auth');
var adminRouter = require('./routes/admin');
var cartRouter = require('./routes/cart');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'espaco-encantado-teste',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(function(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.isAdmin = Boolean(req.session.user && req.session.user.role === 'admin');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

database.connectDatabase();

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/api/products', productsRouter);
app.use('/', authRouter);
app.use('/admin', adminRouter);
app.use('/sacola', cartRouter);

//Página de error 404
app.use(function(req, res, next) {
  next(createError(404));
});


app.use(function(err, req, res, next) {
  
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);
  res.render('error', {
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
