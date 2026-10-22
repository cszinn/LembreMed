// Apaga o banco inteiro (cuidadores, pacientes, remédios e histórico) e cria um vazio.
// Uso, com o servidor PARADO: npm run db:reset -- --confirmar
const fs = require('fs');
const config = require('../config');

if (!process.argv.includes('--confirmar')) {
  console.log(`Isto apaga TODOS os dados de ${config.dbPath}.`);
  console.log('Pare o servidor e rode de novo com: npm run db:reset -- --confirmar');
  process.exit(1);
}

try {
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + sufixo, { force: true });
} catch (e) {
  console.error(`Não foi possível apagar o banco (${e.code}). O servidor ainda está rodando? Pare-o e tente de novo.`);
  process.exit(1);
}

require('./index').close(); // abrir o banco já cria as tabelas vazias
console.log('Banco recriado vazio. Inicie o servidor e entre no painel com a sua conta do Google.');
