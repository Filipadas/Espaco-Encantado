var mongoose = require('mongoose');

var userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  phone: String,
  address: String,
  city: String,
  state: String,
  imageUrl: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
