const ORDINAIS = ['Primeiro', 'Segundo', 'Terceiro', 'Quarto', 'Quinto'];

// "Dona Maria (exemplo)" -> "Dona Maria"
function nomeFalado(nome) {
  return nome.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

// "Losartana", "Losartana e Metformina", "A, B e C"
function lista(nomes) {
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
}

// Primeira frase de toda ligação. É sempre igual, então a Twilio guarda o áudio pronto e ele toca logo que
// a ligação conecta (o texto com o nome da pessoa é gerado na hora e demora mais). Se o começo do áudio
// chegar cortado pela rota internacional, perde-se só esta frase, e a pessoa já sabe quem está ligando.
const ABERTURA = 'Olá! Aqui é o LembreMed.';

// Texto falado depois da abertura, em cada tipo de ligação:
//  - lembrete (no horário): diz o(s) remédio(s) com a descrição e pergunta se já tomou;
//  - confirmacao (minutos depois, se ainda não tinha tomado): só pergunta se já tomou.
function montarMensagem(nomePaciente, itens, tipo = 'confirmacao') {
  const nome = nomeFalado(nomePaciente);
  const varios = itens.length > 1;

  if (tipo === 'lembrete') {
    const remedios = varios
      ? `está na hora de ${itens.length} remédios. ` +
        itens.map((i, n) => `${ORDINAIS[n] || `Remédio ${n + 1}`}: ${i.medicamento}, ${i.descricao}.`).join(' ')
      : `está na hora do seu remédio: ${itens[0].medicamento}, ${itens[0].descricao}.`;
    return `${nome}, ${remedios} ${varios ? 'Você já tomou os remédios?' : 'Você já tomou?'}`;
  }

  const nomes = lista(itens.map((i) => i.medicamento));
  return varios ? `${nome}, você já tomou os seus remédios: ${nomes}?` : `${nome}, você já tomou o seu remédio, ${nomes}?`;
}

// Fala de quando o paciente atende e ainda não tomou (disse outra coisa ou ficou em silêncio).
function respostaSemConfirmar(minutos, silencio) {
  const inicio = silencio ? 'Não ouvi a sua resposta.' : 'Tudo bem.';
  if (!minutos) return `${inicio} Não esqueça de tomar o seu remédio. Até logo.`;
  return `${inicio} Tome o seu remédio agora, por favor. Te ligo de novo em ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} para confirmar. Até logo.`;
}

module.exports = { ABERTURA, montarMensagem, respostaSemConfirmar };
