const twilio = require('twilio');
const config = require('../config');

// Confirma que a requisição veio da Twilio, conferindo o cabeçalho X-Twilio-Signature.
// A Twilio assina a URL COMPLETA (incluindo ?ids=...) + os parâmetros do corpo com o Auth Token.
// Como o servidor fica atrás do ngrok, a URL é montada a partir de BASE_URL (a mesma usada ao criar a ligação).
function validarAssinaturaTwilio(req, res, next) {
  if (!config.validarAssinaturaTwilio) return next();

  if (!config.twilio.authToken || !config.baseUrl) {
    console.error('[twilio] não foi possível validar o webhook: configure TWILIO_AUTH_TOKEN e BASE_URL no .env');
    return res.status(500).type('text/plain').send('Servidor mal configurado.');
  }

  const assinatura = req.get('X-Twilio-Signature') || '';
  const url = `${config.baseUrl}${req.originalUrl}`;
  const valida = twilio.validateRequest(config.twilio.authToken, assinatura, url, req.body || {});

  if (!valida) {
    console.warn(`[twilio] assinatura inválida, requisição rejeitada: ${req.method} ${req.originalUrl}`);
    return res.status(403).type('text/plain').send('Assinatura inválida.');
  }
  next();
}

module.exports = validarAssinaturaTwilio;
