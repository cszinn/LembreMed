const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const dbFile = path.resolve(config.dbPath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Colunas criadas depois da primeira versão do banco: adiciona nos bancos antigos, se faltarem.
function garantirColunas(tabela, colunas) {
  const existentes = db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
  if (!existentes.length) return; // tabela ainda não existe: npm run db:init cria já com tudo
  for (const [nome, tipo] of Object.entries(colunas)) {
    if (!existentes.includes(nome)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${tipo}`);
  }
}
garantirColunas('chamadas', {
  twilio_status: 'TEXT',
  sip_code: 'INTEGER',
  duracao_seg: 'INTEGER',
  toque_seg: 'INTEGER',
});

module.exports = db;
