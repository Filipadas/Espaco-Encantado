var mongoose = require('mongoose');

var meetingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  status: { type: String, enum: ['requested', 'confirmed', 'cancelled'], default: 'requested' }
}, { timestamps: true });

module.exports = mongoose.model('Meeting', meetingSchema);
