const limpar = (v) => (typeof v === 'string' ? v.trim() : '');

const textoValido = (v, max = 200) => v.length > 0 && v.length <= max;

function normalizarTelefone(valor) {
  if (typeof valor !== 'string') return null;
  const digitos = valor.replace(/\D/g, '');
  let e164;

  if (valor.trim().startsWith('+')) {
    e164 = '+' + digitos;
  } else if (digitos.length === 10 || digitos.length === 11) {
    e164 = '+55' + digitos;
  } else if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    e164 = '+' + digitos;
  } else {
    return null;
  }
  return /^\+[1-9]\d{10,14}$/.test(e164) ? e164 : null;
}

function horaValida(hora) {
  return typeof hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
}

module.exports = { limpar, textoValido, normalizarTelefone, horaValida };
