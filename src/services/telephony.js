const twilio = require('twilio');
const config = require('../config');

let client;
function getClient() {
  if (!client) client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return client;
}

async function discar({ paciente, mensagem, chamadaIds }) {
  if (config.dryRun) {
    const callSid = `DRY-${Date.now()}-${chamadaIds[0]}`;
    console.log(`  [SIMULADO] ligando para ${paciente.nome} (${paciente.telefone})`);
    console.log(`  "${mensagem.introducao} ${mensagem.pergunta}"`);
    return { callSid };
  }

  if (!config.baseUrl) throw new Error('BASE_URL não configurada no .env');

  const ligacao = await getClient().calls.create({
    to: paciente.telefone,
    from: config.twilio.phoneNumber,
    url: `${config.baseUrl}/twilio/voz`,
    timeout: 60,
  });
  return { callSid: ligacao.sid };
}

module.exports = { discar };
