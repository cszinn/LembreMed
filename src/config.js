require('dotenv').config({ quiet: true });

module.exports = {
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL || '',
  dbPath: process.env.DB_PATH || './data/ura.sqlite',
  dryRun: process.env.DRY_RUN !== 'false',
  timezone: process.env.APP_TZ || 'America/Sao_Paulo',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },
};
