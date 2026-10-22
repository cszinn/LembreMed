const { OAuth2Client } = require('google-auth-library');
const config = require('../config');

let cliente;

// Confere a credencial (ID token) que o botão "Entrar com Google" entrega ao painel: assinatura do
// Google, validade e se foi emitida para o nosso GOOGLE_CLIENT_ID. Lança erro se algo não bater.
async function verificarCredencialGoogle(credencial) {
  if (!cliente) cliente = new OAuth2Client(config.google.clientId);
  const ticket = await cliente.verifyIdToken({ idToken: credencial, audience: config.google.clientId });
  const p = ticket.getPayload();
  return {
    googleId: p.sub,
    email: String(p.email || '').toLowerCase(),
    emailVerificado: p.email_verified === true,
    nome: p.name || p.email,
  };
}

module.exports = { verificarCredencialGoogle };
