const express = require('express');
const db = require('../db');
const { limpar, textoValido, normalizarTelefone, horaValida } = require('../validators');
const { exigirAutenticacao } = require('./auth');

const router = express.Router();

// Todas as rotas de gerenciamento abaixo exigem que o cuidador esteja autenticado
router.use(exigirAutenticacao);

const erro = (res, status, mensagem) => res.status(status).json({ erro: mensagem });

router.param('id', (req, res, next, valor) => {
  const id = Number(valor);
  if (!Number.isInteger(id) || id < 1) return erro(res, 400, 'ID inválido.');
  req.id = id;
  next();
});

// ---------- helpers ----------

function lerAtivo(body, atual) {
  if (body.ativo === undefined) return atual;
  return body.ativo === true || body.ativo === 1 ? 1 : 0;
}

function lerDadosPaciente(body) {
  const dados = {
    nome: limpar(body.nome),
    telefone: normalizarTelefone(body.telefone),
  };
  if (!textoValido(dados.nome, 100)) return { mensagem: 'Informe o nome do paciente.' };
  if (!dados.telefone) return { mensagem: 'Telefone do paciente inválido. Use DDD + número, ex.: (31) 98888-7777.' };
  return { dados };
}

function lerMedicamento(body) {
  const dados = { nome: limpar(body.nome), descricao: limpar(body.descricao) };
  if (!textoValido(dados.nome, 100)) return { mensagem: 'Informe o nome do medicamento.' };
  if (!textoValido(dados.descricao, 200)) return { mensagem: 'Informe a descrição amigável, ex.: o comprimido redondo e rosa.' };
  return { dados };
}

function montarMedicamento(id) {
  const med = db.prepare('SELECT * FROM medicamentos WHERE id = ?').get(id);
  if (!med) return null;
  med.horarios = db.prepare('SELECT * FROM horarios WHERE medicamento_id = ? ORDER BY hora').all(id);
  return med;
}

function montarPaciente(id, cuidadorId) {
  const paciente = db.prepare('SELECT * FROM pacientes WHERE id = ? AND cuidador_id = ?').get(id, cuidadorId);
  if (!paciente) return null;
  const meds = db.prepare('SELECT * FROM medicamentos WHERE paciente_id = ? ORDER BY nome').all(id);
  const horarios = db
    .prepare(
      `SELECT h.* FROM horarios h
       JOIN medicamentos m ON m.id = h.medicamento_id
       WHERE m.paciente_id = ? ORDER BY h.hora`
    )
    .all(id);
  paciente.medicamentos = meds.map((m) => ({
    ...m,
    horarios: horarios.filter((h) => h.medicamento_id === m.id),
  }));
  return paciente;
}

// ---------- estatísticas do cuidador logado ----------

router.get('/estatisticas', (req, res) => {
  try {
    const cuidadorId = req.cuidador.id;

    const pacientesStats = db
      .prepare(
        `SELECT 
          count(*) AS total, 
          coalesce(sum(CASE WHEN ativo = 1 THEN 1 ELSE 0 END), 0) AS ativos 
        FROM pacientes WHERE cuidador_id = ?`
      )
      .get(cuidadorId) || { total: 0, ativos: 0 };

    const totalMedicamentos =
      db
        .prepare(
          `SELECT count(*) AS total FROM medicamentos m
           JOIN pacientes p ON p.id = m.paciente_id
           WHERE p.cuidador_id = ?`
        )
        .get(cuidadorId)?.total || 0;

    const totalHorarios =
      db
        .prepare(
          `SELECT count(*) AS total FROM horarios h
           JOIN medicamentos m ON m.id = h.medicamento_id
           JOIN pacientes p ON p.id = m.paciente_id
           WHERE p.cuidador_id = ? AND h.ativo = 1`
        )
        .get(cuidadorId)?.total || 0;

    const hoje = new Date().toISOString().slice(0, 10);
    const chamadasHoje =
      db
        .prepare(
          `SELECT 
            count(*) AS total,
            coalesce(sum(CASE WHEN c.status = 'confirmada' THEN 1 ELSE 0 END), 0) AS confirmadas,
            coalesce(sum(CASE WHEN c.status = 'escalonada' THEN 1 ELSE 0 END), 0) AS alertas,
            coalesce(sum(CASE WHEN c.status = 'discando' THEN 1 ELSE 0 END), 0) AS discando
          FROM chamadas c
          JOIN horarios h ON h.id = c.horario_id
          JOIN medicamentos m ON m.id = h.medicamento_id
          JOIN pacientes p ON p.id = m.paciente_id
          WHERE p.cuidador_id = ? AND c.data = ?`
        )
        .get(cuidadorId, hoje) || { total: 0, confirmadas: 0, alertas: 0, discando: 0 };

    res.json({
      cuidador: req.cuidador,
      pacientes: {
        total: pacientesStats.total || 0,
        ativos: pacientesStats.ativos || 0,
      },
      medicamentos: totalMedicamentos,
      horarios: totalHorarios,
      hoje: {
        data: hoje,
        total: chamadasHoje.total || 0,
        confirmadas: chamadasHoje.confirmadas || 0,
        alertas: chamadasHoje.alertas || 0,
        discando: chamadasHoje.discando || 0,
      },
    });
  } catch (e) {
    console.error('Erro ao buscar estatísticas:', e);
    erro(res, 500, 'Erro ao carregar estatísticas.');
  }
});

