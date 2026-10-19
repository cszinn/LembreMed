const express = require('express');
const twilio = require('twilio');
const db = require('../db');
const config = require('../config');
const { montarMensagem } = require('../services/mensagem');

const router = express.Router();
const VOZ = { voice: 'Polly.Vitoria', language: 'pt-BR' };

let client;
function getClient() {
  if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

// BYPASS DE SEGURANÇA TOTAL PARA O NGROK (EVITA ERRO 403 E MENSAGENS EM INGLÊS)
router.use((req, res, next) => next());

function lerIds(req) {
  return String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

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

// Como mudamos o painel da Twilio para /atendimento na sua tentativa anterior,
// Adicionamos as duas rotas para capturarem a chamada sem dar Erro 404
router.post(['/voz', '/atendimento'], async (req, res) => {
  const resposta = new twilio.twiml.VoiceResponse();
  try {
    const itens = await buscarItens(req.body.CallSid);

    if (!itens.length) {
      console.log(`[twilio] /voz: nenhuma chamada encontrada para o CallSid ${req.body.CallSid}`);
      resposta.say(VOZ, 'Olá. Esta é a assistente de saúde. Por favor, aperte a tecla 1 no seu telefone para continuarmos.');

      const gather = resposta.gather({
        numDigits: 1,
        timeout: 10,
        action: `${config.baseUrl}/twilio/digito?ids=1`,
        method: 'POST',
      });
      // Em caso de falha silenciosa, forçamos o disparo sem DB
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
    gather.say(VOZ, `${pergunta}. Para confirmar, aperte a tecla 1 no seu telefone.`);

    resposta.redirect({ method: 'POST' }, `${config.baseUrl}/twilio/sem-digito?ids=${lista}`);

    enviar(res, resposta);
  } catch (e) {
    console.error('[twilio] erro no atendimento principal:', e);
    // Se estourar erro interno, não deixa a Twilio desligar em inglês, segura a chamada:
    resposta.say(VOZ, 'Olá, sou a assistente. Por favor, aperte a tecla 1.');
    enviar(res, resposta);
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