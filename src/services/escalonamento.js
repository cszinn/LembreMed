const cron = require('node-cron');
const db = require('../db');
const config = require('../config');
const { agora, ligar } = require('./scheduler');
const { enviarAlerta } = require('./alerta');
const { getClient } = require('./twilioClient');

const MAX = config.maxTentativas;
const INTERVALO = config.intervaloRetentativaMin;
const MAX_FALHAS_ALERTA = 3;
// Recusa rápida: a rede devolveu "no-answer" em poucos segundos, sem o telefone tocar de verdade
// (comum em ligações internacionais para o Brasil). Religamos no minuto seguinte e as primeiras
// recusas rápidas de cada dose não gastam tentativa (ninguém chegou a ouvir o telefone).
const RECUSA_RAPIDA_SEG = 10;
const RECUSAS_RAPIDAS_EXTRAS = 2;
const ESPERA_RECUSA_RAPIDA_SEG = 30;
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

const segundosEntre = (inicio, fim) => (inicio && fim ? Math.round((new Date(fim) - new Date(inicio)) / 1000) : null);

// Grava o resultado final de uma ligação (status da Twilio, código SIP, duração e tempo até a recusa)
// e tira as chamadas de "discando". Usado pelo statusCallback da Twilio e, se ele se perder, por acompanhar().
// toque = segundos entre discar e o fim; se não vier, é medido desde a discagem (gravada em atualizado_em).
function registrarFim(sid, { status, sip = null, duracao = 0, toque = null }) {
  const linhas = db
    .prepare(
      `SELECT id, status,
              CAST(round((julianday(datetime('now','localtime')) - julianday(atualizado_em)) * 86400) AS INTEGER) AS desde
       FROM chamadas WHERE call_sid = ?`
    )
    .all(sid);
  if (!linhas.length) return false;

  const discando = linhas.filter((l) => l.status === 'discando');
  if (toque === null && status !== 'completed' && discando.length) toque = Math.max(...discando.map((l) => l.desde));
  if (status === 'completed') toque = null;

  db.prepare(
    `UPDATE chamadas SET twilio_status = ?, sip_code = coalesce(?, sip_code), duracao_seg = ?,
            toque_seg = coalesce(toque_seg, ?)
     WHERE call_sid = ?`
  ).run(status, sip, duracao, toque, sid);

  const ids = linhas.map((l) => l.id);
  const novo = ['failed', 'canceled'].includes(status) ? 'falhou' : 'sem_resposta';
  if (marcar(ids, novo)) {
    const rapida = status === 'no-answer' && toque !== null && toque < RECUSA_RAPIDA_SEG;
    const detalhe = status === 'completed' ? `atendida ${duracao}s` : `${status} em ${toque ?? '?'}s`;
    console.log(
      `[status] ligação ${detalhe} (SIP ${sip ?? '?'}) -> chamadas ${ids.join(',')} ${novo}` +
        (rapida ? ' | recusa rápida da rede: religa no próximo minuto' : '')
    );
  }
  return true;
}

// 1) Descobre o que aconteceu com as ligações que ainda estão "discando" (rede de segurança do statusCallback).
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
      if (['busy', 'no-answer', 'completed', 'failed', 'canceled'].includes(st)) {
        registrarFim(sid, {
          status: st,
          duracao: Number(ligacao.duration) || 0,
          toque: st === 'completed' ? null : segundosEntre(ligacao.startTime, ligacao.endTime),
        });
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
              c.toque_seg, c.sip_code,
              (c.twilio_status = 'no-answer' AND c.toque_seg < ?) AS rapida,
              (c.atualizado_em <= datetime('now','localtime',
                 CASE WHEN c.twilio_status = 'no-answer' AND c.toque_seg < ? THEN ? ELSE ? END)) AS pronta,
              (SELECT count(*) FROM chamadas c3
               WHERE c3.horario_id = c.horario_id AND c3.data = c.data
                 AND c3.twilio_status = 'no-answer' AND c3.toque_seg < ?) AS recusas_rapidas
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
    .all(
      RECUSA_RAPIDA_SEG,
      RECUSA_RAPIDA_SEG,
      `-${ESPERA_RECUSA_RAPIDA_SEG} seconds`,
      `-${INTERVALO} minutes`,
      RECUSA_RAPIDA_SEG,
      ...datasRelevantes()
    );

  const grupos = new Map();
  for (const l of linhas) {
    const chave = `${l.paciente_id}|${l.data}|${l.hora}|${l.tentativa}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(l);
  }

  for (const [chave, grupo] of grupos) {
    // Recusas rápidas da rede (até RECUSAS_RAPIDAS_EXTRAS por dose) não contam como tentativa.
    const usadas = grupo[0].tentativa - Math.min(grupo[0].recusas_rapidas, RECUSAS_RAPIDAS_EXTRAS);
    if (usadas >= MAX) {
      await escalar(chave, grupo);
    } else if (grupo.every((l) => l.pronta)) {
      await tentarNovamente(grupo, usadas);
    }
  }
}

async function tentarNovamente(grupo, usadas) {
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

  const g = grupo[0];
  const motivo = g.rapida ? `a rede recusou em ${g.toque_seg}s (SIP ${g.sip_code ?? '?'})` : 'não confirmou';
  console.log(
    `[escalonamento] ${g.paciente}, remédio das ${g.hora}: ${motivo} -> ligação ${proxima} (${usadas} de ${MAX} tentativas usadas)`
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

module.exports = { iniciar, acompanhar, processar, registrarFim };
