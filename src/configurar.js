// Assistente de configuração: pergunta cada valor, explica onde achar e grava o .env.
// Pode rodar quantas vezes quiser: Enter mantém o valor atual. Uso: npm run configurar
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const readline = require('readline/promises');

const RAIZ = path.join(__dirname, '..');
const ARQ_ENV = path.join(RAIZ, '.env');
const ARQ_EXEMPLO = path.join(RAIZ, '.env.example');

function lerEnv(arquivo) {
  const valores = {};
  if (!fs.existsSync(arquivo)) return valores;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) valores[m[1]] = m[2].trim();
  }
  return valores;
}

const exemplo = lerEnv(ARQ_EXEMPLO);
const atual = lerEnv(ARQ_ENV);
const novo = {};
const mascarar = (v) => (v.length > 4 ? `****${v.slice(-4)}` : '****');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let terminou = false;
// Ctrl+C (ou a entrada acabar) no meio das perguntas: avisa em vez de sair calado
rl.on('close', () => {
  if (terminou) return;
  console.log('\n\nConfiguração cancelada: nada foi salvo.');
  process.exit(1);
});

// Pergunta um valor; Enter mantém o atual. `validar` devolve a mensagem de erro, ou nada se estiver ok.
async function perguntar({ titulo, onde, antes = '', segredo = false, validar = () => null, normalizar = (v) => v }) {
  console.log(`\n${titulo}`);
  if (onde) console.log(`  Onde achar: ${onde}`);
  if (antes) console.log(`  Atual: ${segredo ? mascarar(antes) : antes}  (Enter mantém)`);
  for (;;) {
    const digitado = (await rl.question('> ')).trim();
    const valor = digitado ? normalizar(digitado) : antes;
    const erro = valor ? validar(valor) : 'Este campo é obrigatório.';
    if (!erro) return valor;
    console.log(`  ${erro}`);
  }
}

async function conferirTwilio(sid, token) {
  try {
    const numeros = await require('twilio')(sid, token).incomingPhoneNumbers.list({ limit: 5 });
    return { ok: true, numeros: numeros.map((n) => n.phoneNumber) };
  } catch (e) {
    if (e.status === 401) return { ok: false, erro: 'A Twilio recusou: Account SID ou Auth Token incorretos.' };
    return { ok: true, numeros: [], aviso: `Não consegui falar com a Twilio agora (${e.message}); sigo sem conferir.` };
  }
}

