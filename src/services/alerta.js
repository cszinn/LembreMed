const config = require('../config');
const { getClient } = require('./twilioClient');

// Envia o alerta ao cuidador por SMS (padrão) ou WhatsApp (ALERTA_CANAL=whatsapp).
async function enviarAlerta({ para, texto }) {
  const whats = config.alerta.canal === 'whatsapp';

  if (config.dryRun) {
    console.log(`  [SIMULADO] alerta (${config.alerta.canal}) para ${para}: "${texto}"`);
    return { sid: `DRY-MSG-${Date.now()}` };
  }

  const msg = await getClient().messages.create({
    to: whats ? `whatsapp:${para}` : para,
    from: whats ? `whatsapp:${config.alerta.whatsappFrom}` : config.twilio.phoneNumber,
    body: texto,
  });
  return { sid: msg.sid };
}

module.exports = { enviarAlerta };
