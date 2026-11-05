var mongoose = require('mongoose');
var defaultHomeCarouselImages = require('../config/home-carousel-images');
var business = require('../config/business');

var settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'main' },
  loginWelcome: { type: String, default: 'Entre para continuar criando momentos inesquecíveis.' },
  loginSubtitle: { type: String, default: 'Acesse sua conta Espaço Encantado.' },
  whatsappNumber: { type: String, default: business.whatsappNumber },
  instagramUrl: { type: String, default: 'https://www.instagram.com/espacoencantadodec/' },
  facebookUrl: { type: String, default: 'https://www.facebook.com/p/Espaço-Encantado-Decorações-e-artigos-de-festa-em-geral-100063738723297/' },
  storeAddress: { type: String, default: 'Rua Ricardo Inácio - Praia Grande, SC' },
  meetingHours: { type: String, default: '08:00, 09:00, 10:00, 11:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00' },
  salonHours: { type: String, default: 'Segunda: 13h30 - 18h00\nTerça a sexta: 08h00 - 18h00\nSábado: 08h00 - 12h00\nDomingo: Fechado' },
  homeCarouselImages: { type: [String], default: function() { return defaultHomeCarouselImages.slice(); } },
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
