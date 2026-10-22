const config = require('../config');
const { getClient } = require('./twilioClient');

// Envia um SMS ao cuidador (alerta de dose não confirmada ou aviso de confirmação), pelo número da Twilio.
async function enviarSms({ para, texto }) {
  if (config.dryRun) {
    console.log(`  [SIMULADO] SMS para ${para}: "${texto}"`);
    return { sid: `DRY-MSG-${Date.now()}` };
  }

  const msg = await getClient().messages.create({
    to: para,
    from: config.twilio.phoneNumber,
    body: texto,
  });
  return { sid: msg.sid };
}

module.exports = { enviarSms };