function ngrok(...args) {
  return execFileSync('ngrok', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// true se o ngrok deste PC já tem o authtoken (fica no arquivo de configuração dele)
function ngrokTemAuthtoken() {
  try {
    const arquivo = ngrok('config', 'check').match(/at (.+)$/m)?.[1]?.trim();
    return Boolean(arquivo) && /authtoken:\s*\S+/.test(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return false;
  }
}

async function configurarNgrok() {
  try {
    ngrok('version');
  } catch {
    console.log('\nO ngrok não está instalado neste PC (ele cria o endereço público que a Twilio usa).');
    console.log('  Instale com: winget install ngrok.ngrok');
    console.log('  Depois feche e abra o terminal e rode npm run configurar de novo.');
    return;
  }
  if (ngrokTemAuthtoken()) {
    console.log('\nngrok: já está configurado neste PC.');
    return;
  }
  const token = await perguntar({
    titulo: 'Authtoken do ngrok (use a MESMA conta do ngrok em que está o domínio acima)',
    onde: 'dashboard.ngrok.com > Your Authtoken',
    validar: (v) => (/^\S{20,}$/.test(v) ? null : 'O authtoken é um texto longo, sem espaços.'),
  });
  try {
    ngrok('config', 'add-authtoken', token);
    console.log('  ngrok configurado.');
  } catch (e) {
    console.log(`  Não consegui configurar o ngrok: ${e.message}`);
  }
}

(async () => {
  console.log('Configuração do LembreMed. Enter mantém o valor atual.');

  // Twilio: confere o SID e o token na hora e já sugere o número da conta.
  let numeros = [];
  for (;;) {
    novo.TWILIO_ACCOUNT_SID = await perguntar({
      titulo: 'Twilio: Account SID',
      onde: 'console.twilio.com > página inicial > "Account Info"',
      antes: atual.TWILIO_ACCOUNT_SID,
      segredo: true,
      validar: (v) => (/^AC[0-9a-f]{32}$/i.test(v) ? null : 'Começa com AC e tem 34 caracteres.'),
    });
    novo.TWILIO_AUTH_TOKEN = await perguntar({
      titulo: 'Twilio: Auth Token',
      onde: 'mesmo lugar, logo abaixo (clique em "Show")',
      antes: atual.TWILIO_AUTH_TOKEN,
      segredo: true,
      validar: (v) => (/^[0-9a-f]{32}$/i.test(v) ? null : 'Tem 32 caracteres (letras e números).'),
    });
    const r = await conferirTwilio(novo.TWILIO_ACCOUNT_SID, novo.TWILIO_AUTH_TOKEN);
    if (r.ok) {
      console.log(r.aviso || '  Twilio: conta conferida.');
      numeros = r.numeros;
      break;
    }
    console.log(`  ${r.erro} Vamos de novo.`);
    atual.TWILIO_ACCOUNT_SID = atual.TWILIO_AUTH_TOKEN = '';
  }

  novo.TWILIO_PHONE_NUMBER = await perguntar({
    titulo: `Twilio: número que liga e manda SMS${numeros.length ? ` (números da conta: ${numeros.join(', ')})` : ''}`,
    onde: 'console.twilio.com > Phone Numbers > Manage > Active numbers',
    antes: atual.TWILIO_PHONE_NUMBER || numeros[0] || '',
    normalizar: (v) => v.replace(/[^\d+]/g, ''),
    validar: (v) => (/^\+\d{8,15}$/.test(v) ? null : 'Use o formato internacional, ex.: +15551234567.'),
  });

  const urlAtual = atual.BASE_URL && !atual.BASE_URL.includes('SEU-DOMINIO') ? atual.BASE_URL : '';
  novo.BASE_URL = await perguntar({
    titulo: 'Domínio fixo do ngrok (endereço público do painel e da Twilio), ex.: meu-nome.ngrok-free.dev',
    onde: 'dashboard.ngrok.com > Domains',
    antes: urlAtual,
    normalizar: (v) => `https://${v.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`,
    validar: (v) => (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v) ? null : 'Digite só o domínio, ex.: meu-nome.ngrok-free.dev'),
  });

  await configurarNgrok();

  novo.GOOGLE_CLIENT_ID = await perguntar({
    titulo: 'Google: ID do cliente OAuth (login do painel)',
    onde: 'console.cloud.google.com > Google Auth Platform > Clientes (termina em .apps.googleusercontent.com)',
    antes: atual.GOOGLE_CLIENT_ID,
    validar: (v) => (v.endsWith('.apps.googleusercontent.com') ? null : 'Termina em .apps.googleusercontent.com.'),
  });

  const real = await perguntar({
    titulo: 'Fazer ligações e mandar SMS de verdade? (s = sim, n = só simular)',
    antes: atual.DRY_RUN === 'true' ? 'n' : 's',
    normalizar: (v) => v.toLowerCase().slice(0, 1),
    validar: (v) => (['s', 'n'].includes(v) ? null : 'Responda s ou n.'),
  });
  novo.DRY_RUN = real === 's' ? 'false' : 'true';

  novo.JWT_SECRET = atual.JWT_SECRET || crypto.randomBytes(48).toString('hex');

  // Grava no formato do .env.example (com os comentários); o que não foi perguntado mantém o valor atual.
  const finais = { ...exemplo, ...atual, ...novo };
  const linhas = fs
    .readFileSync(ARQ_EXEMPLO, 'utf8')
    .split(/\r?\n/)
    .map((l) => {
      const m = l.match(/^([A-Z_][A-Z0-9_]*)=/);
      return m ? `${m[1]}=${finais[m[1]] ?? ''}` : l;
    });
  fs.writeFileSync(ARQ_ENV, linhas.join('\n'));

  const descartadas = Object.keys(atual).filter((k) => !(k in exemplo));
  console.log('\nPronto! Configuração salva no arquivo .env.');
  if (descartadas.length) console.log(`(Removi do .env valores que o sistema não usa mais: ${descartadas.join(', ')})`);
  console.log('Para ligar o LembreMed: npm start');
  terminou = true;
  rl.close();
})().catch((e) => {
  console.error(`\nA configuração parou: ${e.message}`);
  process.exit(1);
});
