const ORDINAIS = ['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto'];

// "Dona Maria (exemplo)" -> "Dona Maria"
function nomeFalado(nome) {
  return nome.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

// Texto curto: diz o(s) remédio(s) com a descrição amigável e só pergunta se já tomou.
function montarMensagem(nomePaciente, itens) {
  const nome = nomeFalado(nomePaciente);
  const varios = itens.length > 1;

  const introducao = varios
    ? `Olá, ${nome}. Está na hora de ${itens.length} remédios. ` +
      itens
        .map((i, n) => `${ORDINAIS[n] || `Remédio ${n + 1}`}: ${i.medicamento}, ${i.descricao}.`)
        .join(' ')
    : `Olá, ${nome}. Está na hora do seu remédio: ${itens[0].medicamento}, ${itens[0].descricao}.`;

  const pergunta = varios ? 'Você já tomou os remédios?' : 'Você já tomou?';

  return { introducao, pergunta };
}

module.exports = { montarMensagem };
