const db = require('./index');

const total = db.prepare('SELECT COUNT(*) AS n FROM pacientes').get().n;
// Os pacientes aparecem no painel do cuidador dono deles: o exemplo vai para a primeira conta.
const cuidador = db.prepare('SELECT id, nome FROM cuidadores ORDER BY id LIMIT 1').get();

if (total > 0) {
  console.log('Seed ignorado: já existem pacientes no banco.');
} else if (!cuidador) {
  console.log('Seed ignorado: crie primeiro uma conta de cuidador no painel (http://localhost:3000).');
} else {
  const popular = db.transaction(() => {
    // O telefone de exemplo não existe: o paciente entra PAUSADO para o sistema não ligar para ele.
    const paciente = db
      .prepare(
        'INSERT INTO pacientes (cuidador_id, nome, telefone, ativo) VALUES (?, ?, ?, 0)'
      )
      .run(cuidador.id, 'Dona Maria (exemplo)', '+5531900000001');

    const inserirMed = db.prepare(
      'INSERT INTO medicamentos (paciente_id, nome, descricao) VALUES (?, ?, ?)'
    );
    const inserirHora = db.prepare(
      'INSERT INTO horarios (medicamento_id, hora) VALUES (?, ?)'
    );

    const losartana = inserirMed.run(paciente.lastInsertRowid, 'Losartana', 'o comprimido redondo e rosa');
    inserirHora.run(losartana.lastInsertRowid, '08:00');
    inserirHora.run(losartana.lastInsertRowid, '20:00');

    const metformina = inserirMed.run(paciente.lastInsertRowid, 'Metformina', 'a caixa amarela');
    inserirHora.run(metformina.lastInsertRowid, '12:00');
  });

  popular();
  console.log(`Dados de exemplo inseridos na conta de ${cuidador.nome} (paciente pausado: troque o telefone antes de ativar).`);
}

db.close();
