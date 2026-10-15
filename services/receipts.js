function formatDate(value) {
  if (!value) return 'Não informada';
  var parts = String(value).split('-');
  return parts.length === 3 ? parts.reverse().join('/') : String(value);
}

function formatCurrency(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

async function ensureRentalReceipt(rental) {
  if (rental.invoiceGenerated && rental.invoiceNumber && rental.invoiceGeneratedAt) return rental;
  rental.invoiceGenerated = true;
  rental.invoiceNumber = rental.invoiceNumber || 'EE-' + new Date().getFullYear() + '-' + String(rental._id).slice(-8).toUpperCase();
  rental.invoiceGeneratedAt = rental.invoiceGeneratedAt || new Date();
  await rental.save();
  return rental;
}

async function getReceiptViewData(rental) {
  await ensureRentalReceipt(rental);
  await rental.populate('user');
  var invoiceTotal = (rental.items || []).reduce(function(total, item) {
    return total + Number(item.price || 0) * Number(item.quantity || 0);
  }, 0);
  var invoiceItems = (rental.items || []).map(function(item) {
    return {
      name: item.name,
      quantity: item.quantity,
      dateFormatted: formatDate(item.date),
      lineTotalFormatted: formatCurrency(Number(item.price || 0) * Number(item.quantity || 0))
    };
  });
  return {
    title: 'Comprovante de locação',
    rental: rental,
    invoiceTotalFormatted: formatCurrency(invoiceTotal),
    invoiceItems: invoiceItems,
    deliveryDateFormatted: formatDate(rental.deliveryDate),
    invoiceDate: (rental.invoiceGeneratedAt || rental.createdAt || new Date()).toLocaleDateString('pt-BR')
  };
}

module.exports = { ensureRentalReceipt: ensureRentalReceipt, getReceiptViewData: getReceiptViewData };
