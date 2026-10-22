const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Sessão do painel depois do login com Google: token assinado com HMAC, válido por 7 dias.
// Chave que assina os tokens: JWT_SECRET do .env ou, se vazio, uma aleatória gerada uma vez
// e guardada em data/.jwt_secret (fora do git), para não depender de um segredo fixo no código.
function carregarSegredo() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const arquivo = path.join(path.dirname(config.dbPath), '.jwt_secret');
  try {
    const salvo = fs.readFileSync(arquivo, 'utf8').trim();
    if (salvo) return salvo;
  } catch {
    // ainda não existe: gera abaixo
  }
  const novo = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, novo, { mode: 0o600 });
  return novo;
}
const SECRET = carregarSegredo();

function assinar(b64Payload) {
  return crypto.createHmac('sha256', SECRET).update(b64Payload).digest('base64url');
}

function gerarToken(cuidador) {
  const payload = {
    id: cuidador.id,
    email: cuidador.email,
    nome: cuidador.nome,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 dias
  };
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64Payload}.${assinar(b64Payload)}`;
}

function verificarToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64Payload, assinatura] = token.split('.');

  // Comparação em tempo constante: não revela quantos caracteres da assinatura estão certos.
  const recebida = Buffer.from(assinatura || '');
  const esperada = Buffer.from(assinar(b64Payload));
  if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) return null;

  try {
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null; // expirado
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = {
  gerarToken,
  verificarToken,
};
