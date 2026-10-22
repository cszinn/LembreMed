// npm start: liga tudo com um comando. Abre o túnel do ngrok no domínio fixo do BASE_URL (se ainda não
// estiver aberto neste PC), inicia o servidor e confere pela internet se o painel responde.
// Ctrl+C desliga os dois. Para só o servidor, sem ngrok: npm run servidor
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

if (!fs.existsSync(path.join(__dirname, '..', '.env'))) {
  console.error('Falta o arquivo .env com a configuração. Rode primeiro: npm run configurar');
  process.exit(1);
}

const config = require('./config');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Erros mais comuns do ngrok, explicados
const ERROS_NGROK = [
  [/ERR_NGROK_334|already online/i, 'Esse domínio já está aberto em outro lugar (outro PC ou outra janela do ngrok). Feche o ngrok lá e rode npm start de novo.'],
  [/ERR_NGROK_108|simultaneous/i, 'A conta grátis do ngrok só aceita um ngrok ligado por vez. Feche o outro (neste ou em outro PC) e rode npm start de novo.'],
  [/ERR_NGROK_4018|ERR_NGROK_105|authtoken/i, 'O ngrok deste PC está sem o authtoken (ou com o de outra conta). Rode: npm run configurar'],
  [/ERR_NGROK_(15002|320)|domain|reserved/i, 'Esse domínio não pertence à conta do ngrok configurada neste PC. Confira o BASE_URL e o authtoken (npm run configurar).'],
];

async function tunelJaAberto() {
  try {
    const r = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1500) });
    const { tunnels } = await r.json();
    return tunnels.some((t) => t.public_url === config.baseUrl);
  } catch {
    return false; // nenhum ngrok rodando neste PC
  }
}

async function abrirNgrok() {
  const dominio = new URL(config.baseUrl).host;
  if (!/\.ngrok(-free)?\.(app|dev)$/.test(dominio)) {
    console.log(`[ngrok] BASE_URL não é um domínio do ngrok (${dominio}): não vou abrir túnel.`);
    return;
  }
  if (await tunelJaAberto()) {
    console.log('[ngrok] o túnel já estava aberto neste PC; vou usar o mesmo.');
    return;
  }

  const proc = spawn('ngrok', ['http', `--url=${dominio}`, String(config.port), '--log=stdout', '--log-format=logfmt'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let encerrando = false;
  let avisou = false;
  const lerSaida = (dados) => {
    for (const linha of String(dados).split(/\r?\n/)) {
      if (avisou || !/ERR_NGROK|lvl=(eror|crit)|^ERROR/i.test(linha)) continue;
      avisou = true;
      const explicado = ERROS_NGROK.find(([padrao]) => padrao.test(linha));
      console.error(`[ngrok] ${explicado ? explicado[1] : linha}`);
    }
  };
  proc.stdout.on('data', lerSaida);
  proc.stderr.on('data', lerSaida);
  proc.on('error', (e) => {
    console.error(
      e.code === 'ENOENT'
        ? '[ngrok] O ngrok não está instalado. Instale com: winget install ngrok.ngrok (depois feche e abra o terminal).'
        : `[ngrok] ${e.message}`
    );
  });
  proc.on('exit', (codigo) => {
    if (!encerrando && codigo !== null) console.error(`[ngrok] o túnel fechou (código ${codigo}): as ligações reais vão falhar.`);
  });
  process.on('exit', () => {
    encerrando = true;
    proc.kill();
  });
  process.on('SIGINT', () => process.exit(0));
}

(async () => {
  if (!config.baseUrl) {
    console.error('BASE_URL está vazio no .env. Rode: npm run configurar');
    process.exit(1);
  }
  await abrirNgrok();
  require('./server');

  // Confere de fora, pelo endereço público, se o painel e os webhooks da Twilio respondem.
  for (let i = 0; i < 20; i++) {
    await esperar(1000);
    try {
      const r = await fetch(`${config.baseUrl}/health`, {
        headers: { 'ngrok-skip-browser-warning': '1' },
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) {
        console.log(
          [
            '',
            '==================================================================',
            ` LembreMed no ar (${config.dryRun ? 'SIMULAÇÃO: não liga de verdade' : 'ligações de verdade'})`,
            ` Painel: ${config.baseUrl}`,
            `         (neste PC também: http://localhost:${config.port})`,
            ' Deixe esta janela aberta. Para desligar: Ctrl+C',
            '==================================================================',
            '',
          ].join('\n')
        );
        return;
      }
    } catch {
      // ainda subindo: tenta de novo
    }
  }
  console.warn(
    `\n[aviso] ${config.baseUrl} não respondeu pela internet. O painel funciona em http://localhost:${config.port},` +
      ' mas as ligações reais vão falhar. Veja "Problemas comuns" no README.\n'
  );
})();
