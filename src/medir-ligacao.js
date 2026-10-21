// Mede quanto tempo a Twilio leva para cada etapa da ligação.
// Não usa ngrok nem o seu banco: o texto falado vai direto na chamada.
// Uso (dentro da pasta do projeto): node src/medir-ligacao.js +5531999999999
process.env.DRY_RUN = 'false';

const config = require('./config');
const { getClient } = require('./services/twilioClient');

const telefone = process.argv[2];
if (!/^\+55\d{10,11}$/.test(telefone || '')) {
    console.error('Uso: node src/medir-ligacao.js +5531999999999');
    process.exit(1);
}

const FINAIS = ['completed', 'busy', 'failed', 'no-answer', 'canceled'];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const t0 = Date.now();
    const seg = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;

    console.log(`Origem (from): ${config.twilio.phoneNumber}`);
    console.log(`Destino (to):  ${telefone}`);

    const criada = await getClient().calls.create({
        to: telefone,
        from: config.twilio.phoneNumber,
        twiml:
            '<Response><Say voice="Polly.Vitoria" language="pt-BR">Teste de atraso. Pode desligar.</Say><Pause length="2"/></Response>',
        timeout: 60,
    });
    console.log(`${seg()}  Twilio aceitou o pedido (${criada.sid}), status=${criada.status}`);
    console.log('>>> Anote o momento em que o celular REALMENTE tocar e compare com a linha "ringing".');

    let ultimo = criada.status;
    while (true) {
        await esperar(500);
        const c = await getClient().calls(criada.sid).fetch();
        if (c.status !== ultimo) {
            console.log(`${seg()}  status = ${c.status}`);
            ultimo = c.status;
        }
        if (FINAIS.includes(c.status)) {
            console.log(`Duração: ${c.duration}s | Preço: ${c.price} ${c.priceUnit}`);
            console.log('Abra este SID em Monitor > Logs > Calls para ver o detalhe da rota.');
            break;
        }
    }
})().catch((e) => console.error('Falhou:', e.message));