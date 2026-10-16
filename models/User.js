var mongoose = require('mongoose');

var userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  googleId: { type: String, sparse: true },
  appleId: { type: String, sparse: true },
  phone: String,
  address: String,
  city: String,
  state: String,
  cep: String,
  profileImage: { type: String, default: '' },
  addresses: [{
    label: String,
    address: String,
    city: String,
    state: String,
    cep: String
  }],
  cart: [{
    productId: { type: String, required: true },
    name: String,
    price: Number,
    imageUrl: String,
    quantity: { type: Number, min: 1, default: 1 },
    requestDate: String
  }],
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

