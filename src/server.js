const path = require('path');
const express = require('express');
const config = require('./config');
const api = require('./routes/api');
const twilioRoutes = require('./routes/twilio');
const scheduler = require('./services/scheduler');
const escalonamento = require('./services/escalonamento');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', api);
app.use('/twilio', twilioRoutes);

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido.' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

app.listen(config.port, (err) => {
  // No Express 5 este callback também recebe erros (ex.: porta ocupada). Sem este teste, uma segunda
  // instância ficava sem porta mas com o agendador ligado: alertas duplicados e ligações sem webhook.
  if (err) {
    console.error(`Não foi possível abrir a porta ${config.port}: ${err.message}`);
    if (err.code === 'EADDRINUSE') console.error('Já existe outro servidor rodando. Feche-o antes de iniciar este.');
    process.exit(1);
  }
  console.log(`Servidor em http://localhost:${config.port} (DRY_RUN=${config.dryRun})`);
  scheduler.iniciar();
  escalonamento.iniciar();
});
