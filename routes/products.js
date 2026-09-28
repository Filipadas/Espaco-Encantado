var express = require('express');
var router = express.Router();
var Product = require('../models/Product');
var database = require('../config/database');
var { requireAdmin } = require('../middleware/auth');

router.get('/health', function(req, res) {
  res.json({ database: database.getConnectionState() });
});

router.get('/', requireAdmin, async function(req, res, next) {
  try {
    var products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    next(error);
  }
});

router.post('/', requireAdmin, async function(req, res, next) {
  try {
    var product = await Product.create({
      name: req.body.name,
      category: req.body.category,
      price: req.body.price
    });
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
