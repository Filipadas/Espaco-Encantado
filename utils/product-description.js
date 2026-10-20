/*
 * Teste lógico: a descrição de um produto precisa terminar com ponto final.
 * Caso o admin esqueça de colocar o ponto (ou o texto venha sem ele),
 * o "." é adicionado automaticamente. Textos vazios/ausentes são mantidos como estão.
 */
function withFinalPeriod(value) {
  if (value === null || value === undefined) return value;

  var text = String(value).replace(/\s+$/, '');
  if (!text) return text;

  var lastCharacter = text.charAt(text.length - 1);
  // Já termina com pontuação final: ponto, exclamação, interrogação ou reticências.
  if ('.!?…'.indexOf(lastCharacter) !== -1) return text;

  return text + '.';
}

module.exports = withFinalPeriod;
module.exports.withFinalPeriod = withFinalPeriod;