// ---------- pacientes do cuidador ----------

router.get('/pacientes', (req, res) => {
  const lista = db.prepare('SELECT * FROM pacientes WHERE cuidador_id = ? ORDER BY nome').all(req.cuidador.id);
  res.json(lista);
});

router.get('/pacientes/:id', (req, res) => {
  const paciente = montarPaciente(req.id, req.cuidador.id);
  if (!paciente) return erro(res, 404, 'Paciente não encontrado.');
  res.json(paciente);
});

router.get('/pacientes/:id/chamadas', (req, res) => {
  try {
    const paciente = db.prepare('SELECT id FROM pacientes WHERE id = ? AND cuidador_id = ?').get(req.id, req.cuidador.id);
    if (!paciente) return erro(res, 404, 'Paciente não encontrado.');

    const chamadas = db
      .prepare(
        `SELECT c.id, c.data, c.tentativa, c.status, c.criado_em, c.atualizado_em,
                h.hora, m.nome AS medicamento
         FROM chamadas c
         JOIN horarios h ON h.id = c.horario_id
         JOIN medicamentos m ON m.id = h.medicamento_id
         WHERE m.paciente_id = ?
         ORDER BY c.data DESC, h.hora DESC, c.tentativa DESC
         LIMIT 20`
      )
      .all(req.id);
    res.json(chamadas);
  } catch (e) {
    console.error('Erro ao buscar chamadas do paciente:', e);
    erro(res, 500, 'Erro ao carregar chamadas.');
  }
});

