const express = require('express');
const twilio = require('twilio');
const db = require('../db');
const config = require('../config');
const { ABERTURA, montarMensagem, respostaSemConfirmar } = require('../services/mensagem');
const validarAssinaturaTwilio = require('../middleware/twilioAssinatura');
const { interpretarFala, ehCaixaPostal, ehSaudacao, DICAS } = require('../services/interpretarResposta');
const { registrarFim, avisarConfirmacao, minutosParaReligar } = require('../services/escalonamento');

const router = express.Router();
const VOZ = { voice: config.voz, language: 'pt-BR' };

// Só aceita requisições realmente assinadas pela Twilio (ver middleware/twilioAssinatura.js).
router.use(validarAssinaturaTwilio);

function lerIds(req) {
  return String(req.query.ids || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

// Muda o status só das chamadas que ainda estão em um dos status "de" (nunca sobrescreve um resultado final).
function atualizar(ids, status, de = ['discando']) {
  if (!ids.length) return 0;
  const marcadores = ids.map(() => '?').join(',');
  const estados = de.map(() => '?').join(',');
  return db
    .prepare(
      `UPDATE chamadas SET status = ?, atualizado_em = datetime('now','localtime')
       WHERE id IN (${marcadores}) AND status IN (${estados})`
    )
    .run(status, ...ids, ...de).changes;
}

const consultarPorCallSid = db.prepare(`
  SELECT c.id, c.tipo, m.nome AS medicamento, m.descricao, p.nome AS paciente
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

// Resposta para quando não conseguimos identificar a chamada: avisa, desliga e NÃO confirma nada.
function falhaTemporaria() {
  const r = new twilio.twiml.VoiceResponse();
  r.say(VOZ, 'Olá. Não conseguimos carregar o seu lembrete agora. Vamos ligar novamente em instantes.');
  r.hangup();
  return r;
}

// Cria o <Gather> que escuta a fala do paciente (pt-BR). Não há resposta por teclado.
// experimental_utterances é o modelo da Twilio para respostas curtas ("sim", "já tomei"); com ele o
// speechTimeout precisa ser um número: 1 s de pausa encerra a escuta, para a resposta chegar logo. Se
// cortar uma resposta com pausa ("Ata... sim, tomei" vira só "Ata"), o sistema pergunta de novo.
// pergunta = 1 na primeira vez; aumenta quando repetimos porque o paciente só disse "alô", "oi"...
// ou o reconhecimento não entendeu. Abaixo desta confiança, uma fala que não é "sim" conta como "não entendi".
const PERGUNTAS_MAX = 3;
const CONFIANCA_ENTENDEU = 0.4;
function criarGather(resposta, lista, pergunta = 1) {
  return resposta.gather({
    input: 'speech',
    language: 'pt-BR',
    speechModel: 'experimental_utterances',
    speechTimeout: 1,
    timeout: 10,
    hints: DICAS,
    action: `${config.baseUrl}/twilio/digito?ids=${lista}&p=${pergunta}`,
    method: 'POST',
  });
}

// /voz: roteiro das ligações que o sistema faz. /atendimento: URL configurada no número da Twilio
// (console) para quando alguém liga PARA o sistema.
router.post(['/voz', '/atendimento'], async (req, res) => {
  const resposta = new twilio.twiml.VoiceResponse();
  try {
    if (req.body.Direction === 'inbound') {
      // Alguém ligou PARA o número do sistema (ex.: o paciente retornando uma ligação perdida).
      // Antes ouvia "vamos ligar novamente em instantes", o que não acontece.
      console.log('[twilio] ligação recebida no número do sistema; explicando e encerrando');
      resposta.say(
        VOZ,
        'Olá! Aqui é o LembreMed, o lembrete de remédios por telefone. Nós ligamos para você nos horários dos seus remédios. Até logo.'
      );
      resposta.hangup();
      return enviar(res, resposta);
    }

    const itens = await buscarItens(req.body.CallSid);

    if (!itens.length) {
      // Não sabemos de qual chamada se trata: nunca oferecemos confirmação (confirmar às cegas
      // poderia marcar a chamada de OUTRO paciente). Encerramos; como a chamada continua "discando"
      // no banco, o escalonamento vê o fim da ligação na Twilio e agenda a nova tentativa.
      console.warn(`[twilio] /voz: nenhuma chamada encontrada para o CallSid ${req.body.CallSid}; encerrando sem confirmar`);
      return enviar(res, falhaTemporaria());
    }

    const ids = itens.map((i) => i.id);
    const lista = ids.join(',');
    const tipo = itens[0].tipo;
    console.log(`[twilio] atenderam (${tipo === 'lembrete' ? 'lembrete' : 'confirmação'}): chamadas ${lista}`);
    // Marca como atendida: se o paciente ainda não tomou, a próxima ligação é só de confirmação.
    db.prepare(`UPDATE chamadas SET atendida = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

    // A mensagem vem ANTES do <Gather> (e não dentro dele): só escutamos depois da pergunta. Assim o
    // "alô", "oi" ou até um "sim?" de quem atende não vira a resposta.
    // Dois <Say>: a abertura fixa toca na hora (áudio já em cache) enquanto o resto é gerado.
    resposta.say(VOZ, ABERTURA);
    resposta.say(VOZ, montarMensagem(itens[0].paciente, itens, tipo));
    criarGather(resposta, lista);
    resposta.redirect({ method: 'POST' }, `${config.baseUrl}/twilio/sem-digito?ids=${lista}`);

    enviar(res, resposta);
  } catch (e) {
    console.error('[twilio] erro no atendimento principal:', e);
    // Em erro interno, fala em português (em vez da mensagem em inglês da Twilio) e encerra sem confirmar nada.
    enviar(res, falhaTemporaria());
  }
});

