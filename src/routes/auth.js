const express = require('express');
const db = require('../db');
const config = require('../config');
const { gerarToken, verificarToken } = require('../services/auth');
const { verificarCredencialGoogle } = require('../services/google');
const { limpar, textoValido, normalizarTelefone } = require('../validators');

const router = express.Router();

// Limite de tentativas falhas (o painel fica público pelo ngrok).
const JANELA_MS = 15 * 60 * 1000;
const tentativas = new Map();

function excedeu(chave, limite) {
  const agora = Date.now();
  const recentes = (tentativas.get(chave) || []).filter((t) => agora - t < JANELA_MS);
  if (recentes.length) tentativas.set(chave, recentes);
  else tentativas.delete(chave);
  return recentes.length >= limite;
}

function contarTentativa(chave) {
  tentativas.set(chave, [...(tentativas.get(chave) || []), Date.now()]);
}

const muitasTentativas = (res) =>
  res.status(429).json({ erro: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });

const buscarCuidador = db.prepare('SELECT id, nome, email, telefone FROM cuidadores WHERE id = ?');

function extrairToken(req) {
  const auth = req.headers.authorization || '';
  // Só aceitamos o cabeçalho Authorization. Token na URL vazaria em logs, histórico do navegador e Referer.
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function exigirAutenticacao(req, res, next) {
  const token = extrairToken(req);
  if (!token) {
    return res.status(401).json({ erro: 'Não autenticado. Faça login para continuar.' });
  }

  const payload = verificarToken(token);
  if (!payload || !payload.id) {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada. Faça login novamente.' });
  }

  const cuidador = buscarCuidador.get(payload.id);
  if (!cuidador) {
    return res.status(401).json({ erro: 'Conta de cuidador não encontrada. Faça login novamente.' });
  }

  req.cuidador = cuidador;
  next();
}

// GET /api/auth/opcoes — o painel descobre o ID do cliente Google para mostrar o botão
router.get('/opcoes', (req, res) => {
  res.json({ googleClientId: config.google.clientId || null });
});

// POST /api/auth/google — recebe a credencial do botão "Entrar com Google" e devolve o token do painel.
// Qualquer conta Google pode entrar. O primeiro acesso cria a conta do cuidador; o celular é pedido em seguida (PUT /perfil).
router.post('/google', async (req, res) => {
  const chaveIp = `google:${req.ip}`;
  if (excedeu(chaveIp, 20)) return muitasTentativas(res);

  if (!config.google.clientId) {
    return res.status(503).json({ erro: 'O login com Google não foi configurado no servidor (GOOGLE_CLIENT_ID no .env).' });
  }

  let conta;
  try {
    conta = await verificarCredencialGoogle(String((req.body || {}).credential || ''));
  } catch (e) {
    contarTentativa(chaveIp);
    console.warn(`[login] credencial do Google recusada: ${e.message}`);
    return res.status(401).json({ erro: 'Não foi possível confirmar o login com o Google. Tente novamente.' });
  }

  // E-mail não confirmado no Google não entra: a conta é ligada ao cuidador também pelo e-mail.
  if (!conta.emailVerificado) {
    contarTentativa(chaveIp);
    console.warn(`[login] e-mail não confirmado no Google: ${conta.email}`);
    return res.status(403).json({ erro: 'Confirme o seu e-mail na conta do Google e tente novamente.' });
  }

  const existente = db.prepare('SELECT id FROM cuidadores WHERE google_id = ? OR email = ?').get(conta.googleId, conta.email);
  let id;
  if (existente) {
    id = existente.id;
    db.prepare('UPDATE cuidadores SET google_id = ?, email = ? WHERE id = ?').run(conta.googleId, conta.email, id);
  } else {
    const nome = limpar(conta.nome).slice(0, 100) || conta.email;
    id = db
      .prepare('INSERT INTO cuidadores (google_id, email, nome) VALUES (?, ?, ?)')
      .run(conta.googleId, conta.email, nome).lastInsertRowid;
    console.log(`[login] nova conta de cuidador: ${conta.email}`);
  }

  const cuidador = buscarCuidador.get(id);
  res.json({ token: gerarToken(cuidador), cuidador });
});

// GET /api/auth/me
router.get('/me', exigirAutenticacao, (req, res) => {
  res.json({ cuidador: req.cuidador });
});

// PUT /api/auth/perfil — nome e celular que recebe os SMS (o e-mail é o da conta Google)
router.put('/perfil', exigirAutenticacao, (req, res) => {
  const body = req.body || {};
  const nome = limpar(body.nome);
  const telefone = normalizarTelefone(body.telefone);

  if (!textoValido(nome, 100)) return res.status(400).json({ erro: 'Informe o seu nome completo.' });
  if (!telefone) return res.status(400).json({ erro: 'Informe um celular válido com DDD para receber os SMS.' });

  db.prepare('UPDATE cuidadores SET nome = ?, telefone = ? WHERE id = ?').run(nome, telefone, req.cuidador.id);
  res.json({ cuidador: buscarCuidador.get(req.cuidador.id) });
});

module.exports = { router, exigirAutenticacao };