// Cadastro de Paciente: vinculado automaticamente ao cuidador logado
router.post('/pacientes', (req, res) => {
  const { dados, mensagem } = lerDadosPaciente(req.body || {});
  if (mensagem) return erro(res, 400, mensagem);

  const info = db
    .prepare(
      `INSERT INTO pacientes (cuidador_id, nome, telefone, cuidador_nome, cuidador_telefone)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(req.cuidador.id, dados.nome, dados.telefone, req.cuidador.nome, req.cuidador.telefone);

  res.status(201).json(montarPaciente(info.lastInsertRowid, req.cuidador.id));
});

// Atualização de Paciente: altera apenas os dados do paciente (nome, telefone e ativo)
router.put('/pacientes/:id', (req, res) => {
  const existente = db.prepare('SELECT * FROM pacientes WHERE id = ? AND cuidador_id = ?').get(req.id, req.cuidador.id);
  if (!existente) return erro(res, 404, 'Paciente não encontrado.');

  const body = req.body || {};
  const { dados, mensagem } = lerDadosPaciente(body);
  if (mensagem) return erro(res, 400, mensagem);

  const ativo = lerAtivo(body, existente.ativo);

  db.prepare(
    `UPDATE pacientes 
     SET nome = ?, telefone = ?, ativo = ? 
     WHERE id = ? AND cuidador_id = ?`
  ).run(dados.nome, dados.telefone, ativo, req.id, req.cuidador.id);

  res.json(montarPaciente(req.id, req.cuidador.id));
});

router.delete('/pacientes/:id', (req, res) => {
  const info = db.prepare('DELETE FROM pacientes WHERE id = ? AND cuidador_id = ?').run(req.id, req.cuidador.id);
  if (info.changes === 0) return erro(res, 404, 'Paciente não encontrado.');
  res.status(204).end();
});

// ---------- medicamentos ----------

router.post('/pacientes/:id/medicamentos', (req, res) => {
  const paciente = db.prepare('SELECT id FROM pacientes WHERE id = ? AND cuidador_id = ?').get(req.id, req.cuidador.id);
  if (!paciente) return erro(res, 404, 'Paciente não encontrado.');

  const body = req.body || {};
  const { dados, mensagem } = lerMedicamento(body);
  if (mensagem) return erro(res, 400, mensagem);

  const horarios = body.horarios === undefined ? [] : body.horarios;
  if (!Array.isArray(horarios) || !horarios.every((h) => horaValida(h))) {
    return erro(res, 400, 'Horários inválidos. Use o formato HH:MM, ex.: 08:00.');
  }

  const criar = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO medicamentos (paciente_id, nome, descricao) VALUES (?, ?, ?)')
      .run(req.id, dados.nome, dados.descricao);
    const inserir = db.prepare('INSERT INTO horarios (medicamento_id, hora) VALUES (?, ?)');
    [...new Set(horarios)].forEach((h) => inserir.run(info.lastInsertRowid, h));
    return info.lastInsertRowid;
  });

  res.status(201).json(montarMedicamento(criar()));
});

router.put('/medicamentos/:id', (req, res) => {
  // Garante que o medicamento pertence a um paciente do cuidador logado
  const existente = db
    .prepare(
      `SELECT m.* FROM medicamentos m
       JOIN pacientes p ON p.id = m.paciente_id
       WHERE m.id = ? AND p.cuidador_id = ?`
    )
    .get(req.id, req.cuidador.id);

  if (!existente) return erro(res, 404, 'Medicamento não encontrado.');

  const body = req.body || {};
  const { dados, mensagem } = lerMedicamento(body);
  if (mensagem) return erro(res, 400, mensagem);

  const ativo = lerAtivo(body, existente.ativo);
  db.prepare('UPDATE medicamentos SET nome = ?, descricao = ?, ativo = ? WHERE id = ?').run(
    dados.nome,
    dados.descricao,
    ativo,
    req.id
  );

  res.json(montarMedicamento(req.id));
});

router.delete('/medicamentos/:id', (req, res) => {
  const info = db
    .prepare(
      `DELETE FROM medicamentos WHERE id = ? AND paciente_id IN (
        SELECT id FROM pacientes WHERE cuidador_id = ?
      )`
    )
    .run(req.id, req.cuidador.id);

  if (info.changes === 0) return erro(res, 404, 'Medicamento não encontrado.');
  res.status(204).end();
});

// ---------- horários ----------

router.post('/medicamentos/:id/horarios', (req, res) => {
  const med = db
    .prepare(
      `SELECT m.id FROM medicamentos m
       JOIN pacientes p ON p.id = m.paciente_id
       WHERE m.id = ? AND p.cuidador_id = ?`
    )
    .get(req.id, req.cuidador.id);

  if (!med) return erro(res, 404, 'Medicamento não encontrado.');

  const hora = limpar((req.body || {}).hora);
  if (!horaValida(hora)) return erro(res, 400, 'Horário inválido. Use o formato HH:MM, ex.: 08:00.');

  try {
    const info = db.prepare('INSERT INTO horarios (medicamento_id, hora) VALUES (?, ?)').run(req.id, hora);
    res.status(201).json(db.prepare('SELECT * FROM horarios WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return erro(res, 409, 'Esse horário já existe para este medicamento.');
    }
    throw e;
  }
});

router.delete('/horarios/:id', (req, res) => {
  const info = db
    .prepare(
      `DELETE FROM horarios WHERE id = ? AND medicamento_id IN (
        SELECT m.id FROM medicamentos m
        JOIN pacientes p ON p.id = m.paciente_id
        WHERE p.cuidador_id = ?
      )`
    )
    .run(req.id, req.cuidador.id);

  if (info.changes === 0) return erro(res, 404, 'Horário não encontrado.');
  res.status(204).end();
});

router.use((req, res) => erro(res, 404, 'Rota não encontrada.'));

module.exports = router;
