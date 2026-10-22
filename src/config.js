const path = require('path');

// Caminhos relativos à pasta do projeto (e não ao terminal): funciona de qualquer diretório.
const RAIZ = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(RAIZ, '.env'), quiet: true });

module.exports = {
  port: process.env.PORT || 3000,
  baseUrl: (process.env.BASE_URL || '').trim().replace(/\/+$/, ''),
  dbPath: path.resolve(RAIZ, process.env.DB_PATH || './data/ura.sqlite'),
  // Login do painel só pela conta do Google (qualquer conta pode entrar).
  google: {
    // ID do cliente OAuth do Google Cloud. Não é segredo: o painel usa para mostrar o botão.
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  },
  dryRun: process.env.DRY_RUN !== 'false',
  // Valida a assinatura (X-Twilio-Signature) dos webhooks. Só desligue em desenvolvimento.
  validarAssinaturaTwilio: process.env.TWILIO_VALIDAR_ASSINATURA !== 'false',
  // O paciente responde FALANDO (reconhecimento de fala da Twilio, pt-BR); só um "sim" claro confirma.
  // Abaixo desta confiança (0 a 1) um "sim" falado NÃO confirma: conta como "não" e o sistema liga de novo.
  confiancaMinimaVoz: Number(process.env.VOZ_CONFIANCA_MINIMA) || 0.5,
  timezone: process.env.APP_TZ || 'America/Sao_Paulo',
  voz: process.env.VOZ || 'Polly.Camila-Neural',
  maxTentativas: Number(process.env.MAX_TENTATIVAS) || 3,
  intervaloRetentativaMin: Number(process.env.RETRY_MINUTOS) || 5,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },
};
