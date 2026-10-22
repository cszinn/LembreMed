const limpar = (v) => (typeof v === 'string' ? v.trim() : '');

const textoValido = (v, max = 200) => v.length > 0 && v.length <= max;

// Só aceita telefones do Brasil (o sistema liga e manda SMS pela conta da Twilio; número de outro
// país seria custo e risco de abuso). Formato: DDD + fixo (8 dígitos, começa com 2 a 5)
// ou celular (9 dígitos, começa com 9). Aceita "(31) 98888-7777", "031 98888-7777" e "+55 31 98888-7777".
function normalizarTelefone(valor) {
  if (typeof valor !== 'string') return null;
  let digitos = valor.replace(/\D/g, '');

  if (valor.trim().startsWith('+') || ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55'))) {
    if (!digitos.startsWith('55')) return null;
    digitos = digitos.slice(2);
  } else if (digitos.startsWith('0')) {
    digitos = digitos.slice(1); // prefixo de interurbano: 031...
  }

  const celular = /^[1-9]{2}9\d{8}$/.test(digitos);
  const fixo = /^[1-9]{2}[2-5]\d{7}$/.test(digitos);
  return celular || fixo ? '+55' + digitos : null;
}

function horaValida(hora) {
  return typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
}

module.exports = { limpar, textoValido, normalizarTelefone, horaValida };
