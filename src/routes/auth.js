const express = require('express');
const db = require('../db');
const { hashSenha, verificarSenha, gerarToken, verificarToken } = require('../services/auth');
const { limpar, textoValido, normalizarTelefone } = require('../validators');

const router = express.Router();

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

  const cuidador = db
    .prepare('SELECT id, nome, email, telefone, canal_alerta FROM cuidadores WHERE id = ?')
    .get(payload.id);

  if (!cuidador) {
    return res.status(401).json({ erro: 'Conta de cuidador não encontrada.' });
  }

  req.cuidador = cuidador;
  next();
}

// POST /api/auth/cadastro
router.post('/cadastro', (req, res) => {
  const body = req.body || {};
  const nome = limpar(body.nome);
  const email = limpar(body.email).toLowerCase();
  const senha = String(body.senha || '');
  const telefone = normalizarTelefone(body.telefone);

  if (!textoValido(nome, 100)) return res.status(400).json({ erro: 'Informe o seu nome completo.' });
  if (!email || !email.includes('@') || email.length > 100) {
    return res.status(400).json({ erro: 'Informe um e-mail válido.' });
  }
  if (!senha || senha.length < 6) {
    return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres.' });
  }
  if (!telefone) {
    return res.status(400).json({ erro: 'Informe um telefone celular válido para receber alertas (DDD + número).' });
  }

  const existente = db.prepare('SELECT id FROM cuidadores WHERE email = ?').get(email);
  if (existente) {
    return res.status(409).json({ erro: 'Este e-mail já está cadastrado. Faça login.' });
  }

  const senha_hash = hashSenha(senha);
  const info = db
    .prepare('INSERT INTO cuidadores (nome, email, senha_hash, telefone) VALUES (?, ?, ?, ?)')
    .run(nome, email, senha_hash, telefone);

  const cuidador = db
    .prepare('SELECT id, nome, email, telefone, canal_alerta FROM cuidadores WHERE id = ?')
    .get(info.lastInsertRowid);

  const token = gerarToken(cuidador);
  res.status(201).json({ token, cuidador });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const body = req.body || {};
  const email = limpar(body.email).toLowerCase();
  const senha = String(body.senha || '');

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Informe o e-mail e a senha.' });
  }

  const cuidadorCompleto = db.prepare('SELECT * FROM cuidadores WHERE email = ?').get(email);
  if (!cuidadorCompleto || !verificarSenha(senha, cuidadorCompleto.senha_hash)) {
    return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  }

  const cuidador = {
    id: cuidadorCompleto.id,
    nome: cuidadorCompleto.nome,
    email: cuidadorCompleto.email,
    telefone: cuidadorCompleto.telefone,
    canal_alerta: cuidadorCompleto.canal_alerta,
  };

  const token = gerarToken(cuidador);
  res.json({ token, cuidador });
});

// GET /api/auth/me
router.get('/me', exigirAutenticacao, (req, res) => {
  res.json({ cuidador: req.cuidador });
});

// PUT /api/auth/perfil
router.put('/perfil', exigirAutenticacao, (req, res) => {
  const body = req.body || {};
  const nome = limpar(body.nome);
  const telefone = normalizarTelefone(body.telefone);
  const canal_alerta = body.canal_alerta === 'whatsapp' ? 'whatsapp' : 'sms';
  const novaSenha = body.senha ? String(body.senha) : null;

  if (!textoValido(nome, 100)) return res.status(400).json({ erro: 'Informe o seu nome completo.' });
  if (!telefone) return res.status(400).json({ erro: 'Telefone inválido para receber alertas.' });

  if (novaSenha) {
    if (novaSenha.length < 6) {
      return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }
    const senha_hash = hashSenha(novaSenha);
    db.prepare('UPDATE cuidadores SET nome = ?, telefone = ?, canal_alerta = ?, senha_hash = ? WHERE id = ?').run(
      nome,
      telefone,
      canal_alerta,
      senha_hash,
      req.cuidador.id
    );
  } else {
    db.prepare('UPDATE cuidadores SET nome = ?, telefone = ?, canal_alerta = ? WHERE id = ?').run(
      nome,
      telefone,
      canal_alerta,
      req.cuidador.id
    );
  }

  // Atualiza também o cuidador_nome e cuidador_telefone em todos os pacientes deste cuidador para manter sincronizado
  db.prepare('UPDATE pacientes SET cuidador_nome = ?, cuidador_telefone = ? WHERE cuidador_id = ?').run(
    nome,
    telefone,
    req.cuidador.id
  );

  const cuidadorAtualizado = db
    .prepare('SELECT id, nome, email, telefone, canal_alerta FROM cuidadores WHERE id = ?')
    .get(req.cuidador.id);

  res.json({ cuidador: cuidadorAtualizado });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

module.exports = { router, exigirAutenticacao };
