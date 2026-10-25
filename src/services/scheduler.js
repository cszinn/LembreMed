const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const { montarMensagem } = require('./mensagem');
const { discar } = require('./telephony');

function agora(date = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

const buscarDevidos = db.prepare(`
  SELECT h.id AS horario_id, h.hora,
         m.nome AS medicamento, m.descricao,
         p.id AS paciente_id, p.nome AS paciente, p.telefone
  FROM horarios h
  JOIN medicamentos m ON m.id = h.medicamento_id AND m.ativo = 1
  JOIN pacientes p ON p.id = m.paciente_id AND p.ativo = 1
  WHERE h.ativo = 1 AND h.hora = ?
  ORDER BY p.id, m.nome
`);

// No horário da dose, a primeira ligação é o lembrete; a confirmação vem depois (escalonamento.js).
const reservar = db.prepare(
  "INSERT OR IGNORE INTO chamadas (horario_id, data, tentativa, tipo) VALUES (?, ?, 1, 'lembrete')"
);

async function ligar(itens, hora, tipo) {
  const paciente = { nome: itens[0].paciente, telefone: itens[0].telefone };
  const ids = itens.map((i) => i.chamada_id);
  const marcadores = ids.map(() => '?').join(',');

  console.log(`[${hora}] ${tipo === 'lembrete' ? 'lembrete' : 'confirmação'}: ${itens.length} medicamento(s) para ${paciente.nome}`);
  try {
    const { callSid } = await discar({
      paciente,
      mensagem: montarMensagem(paciente.nome, itens, tipo),
      chamadaIds: ids,
    });
    db.prepare(
      `UPDATE chamadas SET call_sid = ?, atualizado_em = datetime('now','localtime')
       WHERE id IN (${marcadores})`
    ).run(callSid, ...ids);
  } catch (e) {
    console.error(`  Falha ao discar: ${e.message}`);
    db.prepare(
      `UPDATE chamadas SET status = 'falhou', atualizado_em = datetime('now','localtime')
       WHERE id IN (${marcadores})`
    ).run(...ids);
  }
}

// Também olha os últimos minutos: se o servidor estava fora do ar, reiniciando ou o PC dormiu
// exatamente no horário, a dose ainda é lembrada (com atraso) em vez de ser pulada em silêncio.
// A reserva idempotente garante uma única ligação por horário e dia.
const JANELA_ATRASO_MIN = 10;

// Varre o banco para o minuto informado (padrão: agora) e os anteriores. Retorna quantas chamadas foram reservadas.
async function varrer(referencia = new Date()) {
  const devidos = [];
  for (let atras = JANELA_ATRASO_MIN; atras >= 0; atras--) {
    const { data, hora } = agora(new Date(referencia.getTime() - atras * 60 * 1000));
    for (const d of buscarDevidos.all(hora)) devidos.push({ ...d, data });
  }

  const novos = [];
  db.transaction(() => {
    for (const d of devidos) {
      const info = reservar.run(d.horario_id, d.data);
      if (info.changes === 1) novos.push({ ...d, chamada_id: info.lastInsertRowid });
    }
  })();

  const porPaciente = new Map();
  for (const n of novos) {
    if (!porPaciente.has(n.paciente_id)) porPaciente.set(n.paciente_id, []);
    porPaciente.get(n.paciente_id).push(n);
  }

  for (const itens of porPaciente.values()) {
    await ligar(itens, itens[0].hora, 'lembrete');
  }
  return novos.length;
}

function iniciar() {
  cron.schedule(
    '* * * * *',
    async () => {
      try {
        await varrer();
      } catch (e) {
        console.error('Erro na varredura:', e);
      }
    },
    { timezone: config.timezone }
  );
  console.log(`Agendador ativo (varredura a cada minuto, fuso ${config.timezone})`);
}

module.exports = { iniciar, varrer, agora, ligar };
