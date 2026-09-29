var Product = require('../models/Product');

function productId(product) {
  return String(product._id || product.product || product);
}

function isComposite(product) {
  return Array.isArray(product.components) && product.components.length > 0;
}

function expandProduct(product, quantity, expanded, stack) {
  var id = productId(product);
  var path = stack || [];
  if (path.indexOf(id) !== -1) throw new Error('O kit possui componentes circulares.');

  if (!isComposite(product)) {
    expanded[id] = (expanded[id] || 0) + quantity;
    return;
  }

  product.components.forEach(function(component) {
    var componentProduct = component.product;
    if (!componentProduct || !componentProduct._id) throw new Error('Um componente do kit não foi encontrado.');
    expandProduct(componentProduct, quantity * Number(component.quantity || 1), expanded, path.concat(id));
  });
}

async function findProductGraph(id) {
  return Product.findById(id).populate('components.product');
}

function availableUnits(product) {
  if (!isComposite(product)) {
    return Math.max(0, (Number(product.stockTotal) || 0) - (Number(product.rentedQuantity) || 0));
  }

  return product.components.reduce(function(available, component) {
    var componentAvailable = availableUnits(component.product);
    return Math.min(available, Math.floor(componentAvailable / Number(component.quantity || 1)));
  }, Infinity);
}

async function getProductsAvailability(products) {
  return Promise.all(products.map(async function(product) {
    var graph = product.components ? product : await findProductGraph(product._id);
    product.availableUnits = availableUnits(graph);
    product.isComposite = isComposite(graph);
    return product;
  }));
}

module.exports = {
  availableUnits: availableUnits,
  expandProduct: expandProduct,
  findProductGraph: findProductGraph,
  getProductsAvailability: getProductsAvailability,
  isComposite: isComposite
};
