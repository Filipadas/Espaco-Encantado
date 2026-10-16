var https = require('https');

function lookupCep(value) {
  var cep = String(value || '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(cep)) return Promise.resolve(null);

  return new Promise(function(resolve, reject) {
    var request = https.get('https://viacep.com.br/ws/' + cep + '/json/', function(response) {
      var body = '';
      response.setEncoding('utf8');
      response.on('data', function(chunk) { body += chunk; });
      response.on('end', function() {
        if (response.statusCode !== 200) return reject(new Error('Não foi possível consultar o CEP.'));
        try {
          var result = JSON.parse(body);
          if (result.erro || !result.localidade || !result.uf) return resolve(null);
          resolve({ cep: cep.slice(0, 5) + '-' + cep.slice(5), city: result.localidade, state: result.uf });
        } catch (error) { reject(new Error('Resposta inválida ao consultar o CEP.')); }
      });
    });
    request.setTimeout(5000, function() { request.destroy(new Error('Tempo esgotado ao consultar o CEP.')); });
    request.on('error', reject);
  });
}

module.exports = { lookupCep: lookupCep };
