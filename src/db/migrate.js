const db = require('./index');
const { hashSenha } = require('../services/auth');

function migrar() {
  console.log('[migracao] Iniciando configuracao de cuidadores e autenticacao...');

  // 1. Cria tabela de cuidadores
  db.exec(`
    CREATE TABLE IF NOT EXISTS cuidadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      telefone TEXT NOT NULL,
      canal_alerta TEXT NOT NULL DEFAULT 'sms',
      criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // 2. Verifica se a coluna cuidador_id ja existe na tabela pacientes
  const colunasPacientes = db.prepare('PRAGMA table_info(pacientes)').all();
  const temCuidadorId = colunasPacientes.some((c) => c.name === 'cuidador_id');

  if (!temCuidadorId) {
    console.log('[migracao] Adicionando coluna cuidador_id em pacientes...');
    db.exec(`
      ALTER TABLE pacientes ADD COLUMN cuidador_id INTEGER REFERENCES cuidadores(id) ON DELETE CASCADE;
    `);
  }

  // 3. Garante que existe pelo menos um cuidador para vincular pacientes existentes
  let cuidadorPadrao = db.prepare('SELECT * FROM cuidadores ORDER BY id ASC LIMIT 1').get();

  if (!cuidadorPadrao) {
    console.log('[migracao] Criando conta de cuidador inicial para testes...');
    const primeiroPaciente = db.prepare('SELECT cuidador_nome, cuidador_telefone FROM pacientes WHERE cuidador_telefone IS NOT NULL LIMIT 1').get();
    
    const nome = primeiroPaciente?.cuidador_nome || 'Carlos Cuidador';
    const telefone = primeiroPaciente?.cuidador_telefone || '+5531997731873';
    const email = 'cuidador@lembremed.com';
    const senhaHash = hashSenha('123456');

    const info = db.prepare(`
      INSERT INTO cuidadores (nome, email, senha_hash, telefone, canal_alerta)
      VALUES (?, ?, ?, ?, 'sms')
    `).run(nome, email, senhaHash, telefone);

    cuidadorPadrao = db.prepare('SELECT * FROM cuidadores WHERE id = ?').get(info.lastInsertRowid);
    console.log(`[migracao] Cuidador padrao criado: ${email} / senha: 123456`);
  }

  // 4. Atualiza os pacientes sem cuidador_id
  const atualizados = db.prepare(`
    UPDATE pacientes SET cuidador_id = ? WHERE cuidador_id IS NULL
  `).run(cuidadorPadrao.id);

  if (atualizados.changes > 0) {
    console.log(`[migracao] ${atualizados.changes} paciente(s) vinculados ao cuidador ${cuidadorPadrao.nome}.`);
  }

  console.log('[migracao] Migracao concluida com sucesso!');
}

if (require.main === module) {
  migrar();
}

module.exports = { migrar };
