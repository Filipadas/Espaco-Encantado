var SiteSettings = require('../models/SiteSettings');
var database = require('../config/database');
var business = require('../config/business');

var defaultSettings = {
  whatsappNumber: business.whatsappNumber,
  instagramUrl: 'https://www.instagram.com/espacoencantadodec/',
  facebookUrl: 'https://www.facebook.com/p/Espaço-Encantado-Decorações-e-artigos-de-festa-em-geral-100063738723297/',
  storeAddress: 'Rua Ricardo Inácio - Praia Grande, SC'
};

// Guarda apenas os dígitos e garante o código do país (55) em números brasileiros.
function normalizeWhatsAppNumber(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.indexOf('55') === 0 && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function formatWhatsAppNumber(value) {
  var digits = normalizeWhatsAppNumber(value);
  if (!digits) return '';
  var local = digits.indexOf('55') === 0 && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return '+55 (' + local.slice(0, 2) + ') ' + local.slice(2, 7) + '-' + local.slice(7);
  if (local.length === 10) return '+55 (' + local.slice(0, 2) + ') ' + local.slice(2, 6) + '-' + local.slice(6);
  return '+' + digits;
}

// Retorna '' para campo vazio e null quando o link informado não é válido.
function sanitizeSocialUrl(value) {
  var url = String(value || '').trim();
  if (!url) return '';
  if (/^@[\w.]+$/.test(url)) return 'https://www.instagram.com/' + url.slice(1) + '/';
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    var parsed = new URL(url);
    if (['http:', 'https:'].indexOf(parsed.protocol) === -1) return null;
    if (!parsed.hostname || parsed.hostname.indexOf('.') === -1) return null;
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

async function getSiteSettings() {
  if (database.getConnectionState() !== 'conectado') return Object.assign({}, defaultSettings);
  try {
    var settings = await SiteSettings.findOne({ key: 'main' }).lean();
    return {
      whatsappNumber: normalizeWhatsAppNumber(settings && settings.whatsappNumber) || defaultSettings.whatsappNumber,
      instagramUrl: settings && typeof settings.instagramUrl === 'string' ? settings.instagramUrl : defaultSettings.instagramUrl,
      facebookUrl: settings && typeof settings.facebookUrl === 'string' ? settings.facebookUrl : defaultSettings.facebookUrl,
      storeAddress: settings && typeof settings.storeAddress === 'string' ? settings.storeAddress : defaultSettings.storeAddress
    };
  } catch (error) {
    console.error('Não foi possível carregar as configurações do site:', error.message);
    return Object.assign({}, defaultSettings);
  }
}

module.exports = {
  defaultSettings: defaultSettings,
  normalizeWhatsAppNumber: normalizeWhatsAppNumber,
  formatWhatsAppNumber: formatWhatsAppNumber,
  sanitizeSocialUrl: sanitizeSocialUrl,
  getSiteSettings: getSiteSettings
};
