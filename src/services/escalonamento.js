const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const { agora, ligar } = require('./scheduler');
const { enviarAlerta } = require('./alerta');
const { getClient } = require('./twilioClient');

const MAX = config.maxTentativas;
const INTERVALO = config.intervaloRetentativaMin;
const MAX_FALHAS_ALERTA = 3;
const falhasAlerta = new Map();
let rodando = false;

// Só mexe em chamadas de hoje e de ontem (cobre a virada da meia-noite e ignora linhas de teste antigas).
function datasRelevantes() {
  const hoje = agora().data;
  const ontem = agora(new Date(Date.now() - 24 * 60 * 60 * 1000)).data;
  return [hoje, ontem];
}

// Muda o status só das linhas que ainda estão em um dos status "de", para nunca sobrescrever um resultado final.
function marcar(ids, novo, de = ['discando']) {
  if (!ids.length) return 0;
  const m = ids.map(() => '?').join(',');
  const d = de.map(() => '?').join(',');
  return db
    .prepare(
      `UPDATE chamadas SET status = ?, atualizado_em = datetime('now','localtime')
       WHERE id IN (${m}) AND status IN (${d})`
    )
    .run(novo, ...ids, ...de).changes;
}

// 1) Descobre o que aconteceu com as ligações que ainda estão "discando".
async function acompanhar() {
  const linhas = db
    .prepare(
      `SELECT id, call_sid,
              CAST((julianday(datetime('now','localtime')) - julianday(criado_em)) * 1440 AS INTEGER) AS minutos
       FROM chamadas
       WHERE status = 'discando' AND data IN (?, ?)`
    )
    .all(...datasRelevantes());

  const porSid = new Map();
  for (const l of linhas) {
    if (!l.call_sid) {
      if (l.minutos >= 2) {
        marcar([l.id], 'falhou');
        console.log(`[acompanhar] chamada ${l.id} sem call_sid há ${l.minutos} min -> falhou`);
      }
      continue;
    }
    if (!porSid.has(l.call_sid)) porSid.set(l.call_sid, []);
    porSid.get(l.call_sid).push(l);
  }

  for (const [sid, grupo] of porSid) {
    const ids = grupo.map((g) => g.id);
    const minutos = Math.max(...grupo.map((g) => g.minutos));

    if (sid.startsWith('DRY-')) {
      if (minutos >= 1) {
        marcar(ids, 'sem_resposta');
        console.log(`[acompanhar] (simulado) ninguém confirmou -> chamadas ${ids.join(',')} sem_resposta`);
      }
      continue;
    }

    try {
      const ligacao = await getClient().calls(sid).fetch();
      const st = ligacao.status;
      if (['busy', 'no-answer', 'completed'].includes(st)) {
        marcar(ids, 'sem_resposta');
        console.log(`[acompanhar] ligação ${st} sem confirmação -> chamadas ${ids.join(',')} sem_resposta`);
      } else if (['failed', 'canceled'].includes(st)) {
        marcar(ids, 'falhou');
        console.log(`[acompanhar] ligação ${st} -> chamadas ${ids.join(',')} falhou`);
      } else if (minutos >= 5) {
        marcar(ids, 'sem_resposta');
        console.log(`[acompanhar] ligação travada em ${st} há ${minutos} min -> chamadas ${ids.join(',')} sem_resposta`);
      }
    } catch (e) {
      console.error(`[acompanhar] erro ao consultar ${sid}: ${e.message}`);
    }
  }
}

