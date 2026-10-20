var mongoose = require('mongoose');
var withFinalPeriod = require('../utils/product-description');

var productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['brinquedos', 'decoracoes', 'kit-montagem', 'festa-infantil']
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  description: {
    type: String,
    trim: true
  },
  imageUrl: {
    type: String,
    trim: true,
    default: ''
  },
  imageUrls: [{ type: String, trim: true }],
  specifications: [{
    name: { type: String, trim: true },
    values: [{ type: String, trim: true }]
  }],
  subcategories: [{ type: String, trim: true }],
  allowCustomText: {
    type: Boolean,
    default: false
  },
  predefinedCustomText: {
    type: String,
    trim: true,
    default: ''
  },
  stockTotal: {
    type: Number,
    min: 0,
    default: 0
  },
  rentedQuantity: {
    type: Number,
    min: 0,
    default: 0
  },
  components: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    category: {
      type: String,
      enum: ['brinquedos', 'decoracoes'],
      required: true
    },
    quantity: {
      type: Number,
      min: 1,
      required: true
    }
  }]
}, {
  timestamps: true
});

// Garante que a descrição sempre termine com ponto final, mesmo que o admin esqueça de colocar.
productSchema.pre('save', function() {
  if (typeof this.description === 'string' && this.description.trim()) {
    this.description = withFinalPeriod(this.description);
  }
});

module.exports = mongoose.model('Product', productSchema);
