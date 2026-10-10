const db = require('./index');

const total = db.prepare('SELECT COUNT(*) AS n FROM pacientes').get().n;

if (total > 0) {
  console.log('Seed ignorado: já existem pacientes no banco.');
} else {
  const popular = db.transaction(() => {
    const paciente = db
      .prepare(
        `INSERT INTO pacientes (nome, telefone, cuidador_nome, cuidador_telefone)
         VALUES (?, ?, ?, ?)`
      )
      .run('Dona Maria (exemplo)', '+5531900000001', 'Carlos (exemplo)', '+5531900000002');

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
  console.log('Dados de exemplo inseridos.');
}

db.close();
