const express = require('express');
const twilio = require('twilio');
const db = require('../db');
const config = require('../config');
const { montarMensagem } = require('../services/mensagem');

const router = express.Router();
const VOZ = { voice: config.voz, language: 'pt-BR' };

let client;
function getClient() {
  if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

// Guarda por 2 minutos as chamadas já confirmadas na API, para não consultar a cada webhook.
const verificadas = new Map();

// Usado quando o pedido chega sem X-Twilio-Signature (observado na conta trial):
// confirma na API da Twilio que a ligação é nossa e está em andamento.
async function chamadaLegitima(req) {
  const body = req.body || {};
  const sid = body.CallSid;
  if (!/^CA[0-9a-f]{32}$/.test(sid || '')) return false;

  const visto = verificadas.get(sid);
  if (visto && Date.now() - visto < 120000) return true;

  const call = await getClient().calls(sid).fetch();
  const ok =
    ['ringing', 'in-progress'].includes(call.status) &&
    call.direction === 'outbound-api' &&
    call.from === config.twilio.phoneNumber &&
    call.from === body.From &&
    call.to === body.To;

  if (ok) verificadas.set(sid, Date.now());
  return ok;
}

router.use(async (req, res, next) => {
  const assinatura = req.get('X-Twilio-Signature');
  const url = config.baseUrl + req.originalUrl;
  try {
    if (assinatura) {
      if (twilio.validateRequest(config.twilio.authToken, assinatura, url, req.body || {})) {
        return next();
      }
      console.log(`[twilio] 403 em ${req.originalUrl}: assinatura presente mas inválida`);
      return res.status(403).send('Assinatura inválida.');
    }
    if (await chamadaLegitima(req)) return next();
    console.log(`[twilio] 403 em ${req.originalUrl}: sem assinatura e chamada não confirmada na API`);
    return res.status(403).send('Não autorizado.');
  } catch (e) {
    console.error(`[twilio] erro ao verificar a chamada em ${req.originalUrl}:`, e.message);
    return res.status(403).send('Não autorizado.');
  }
});

function lerIds(req) {
  return String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

// Só muda chamadas que ainda estão "discando", para não sobrescrever um resultado já definido.
function atualizar(ids, status) {
  if (!ids.length) return 0;
  const marcadores = ids.map(() => '?').join(',');
  return db
    .prepare(
      `UPDATE chamadas SET status = ?, atualizado_em = datetime('now','localtime')
       WHERE id IN (${marcadores}) AND status = 'discando'`
    )
    .run(status, ...ids).changes;
}

const consultarPorCallSid = db.prepare(`
  SELECT c.id, m.nome AS medicamento, m.descricao, p.nome AS paciente
  FROM chamadas c
  JOIN horarios h ON h.id = c.horario_id
  JOIN medicamentos m ON m.id = h.medicamento_id
  JOIN pacientes p ON p.id = m.paciente_id
  WHERE c.call_sid = ?
  ORDER BY m.nome
`);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// O call_sid é gravado logo depois que a Twilio aceita a ligação; espera um pouco caso o webhook chegue antes.
async function buscarItens(callSid) {
  if (!callSid) return [];
  for (let i = 0; i < 6; i++) {
    const itens = consultarPorCallSid.all(callSid);
    if (itens.length) return itens;
    await esperar(500);
  }
  return [];
}

function enviar(res, resposta) {
  res.type('text/xml').send(resposta.toString());
}

// A Twilio busca aqui o roteiro da ligação (a conta trial não aceita TwiML nem parâmetros extras no pedido).
router.post('/voz', async (req, res) => {
  const resposta = new twilio.twiml.VoiceResponse();
  try {
    const itens = await buscarItens(req.body.CallSid);

    if (!itens.length) {
      console.log(`[twilio] /voz: nenhuma chamada encontrada para o CallSid ${req.body.CallSid}`);
      resposta.say(VOZ, 'Desculpe, ocorreu um erro. Até logo.');
      resposta.hangup();
      return enviar(res, resposta);
    }

    const lista = itens.map((i) => i.id).join(',');
    console.log(`[twilio] atenderam: chamadas ${lista}`);

    const { introducao, pergunta } = montarMensagem(itens[0].paciente, itens);
    const gather = resposta.gather({
      numDigits: 1,
      timeout: 10,
      action: `${config.baseUrl}/twilio/digito?ids=${lista}`,
      method: 'POST',
    });
    gather.say(VOZ, introducao);
    gather.pause({ length: 1 });
    gather.say(VOZ, pergunta);
    // Se ninguém apertar nada, a Twilio continua daqui:
    resposta.redirect({ method: 'POST' }, `${config.baseUrl}/twilio/sem-digito?ids=${lista}`);

    enviar(res, resposta);
  } catch (e) {
    console.error('[twilio] erro em /voz:', e);
    res.sendStatus(500);
  }
});

router.post('/digito', (req, res) => {
  const ids = lerIds(req);
  const resposta = new twilio.twiml.VoiceResponse();

  if (req.body.Digits === '1') {
    atualizar(ids, 'confirmada');
    console.log(`[twilio] chamadas ${ids.join(',')} CONFIRMADAS`);
    resposta.say(VOZ, 'Obrigado! Confirmação recebida. Tenha um ótimo dia.');
  } else {
    atualizar(ids, 'sem_resposta');
    console.log(`[twilio] tecla ${req.body.Digits} não reconhecida (chamadas ${ids.join(',')})`);
    resposta.say(VOZ, 'Não entendi a tecla. Até logo.');
  }
  resposta.hangup();
  enviar(res, resposta);
});

router.post('/sem-digito', (req, res) => {
  const ids = lerIds(req);
  atualizar(ids, 'sem_resposta');
  console.log(`[twilio] atendeu mas não apertou nada -> chamadas ${ids.join(',')} sem_resposta`);
  const resposta = new twilio.twiml.VoiceResponse();
  resposta.say(VOZ, 'Não recebemos a sua resposta. Até logo.');
  resposta.hangup();
  enviar(res, resposta);
});

module.exports = router;
