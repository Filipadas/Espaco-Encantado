var mongoose = require('mongoose');

var settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  loginWelcome: { type: String, default: 'Entre para continuar criando momentos inesquecíveis.' },
  loginSubtitle: { type: String, default: 'Acesse sua conta Espaço Encantado.' },
  meetingHours: { type: String, default: '08:00, 09:00, 10:00, 11:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00' },
  salonHours: { type: String, default: 'Segunda: 13h30 - 18h00\nTerça a sexta: 08h00 - 18h00\nSábado: 08h00 - 12h00\nDomingo: Fechado' },
  productSpecifications: [{
    name: { type: String, trim: true },
    values: [{ type: String, trim: true }]
  }],
  productSpecificationsInitialized: { type: Boolean, default: false },
  productSubcategories: [{
    category: { type: String, trim: true },
    name: { type: String, trim: true }
  }]
}, { timestamps: true });

module.exports = mongoose.model('SiteSettings', settingsSchema);