// 2) Liga de novo ou avisa o cuidador, conforme o número de tentativas.
async function processar() {
  const linhas = db
    .prepare(
      `SELECT c.id, c.horario_id, c.data, c.tentativa, h.hora,
              m.nome AS medicamento, m.descricao,
              p.id AS paciente_id, p.nome AS paciente, p.telefone,
              p.cuidador_nome, p.cuidador_telefone,
              (c.atualizado_em <= datetime('now','localtime', ?)) AS pronta
       FROM chamadas c
       JOIN horarios h ON h.id = c.horario_id AND h.ativo = 1
       JOIN medicamentos m ON m.id = h.medicamento_id AND m.ativo = 1
       JOIN pacientes p ON p.id = m.paciente_id AND p.ativo = 1
       WHERE c.data IN (?, ?)
         AND c.status IN ('sem_resposta', 'falhou')
         AND NOT EXISTS (
           SELECT 1 FROM chamadas c2
           WHERE c2.horario_id = c.horario_id AND c2.data = c.data AND c2.tentativa > c.tentativa
         )
       ORDER BY p.id, h.hora, m.nome`
    )
    .all(`-${INTERVALO} minutes`, ...datasRelevantes());

  const grupos = new Map();
  for (const l of linhas) {
    const chave = `${l.paciente_id}|${l.data}|${l.hora}|${l.tentativa}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(l);
  }

  for (const [chave, grupo] of grupos) {
    if (grupo[0].tentativa >= MAX) {
      await escalar(chave, grupo);
    } else if (grupo.every((l) => l.pronta)) {
      await tentarNovamente(grupo);
    }
  }
}

async function tentarNovamente(grupo) {
  const proxima = grupo[0].tentativa + 1;
  const reservar = db.prepare(
    'INSERT OR IGNORE INTO chamadas (horario_id, data, tentativa) VALUES (?, ?, ?)'
  );
  const novos = [];
  db.transaction(() => {
    for (const l of grupo) {
      const info = reservar.run(l.horario_id, l.data, proxima);
      if (info.changes === 1) novos.push({ ...l, chamada_id: Number(info.lastInsertRowid) });
    }
  })();
  if (!novos.length) return;

  console.log(
    `[escalonamento] ${grupo[0].paciente} não confirmou o remédio das ${grupo[0].hora}: tentativa ${proxima} de ${MAX}`
  );
  await ligar(novos, grupo[0].hora);
}

async function escalar(chave, grupo) {
  const ids = grupo.map((l) => l.id);
  const g = grupo[0];
  const remedios = grupo.map((l) => l.medicamento).join(', ');
  const texto = `ALERTA: ${g.paciente} não confirmou o remédio das ${g.hora} (${remedios}). Tentamos ligar ${g.tentativa} vezes. Por favor, entre em contato.`;

  try {
    await enviarAlerta({ para: g.cuidador_telefone, texto });
    marcar(ids, 'escalonada', ['sem_resposta', 'falhou']);
    falhasAlerta.delete(chave);
    console.log(`[escalonamento] cuidador ${g.cuidador_nome} avisado -> chamadas ${ids.join(',')} escalonadas`);
  } catch (e) {
    const n = (falhasAlerta.get(chave) || 0) + 1;
    falhasAlerta.set(chave, n);
    console.error(`[escalonamento] falha ao enviar alerta (${n}/${MAX_FALHAS_ALERTA}): ${e.message}`);
    if (n >= MAX_FALHAS_ALERTA) {
      marcar(ids, 'escalonada', ['sem_resposta', 'falhou']);
      console.error(
        `[escalonamento] ALERTA NÃO ENVIADO. Avise ${g.cuidador_nome} manualmente (${g.cuidador_telefone}).`
      );
    }
  }
}

function iniciar() {
  cron.schedule(
    '* * * * *',
    async () => {
      if (rodando) return;
      rodando = true;
      try {
        await acompanhar();
        await processar();
      } catch (e) {
        console.error('Erro no escalonamento:', e);
      } finally {
        rodando = false;
      }
    },
    { timezone: config.timezone }
  );
  console.log(
    `Escalonamento ativo (até ${MAX} tentativas, intervalo de ${INTERVALO} min, alerta por ${config.alerta.canal})`
  );
}

module.exports = { iniciar, acompanhar, processar };
