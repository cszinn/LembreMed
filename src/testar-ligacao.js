// Uso: node src/testar-ligacao.js +5531999999999
process.env.DRY_RUN = 'false';

const db = require('./db');
const { montarMensagem } = require('./services/mensagem');
const { discar } = require('./services/telephony');

const telefone = process.argv[2];
if (!/^\+55\d{10,11}$/.test(telefone || '')) {
  console.error('Uso: node src/testar-ligacao.js +5531999999999');
  process.exit(1);
}

const horario = db
  .prepare(
    `SELECT h.id, m.nome AS medicamento, m.descricao
     FROM horarios h JOIN medicamentos m ON m.id = h.medicamento_id
     ORDER BY h.id LIMIT 1`
  )
  .get();
if (!horario) {
  console.error('Nenhum horário cadastrado. Rode npm run db:seed.');
  process.exit(1);
}

const chamadaId = Number(
  db.prepare('INSERT INTO chamadas (horario_id, data) VALUES (?, ?)').run(horario.id, `TESTE-${Date.now()}`)
    .lastInsertRowid
);

discar({
  paciente: { nome: 'Teste', telefone },
  mensagem: montarMensagem('Maria', [horario], 'confirmacao'),
  chamadaIds: [chamadaId],
})
  .then(({ callSid }) => {
    db.prepare('UPDATE chamadas SET call_sid = ? WHERE id = ?').run(callSid, chamadaId);
    console.log(`Ligação disparada. Chamada nº ${chamadaId}, SID ${callSid}`);
  })
  .catch((e) => {
    db.prepare("UPDATE chamadas SET status = 'falhou' WHERE id = ?").run(chamadaId);
    console.error('Falhou:', e.message);
  });
