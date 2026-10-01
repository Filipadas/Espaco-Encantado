var mongoose = require('mongoose');

var rentalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    date: { type: String, required: true }
  }],
  reservedComponents: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 }
  }],
  dates: [{ type: String }],
  salonRental: { type: Boolean, default: false },
  salonDate: String,
  salonTime: String,
  deliveryChecked: { type: Boolean, default: false },
  returnChecked: { type: Boolean, default: false },
  deliveredItems: [{ type: mongoose.Schema.Types.ObjectId }],
  returnedItems: [{ type: mongoose.Schema.Types.ObjectId }],
  invoiceGenerated: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'returned', 'cancelled'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('Rental', rentalSchema);
