var mongoose = require('mongoose');

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

module.exports = mongoose.model('Product', productSchema);