// Decide o que o paciente respondeu, a partir da fala transcrita pela Twilio.
// Só um "sim" claro confirma. Qualquer outra frase (um "não", algo sem contexto, fala misturada ou
// um "sim" com confiança baixa) conta como NÃO: a dose fica sem confirmação e o sistema liga de novo.
function lerResposta(body) {
  const fala = String(body.SpeechResult || '').trim();
  if (!fala) return { resultado: 'nao', fala, origem: 'sem fala' };

  const confianca = body.Confidence === undefined || body.Confidence === '' ? 1 : Number(body.Confidence);
  const sim = interpretarFala(fala) === 'sim' && confianca >= config.confiancaMinimaVoz;
  return {
    resultado: sim ? 'sim' : 'nao',
    fala,
    confianca,
    origem: `fala "${fala}" (confiança ${Number.isFinite(confianca) ? confianca.toFixed(2) : '?'})`,
  };
}

// Guarda a última frase que o paciente falou, para o histórico do painel.
function guardarResposta(ids, fala) {
  const marcadores = ids.map(() => '?').join(',');
  db.prepare(`UPDATE chamadas SET resposta = ? WHERE id IN (${marcadores})`).run(fala.slice(0, 200), ...ids);
}

router.post('/digito', (req, res) => {
  const ids = lerIds(req);
  const resposta = new twilio.twiml.VoiceResponse();

  if (!ids.length) {
    console.warn('[twilio] /digito sem ids válidos; ignorando');
    return enviar(res, falhaTemporaria());
  }

  const { resultado, fala, confianca, origem } = lerResposta(req.body);
  if (fala) guardarResposta(ids, fala);
  const pergunta = Number(req.query.p || 1);

  // Quem "atendeu" foi a caixa postal: desliga sem deixar recado e conta como NÃO atendida, para a
  // próxima ligação repetir o lembrete completo (o paciente não ouviu nada).
  if (fala && ehCaixaPostal(fala)) {
    console.log(`[twilio] chamadas ${ids.join(',')} | caixa postal ("${fala}") -> conta como não atendida`);
    const m = ids.map(() => '?').join(',');
    db.prepare(`UPDATE chamadas SET atendida = 0, caixa_postal = 1 WHERE id IN (${m})`).run(...ids);
    atualizar(ids, 'sem_resposta');
    resposta.hangup();
    return enviar(res, resposta);
  }
  // Só cumprimentou ("alô?", "oi, quem é?") ou o reconhecimento quase não entendeu a fala (ex.:
  // "Ata, sim, tomei sim" virou "A tarde" com confiança 0): pergunta de novo, em vez de contar como
  // "não". No máximo PERGUNTAS_MAX perguntas por ligação.
  const cumprimento = fala && ehSaudacao(fala);
  // Também conta como "não entendi" um "sim" com confiança abaixo do mínimo para confirmar (ex.: "Tomei"
  // com 0,41): pergunta de novo em vez de tratar como "não".
  const simIncerto = resultado !== 'sim' && interpretarFala(fala || '') === 'sim';
  const naoEntendeu = fala && resultado !== 'sim' && (confianca < CONFIANCA_ENTENDEU || simIncerto);
  if ((cumprimento || naoEntendeu) && pergunta < PERGUNTAS_MAX) {
    console.log(`[twilio] chamadas ${ids.join(',')} | ${origem} -> ${cumprimento ? 'só cumprimentou' : 'não entendeu'}; pergunta de novo`);
    const lista = ids.join(',');
    resposta.say(
      VOZ,
      cumprimento
        ? 'Olá! Aqui é o LembreMed, o lembrete do seu remédio. Você já tomou o seu remédio?'
        : 'Desculpe, não entendi. Você já tomou o seu remédio?'
    );
    criarGather(resposta, lista, pergunta + 1);
    resposta.redirect({ method: 'POST' }, `${config.baseUrl}/twilio/sem-digito?ids=${lista}`);
    return enviar(res, resposta);
  }
  console.log(`[twilio] chamadas ${ids.join(',')} | ${origem} -> ${resultado}`);

  if (resultado === 'sim') {
    // Também aceita "sem_resposta": se o paciente desligar logo após dizer "sim", o aviso de fim
    // da ligação pode chegar antes desta resposta e a confirmação não pode se perder.
    const confirmadas = atualizar(ids, 'confirmada', ['discando', 'sem_resposta']);
    console.log(`[twilio] chamadas ${ids.join(',')} CONFIRMADAS`);
    // SMS ao cuidador com a frase do paciente. Só na 1ª vez (a Twilio pode repetir o webhook) e sem
    // atrasar a resposta da ligação: avisarConfirmacao trata os próprios erros.
    if (confirmadas) avisarConfirmacao(ids, fala);
    resposta.say(VOZ, 'Obrigado! Até logo.');
  } else {
    // Ainda não tomou: fica sem_resposta e o escalonamento liga só para confirmar depois dos minutos
    // escolhidos para o paciente (ou avisa o cuidador quando as tentativas acabarem). Uma resposta
    // clara que não é "sim" não é perguntada de novo, para a ligação ser curta.
    atualizar(ids, 'sem_resposta');
    resposta.say(VOZ, respostaSemConfirmar(minutosParaReligar(ids), false));
  }
  resposta.hangup();
  enviar(res, resposta);
});

router.post('/sem-digito', (req, res) => {
  const ids = lerIds(req);
  atualizar(ids, 'sem_resposta');
  console.log(`[twilio] atendeu mas não respondeu -> chamadas ${ids.join(',')} sem_resposta`);
  const resposta = new twilio.twiml.VoiceResponse();
  resposta.say(VOZ, respostaSemConfirmar(ids.length ? minutosParaReligar(ids) : null, true));
  resposta.hangup();
  enviar(res, resposta);
});

// statusCallback: a Twilio avisa o fim da ligação (atendida, no-answer, busy, failed...) com o código SIP.
router.post('/status', async (req, res) => {
  const { CallSid, CallStatus, SipResponseCode, CallDuration } = req.body;
  try {
    // Recusas muito rápidas podem chegar antes de o call_sid ser gravado: tenta por até 3 s.
    for (let i = 0; i < 6; i++) {
      const achou = registrarFim(CallSid, {
        status: CallStatus,
        sip: Number(SipResponseCode) || null,
        duracao: Number(CallDuration) || 0,
      });
      if (achou) break;
      await esperar(500);
    }
  } catch (e) {
    console.error('[twilio] erro ao registrar o status da ligação:', e);
  }
  res.status(204).end();
});

module.exports = router;