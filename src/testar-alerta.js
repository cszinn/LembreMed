// Uso: node src/testar-alerta.js +5531999999999
process.env.DRY_RUN = 'false';

const { enviarSms } = require('./services/alerta');
const { getClient } = require('./services/twilioClient');

const telefone = process.argv[2];
if (!/^\+55\d{10,11}$/.test(telefone || '')) {
  console.error('Uso: node src/testar-alerta.js +5531999999999');
  process.exit(1);
}

(async () => {
  try {
    const { sid } = await enviarSms({
      para: telefone,
      texto: 'Teste do sistema de lembretes: se você recebeu esta mensagem, o alerta ao cuidador funciona.',
    });
    console.log(`Mensagem entregue à Twilio. SID ${sid}`);
    await new Promise((r) => setTimeout(r, 6000));
    const m = await getClient().messages(sid).fetch();
    console.log(`Status: ${m.status} | código de erro: ${m.errorCode || 'nenhum'}`);
  } catch (e) {
    console.error('Falhou:', e.message);
  }
})();
