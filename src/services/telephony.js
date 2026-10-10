const config = require('../config');

async function discar({ paciente, mensagem, chamadaIds }) {
  if (config.dryRun) {
    const callSid = `DRY-${Date.now()}-${chamadaIds[0]}`;
    console.log(`  [SIMULADO] ligando para ${paciente.nome} (${paciente.telefone})`);
    console.log(`  "${mensagem.introducao} ${mensagem.pergunta}"`);
    return { callSid };
  }
  throw new Error('Telefonia real ainda não implementada (Passo 6). Use DRY_RUN=true.');
}

module.exports = { discar };
