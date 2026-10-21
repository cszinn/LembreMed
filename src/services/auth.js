const crypto = require('crypto');

// Chave secreta para assinar os tokens (lê de variável ou gera uma padrão consistente)
const SECRET = process.env.JWT_SECRET || 'lembremed_secret_cuidador_auth_key_2026';

function hashSenha(senha) {
  if (!senha || typeof senha !== 'string') {
    throw new Error('Senha deve ser uma string não vazia.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verificarSenha(senha, senhaHash) {
  if (!senha || !senhaHash || !senhaHash.includes(':')) return false;
  const [salt, hashOriginal] = senhaHash.split(':');
  const hashTentativa = crypto.scryptSync(senha, salt, 64).toString('hex');
  const bufOriginal = Buffer.from(hashOriginal, 'hex');
  const bufTentativa = Buffer.from(hashTentativa, 'hex');
  if (bufOriginal.length !== bufTentativa.length) return false;
  return crypto.timingSafeEqual(bufOriginal, bufTentativa);
}

function gerarToken(cuidador) {
  const payload = {
    id: cuidador.id,
    email: cuidador.email,
    nome: cuidador.nome,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 dias
  };
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(b64Payload);
  const assinatura = hmac.digest('base64url');
  return `${b64Payload}.${assinatura}`;
}

function verificarToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64Payload, assinatura] = token.split('.');
  
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(b64Payload);
  const assinaturaEsperada = hmac.digest('base64url');

  if (assinatura !== assinaturaEsperada) return null;

  try {
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null; // expirado
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  hashSenha,
  verificarSenha,
  gerarToken,
  verificarToken,
};
