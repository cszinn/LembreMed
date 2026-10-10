const ORDINAIS = ['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto'];

// "Dona Maria (exemplo)" -> "Dona Maria"
function nomeFalado(nome) {
  return nome.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

function montarMensagem(nomePaciente, itens) {
  const nome = nomeFalado(nomePaciente);
  const varios = itens.length > 1;

  const introducao = varios
    ? `Olá, ${nome}. Está na hora de tomar ${itens.length} remédios. ` +
      itens
        .map((i, n) => `${ORDINAIS[n] || `Remédio ${n + 1}`}: ${i.medicamento}, ${i.descricao}.`)
        .join(' ')
    : `Olá, ${nome}. Está na hora do seu remédio. Pegue ${itens[0].medicamento}: ${itens[0].descricao}.`;

  const pergunta = varios
    ? 'Quando estiver com os remédios na mão, aperte o número 1 no teclado do telefone.'
    : 'Quando estiver com o remédio na mão, aperte o número 1 no teclado do telefone.';

  return { introducao, pergunta };
}

module.exports = { montarMensagem };
