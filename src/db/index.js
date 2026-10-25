const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const dbFile = path.resolve(config.dbPath);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Cria as tabelas que faltarem: banco novo ou recém-apagado com npm run db:reset.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const colunasDe = (tabela) => db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);

// Bancos de antes do tipo de ligação: recria a tabela chamadas com a coluna tipo (que tem CHECK, e o
// SQLite não acrescenta CHECK em tabela existente), mantendo todo o histórico.
if (!colunasDe('chamadas').includes('tipo')) {
  const colunas = colunasDe('chamadas').join(', ');
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec('ALTER TABLE chamadas RENAME TO chamadas_antiga');
    db.exec(schema);
    db.exec(`INSERT INTO chamadas (${colunas}) SELECT ${colunas} FROM chamadas_antiga`);
    db.exec('DROP TABLE chamadas_antiga');
    db.exec(schema); // recria o índice, que saiu junto com a tabela antiga
  })();
  db.pragma('foreign_keys = ON');
  console.log('[banco] tabela de chamadas atualizada (tipo de ligação)');
}

// Colunas simples criadas depois: acrescenta nos bancos que ainda não têm.
const novas = [
  ['chamadas', 'atendida', 'INTEGER NOT NULL DEFAULT 0'],
  ['chamadas', 'caixa_postal', 'INTEGER NOT NULL DEFAULT 0'],
  ['pacientes', 'minutos_religar', 'INTEGER NOT NULL DEFAULT 5'],
];
for (const [tabela, coluna, tipo] of novas) {
  if (!colunasDe(tabela).includes(coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
}

module.exports = db;
