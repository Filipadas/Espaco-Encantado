var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/catalogo', function(req, res, next) {
  var states = {
    brinquedos: 'brinquedo',
    decoracoes: 'decoração',
    'kit-montagem': 'kit-mont',
    'festa-infantil': 'infantil'
  };
  var requestedState = String(req.query.estado || 'brinquedos');
  var selectedState = Object.prototype.hasOwnProperty.call(states, requestedState) ? requestedState : 'brinquedos';
  res.render('catalogo', {
    title: 'Catálogo',
    selectedState: selectedState,
    selectedCategory: states[selectedState]
  });
});

router.get('/login', function(req, res, next) {
  res.render('login', { title: 'Entrar' });
});

router.get('/cadastro', function(req, res, next) {
  res.render('cadastro', { title: 'Criar conta' });
});

module.exports = router;
