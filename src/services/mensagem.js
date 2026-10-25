const ORDINAIS = ['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto'];

// "Dona Maria (exemplo)" -> "Dona Maria"
function nomeFalado(nome) {
  return nome.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

// "Losartana", "Losartana e Metformina", "A, B e C"
function lista(nomes) {
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
}

// Texto falado em cada tipo de ligação:
//  - lembrete (no horário): diz o(s) remédio(s) com a descrição e pergunta se já tomou;
//  - confirmacao (minutos depois, se ainda não tinha tomado): só pergunta se já tomou.
function montarMensagem(nomePaciente, itens, tipo = 'confirmacao') {
  const nome = nomeFalado(nomePaciente);
  const varios = itens.length > 1;

  if (tipo === 'lembrete') {
    const remedios = varios
      ? `Está na hora de ${itens.length} remédios. ` +
        itens.map((i, n) => `${ORDINAIS[n] || `Remédio ${n + 1}`}: ${i.medicamento}, ${i.descricao}.`).join(' ')
      : `Está na hora do seu remédio: ${itens[0].medicamento}, ${itens[0].descricao}.`;
    return `Olá, ${nome}. ${remedios} ${varios ? 'Você já tomou os remédios?' : 'Você já tomou?'}`;
  }

  const nomes = lista(itens.map((i) => i.medicamento));
  return varios
    ? `Olá, ${nome}. Você já tomou os seus remédios: ${nomes}?`
    : `Olá, ${nome}. Você já tomou o seu remédio, ${nomes}?`;
}

// Fala de quando o paciente atende e ainda não tomou (disse outra coisa ou ficou em silêncio).
function respostaSemConfirmar(minutos, silencio) {
  const inicio = silencio ? 'Não ouvi a sua resposta.' : 'Tudo bem.';
  if (!minutos) return `${inicio} Não esqueça de tomar o seu remédio. Até logo.`;
  return `${inicio} Tome o seu remédio agora, por favor. Te ligo de novo em ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} para confirmar. Até logo.`;
}

module.exports = { montarMensagem, respostaSemConfirmar };
