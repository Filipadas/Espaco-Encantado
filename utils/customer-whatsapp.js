function normalizePhone(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits.length >= 12 && digits.length <= 13 ? digits : '';
}

function customerWhatsAppUrl(customer, messageLines) {
  var phone = normalizePhone(customer && customer.phone);
  if (!phone) return null;
  var greeting = 'Olá, ' + String(customer.name || 'tudo bem').trim() + '! Aqui é da equipe Espaço Encantado.';
  var message = [greeting, '', ...messageLines].join('\n');
  return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message);
}

module.exports = { customerWhatsAppUrl: customerWhatsAppUrl };
