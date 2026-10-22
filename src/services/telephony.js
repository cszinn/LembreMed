const config = require('../config');
const { getClient } = require('./twilioClient');

// Antes de discar, confirma que a Twilio vai conseguir buscar o roteiro (ngrok e servidor no ar).
// Sem isso o paciente atende e ouve um erro da Twilio em inglês (aconteceu com 13 ligações).
const VALIDADE_TESTE_MS = 60 * 1000;
let ultimoTesteOk = 0;

async function webhookAcessivel() {
  if (Date.now() - ultimoTesteOk < VALIDADE_TESTE_MS) return true;
  try {
    const r = await fetch(`${config.baseUrl}/health`, {
      headers: { 'ngrok-skip-browser-warning': '1' },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      ultimoTesteOk = Date.now();
      return true;
    }
  } catch {
    // fora do ar, tempo esgotado ou DNS: trata como inacessível
  }
  return false;
}

async function discar({ paciente, mensagem, chamadaIds }) {
  if (config.dryRun) {
    const callSid = `DRY-${Date.now()}-${chamadaIds[0]}`;
    console.log(`  [SIMULADO] ligando para ${paciente.nome} (${paciente.telefone})`);
    console.log(`  "${mensagem.introducao} ${mensagem.pergunta}"`);
    return { callSid };
  }

  if (!config.baseUrl) throw new Error('BASE_URL não configurada no .env');
  if (!(await webhookAcessivel())) {
    throw new Error(`${config.baseUrl}/health não respondeu (ngrok ou servidor fora do ar?); ligação não feita`);
  }

  const ligacao = await getClient().calls.create({
    to: paciente.telefone,
    from: config.twilio.phoneNumber,
    url: `${config.baseUrl}/twilio/voz`,
    timeout: 60,
    // Ao terminar, a Twilio avisa o resultado e o código SIP (ex.: 480 = indisponível/filtro da rede).
    statusCallback: `${config.baseUrl}/twilio/status`,
    statusCallbackEvent: ['completed'],
  });
  return { callSid: ligacao.sid };
}

module.exports = { discar, webhookAcessivel };
