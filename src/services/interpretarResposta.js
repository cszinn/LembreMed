// Interpreta o que o paciente FALOU ao ser perguntado "já tomou o remédio?".
// Devolve 'sim', 'nao' ou 'indefinido'. Na ligação, só 'sim' confirma: 'nao' e 'indefinido'
// (frase sem contexto, "sim... não") contam como NÃO e o sistema liga de novo mais tarde.
//
// Regras de segurança:
//  - A negação é checada antes: "não tomei" contém "tomei", mas é um NÃO.
//  - Na dúvida nunca confirma: confirmar por engano é pior do que ligar outra vez.

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Frases com "não" que NÃO são recusa ("já tomei, não precisa ligar").
const NAO_E_RECUSA = /\b(nao precisa( ligar)?|nao se preocupe|nao se preocupa|nao tem problema|nao ha problema)\b/g;

// "não esqueci de tomar" = tomei.
const NEGA_ESQUECIMENTO = /\bnao (esqueci|deixei de)( de)?( tomar)?\b/g;

// "não tomei", "ainda não tomei", "nunca tomei" = NÃO.
const NEGA_TOMAR = /\b(nao|nunca|nem)\s+(\w+\s+)?(tomei|tomado|tomou|engoli|peguei)\b/;

const SINAIS_NAO = [
  /\bnao\b/,
  /\bnunca\b/,
  /\bnem\b/,
  /\besqueci\b/,
  /\bdepois\b/,
  /\bmais tarde\b/,
  /\bdaqui a pouco\b/,
  /\bja ja\b/,
  /\bagora nao\b/,
  /\bvou (tomar|pegar|buscar)\b/,
  /\b(espera|espere|aguarda|aguarde|calma|perai|um minuto|um minutinho)\b/,
];

const SINAIS_SIM = [
  /\bsim\b/,
  /\btomei\b/,
  /\btomou\b/,
  /\btomado\b/,
  /\bengoli\b/,
  /\bclaro\b/,
  /\bcom certeza\b/,
  /\bpositivo\b/,
  /\bconfirmo\b/,
  /\bconfirmado\b/,
  /\bisso\b/,
  /\bok\b/,
  /\bcerto\b/,
  /\b(uhum|aham|hum hum)\b/,
  /^ja$/, // resposta curta a "já tomou?"
];

function interpretarFala(texto) {
  let t = normalizar(texto);
  if (!t) return 'indefinido';

  t = t.replace(NAO_E_RECUSA, ' ').replace(NEGA_ESQUECIMENTO, ' tomei ').replace(/\s+/g, ' ').trim();

  let nao = false;
  if (NEGA_TOMAR.test(t)) {
    nao = true;
    t = t.replace(NEGA_TOMAR, ' ').replace(/\s+/g, ' ').trim();
  }
  nao = nao || SINAIS_NAO.some((r) => r.test(t));
  const sim = SINAIS_SIM.some((r) => r.test(t));

  if (nao && sim) return 'indefinido';
  if (nao) return 'nao';
  if (sim) return 'sim';
  return 'indefinido';
}

// Dicas para o reconhecedor de voz da Twilio priorizar estas palavras.
const DICAS = [
  'sim', 'não', 'já tomei', 'ainda não', 'ainda não tomei', 'não tomei', 'tomei',
  'esqueci', 'daqui a pouco', 'agora não', 'depois', 'mais tarde', 'já',
].join(', ');

module.exports = { interpretarFala, normalizar, DICAS };
