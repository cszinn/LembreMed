require('dotenv').config({ quiet: true });

module.exports = {
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL || '',
  dbPath: process.env.DB_PATH || './data/ura.sqlite',
  dryRun: process.env.DRY_RUN !== 'false',
  timezone: process.env.APP_TZ || 'America/Sao_Paulo',
  voz: process.env.VOZ || 'Polly.Camila-Neural',
  maxTentativas: Number(process.env.MAX_TENTATIVAS) || 3,
  intervaloRetentativaMin: Number(process.env.RETRY_MINUTOS) || 5,
  alerta: {
    canal: process.env.ALERTA_CANAL === 'whatsapp' ? 'whatsapp' : 'sms',
    whatsappFrom: process.env.WHATSAPP_FROM || '+14155238886',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },
};
