const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Escape seguro de HTML
const esc = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Normalização e máscaras de telefone
function normalizarDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function fmtTel(t) {
  if (!t) return '';
  const d = normalizarDigitos(t);
  const sem55 = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (sem55.length === 11) {
    return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 7)}-${sem55.slice(7)}`;
  }
  if (sem55.length === 10) {
    return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 6)}-${sem55.slice(6)}`;
  }
  return t;
}

function aplicarMascaraTelefone(input) {
  let v = normalizarDigitos(input.value);
  if (v.length > 11) v = v.slice(0, 11);

  if (v.length > 6) {
    if (v.length <= 10) {
      input.value = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
    } else {
      input.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
    }
  } else if (v.length > 2) {
    input.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
  } else if (v.length > 0) {
    input.value = `(${v}`;
  }
}

// Iniciais e Cores para Avatares
const PALETA_AVATARES = [
  { bg: '#ccfbf1', text: '#0f766e' }, // teal
  { bg: '#e0f2fe', text: '#0369a1' }, // sky
  { bg: '#e0e7ff', text: '#4338ca' }, // indigo
  { bg: '#fef3c7', text: '#b45309' }, // amber
  { bg: '#dcfce7', text: '#15803d' }, // green
  { bg: '#fae8ff', text: '#86198f' }, // fuchsia
];

function corAvatar(str) {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) hash = (hash << 5) - hash + str.charCodeAt(i);
  return PALETA_AVATARES[Math.abs(hash) % PALETA_AVATARES.length];
}

function obterIniciais(nome) {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'P';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function parseHorarios(txt) {
  return [...new Set(
    (txt || '')
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map((h) => (/^\d:\d{2}$/.test(h) ? '0' + h : h))
  )];
}

// Comunicação com a API com Token Bearer
async function api(url, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('lembremed_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api' + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/cadastro')) {
    fazerLogout(false);
    throw new Error('Sua sessão expirou. Faça login novamente.');
  }

  if (!res.ok) throw new Error(data.erro || 'Ocorreu um erro no servidor.');
  return data;
}

// Sistema de Notificações Toast
function toast(msg, tipo = 'info') {
  const c = $('#toastContainer');
  if (!c) return;

  const icone =
    tipo === 'success'
      ? '<i class="bi bi-check-circle-fill text-success fs-5"></i>'
      : tipo === 'error'
      ? '<i class="bi bi-exclamation-triangle-fill text-danger fs-5"></i>'
      : '<i class="bi bi-info-circle-fill text-primary fs-5"></i>';

  const t = document.createElement('div');
  t.className = `toast-custom ${tipo}`;
  t.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      ${icone}
      <span class="small fw-semibold">${esc(msg)}</span>
    </div>
    <button type="button" class="btn-close btn-sm" aria-label="Fechar"></button>
  `;

  t.querySelector('.btn-close').addEventListener('click', () => t.remove());
  c.appendChild(t);

  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(100%)';
    t.style.transition = 'all 0.3s ease';
    setTimeout(() => t.remove(), 300);
  }, 4200);
}

function fecharModal(id) {
  const el = $('#' + id);
  if (el) {
    const inst = bootstrap.Modal.getInstance(el) || new bootstrap.Modal(el);
    inst.hide();
  }
}

function fecharMenuLateral() {
  const el = $('#menuLateral');
  if (el) {
    const inst = bootstrap.Offcanvas.getInstance(el);
    if (inst) inst.hide();
  }
}

// Estado Global
let cuidadorLogado = null;
let pacientes = [];
let pacienteAtual = null;
let selecionadoId = localStorage.getItem('lembremed_paciente_id')
  ? Number(localStorage.getItem('lembremed_paciente_id'))
  : null;
let filtroBusca = '';

// Alternar entre Telas (Auth vs App Principal)
function exibirTelaAuth() {
  $('#telaAuth').classList.remove('d-none');
  $('#appPrincipal').classList.add('d-none');
}

function exibirAppPrincipal() {
  $('#telaAuth').classList.add('d-none');
  $('#appPrincipal').classList.remove('d-none');
}

function fazerLogout(avisar = true) {
  localStorage.removeItem('lembremed_token');
  localStorage.removeItem('lembremed_paciente_id');
  cuidadorLogado = null;
  pacienteAtual = null;
  selecionadoId = null;
  pacientes = [];
  exibirTelaAuth();
  if (avisar) toast('Você saiu da sua conta.', 'info');
}

// Atualizar Informações do Cuidador na Interface
function renderCuidador() {
  if (!cuidadorLogado) return;
  const c = cuidadorLogado;
  
  $('#sidebarCuidadorNome').textContent = c.nome;
  $('#sidebarCuidadorEmail').textContent = c.email;
  $('#sidebarCuidadorTelefone').textContent = fmtTel(c.telefone);
  
  const iniciais = obterIniciais(c.nome);
  const avatar = $('#sidebarCuidadorAvatar');
  if (avatar) avatar.textContent = iniciais;
}

// Renderização da Lista de Pacientes no Menu Lateral
function renderListaLateral() {
  const lista = $('#listaPacientes');
  const badgeQtd = $('#badgeQtdPacientes');
  if (badgeQtd) badgeQtd.textContent = pacientes.length;

  const termo = filtroBusca.toLowerCase().trim();
  const filtrados = pacientes.filter(
    (p) => p.nome.toLowerCase().includes(termo) || p.telefone.includes(termo)
  );

  if (!filtrados.length) {
    lista.innerHTML = `
      <div class="text-center py-4 text-muted small bg-white rounded-3 border">
        <i class="bi bi-person-x fs-3 d-block mb-1 text-light"></i>
        ${termo ? 'Nenhum paciente encontrado.' : 'Você ainda não cadastrou pacientes.'}
      </div>`;
    return;
  }

  lista.innerHTML = filtrados
    .map((p) => {
      const cor = corAvatar(p.nome);
      const iniciais = obterIniciais(p.nome);
      const isAtivo = p.ativo === 1 || p.ativo === true;
      const isSel = p.id === selecionadoId;

      return `
      <div class="patient-item ${isSel ? 'active' : ''}" data-acao="selecionar-paciente" data-id="${p.id}">
        <div class="d-flex align-items-center gap-3">
          <div class="avatar-circle" style="background-color: ${cor.bg}; color: ${cor.text}; width: 38px; height: 38px; font-size: 0.85rem;">
            ${iniciais}
          </div>
          <div>
            <div class="patient-name text-truncate" style="max-width: 150px; font-size: 0.9rem;">${esc(p.nome)}</div>
            <div class="small text-muted" style="font-size: 0.78rem;">${esc(fmtTel(p.telefone))}</div>
          </div>
        </div>
        <div class="text-end">
          <span class="badge-pill-soft ${isAtivo ? 'active' : 'paused'}" style="font-size: 0.68rem; padding: 2px 8px;">
            ${isAtivo ? 'Ativo' : 'Pausado'}
          </span>
        </div>
      </div>`;
    })
    .join('');
}

// Renderização do Histórico de Chamadas
async function carregarHistoricoChamadas(pacienteId) {
  const el = $('#historicoChamadasContainer');
  if (!el) return;

  try {
    const chamadas = await api(`/pacientes/${pacienteId}/chamadas`);
    if (!chamadas.length) {
      el.innerHTML = '<div class="text-muted small py-4 text-center">Nenhuma chamada realizada para este paciente ainda.</div>';
      return;
    }

    el.innerHTML = `
      <div class="table-responsive">
        <table class="table history-table mb-0">
          <thead>
            <tr>
              <th>Data</th>
              <th>Horário da Dose</th>
              <th>Medicamento</th>
              <th>Tentativa</th>
              <th>Status do Atendimento</th>
            </tr>
          </thead>
          <tbody>
            ${chamadas
              .map((c) => {
                let badgeClass = 'bg-secondary';
                let icone = 'bi-telephone';
                let label = c.status;

                if (c.status === 'confirmada') {
                  badgeClass = 'bg-success';
                  icone = 'bi-check-circle-fill';
                  label = 'Confirmou no Telefone (1)';
                } else if (c.status === 'sem_resposta') {
                  badgeClass = 'bg-warning text-dark';
                  icone = 'bi-telephone-x-fill';
                  label = 'Sem resposta / Ocupado';
                } else if (c.status === 'falhou') {
                  badgeClass = 'bg-danger';
                  icone = 'bi-exclamation-octagon-fill';
                  label = 'Falhou ao discar';
                } else if (c.status === 'escalonada') {
                  badgeClass = 'bg-danger';
                  icone = 'bi-shield-fill-exclamation';
                  label = 'Cuidador Alertado (SMS/Zap)';
                } else if (c.status === 'discando') {
                  badgeClass = 'bg-info text-dark';
                  icone = 'bi-telephone-outbound';
                  label = 'Discando...';
                }

                return `
                <tr>
                  <td class="fw-semibold">${esc(c.data)}</td>
                  <td><span class="badge bg-light text-dark border px-2 py-1">${esc(c.hora || '--:--')}</span></td>
                  <td class="fw-medium">${esc(c.medicamento || 'Geral')}</td>
                  <td><span class="text-muted small">${c.tentativa}ª tentativa</span></td>
                  <td>
                    <span class="badge ${badgeClass} d-inline-flex align-items-center gap-1 py-1 px-2">
                      <i class="bi ${icone}"></i> ${label}
                    </span>
                  </td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="text-danger small py-3 text-center">Não foi possível carregar o histórico de chamadas.</div>`;
  }
}

// Renderização Completa do Paciente Ativo
function renderPacientePrincipal(p) {
  pacienteAtual = p;
  const cor = corAvatar(p.nome);
  const iniciais = obterIniciais(p.nome);
  const isAtivo = p.ativo === 1 || p.ativo === true;

  // Atualiza chip da Navbar
  const navAvatar = $('#navAvatar');
  const navNome = $('#navPacienteNome');
  if (navAvatar && navNome) {
    navAvatar.textContent = iniciais;
    navAvatar.style.backgroundColor = cor.bg;
    navAvatar.style.color = cor.text;
    navNome.textContent = p.nome;
  }

  const totalHorarios = p.medicamentos.reduce((acc, m) => acc + (m.horarios?.length || 0), 0);

  const medsHtml =
    p.medicamentos.length > 0
      ? p.medicamentos
          .map((m) => `
          <div class="med-card">
            <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
              <div>
                <h4 class="h5 fw-bold mb-1 d-flex align-items-center gap-2">
                  <i class="bi bi-capsule text-primary"></i>
                  <span>${esc(m.nome)}</span>
                </h4>
                <div class="med-voice-box mt-2">
                  <i class="bi bi-soundwave text-primary me-1 fs-6"></i>
                  <strong>Roteiro falado pela assistente:</strong> "Pegue <em>${esc(m.descricao)}</em>"
                </div>
              </div>
              
              <div class="d-flex align-items-center gap-2">
                <button class="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" data-acao="editar-med" data-id="${m.id}" title="Editar Medicamento">
                  <i class="bi bi-pencil"></i> <span>Editar</span>
                </button>
                <button class="btn btn-sm btn-soft-danger d-flex align-items-center gap-1" data-acao="del-med" data-id="${m.id}" title="Remover Medicamento">
                  <i class="bi bi-trash"></i> <span>Excluir</span>
                </button>
              </div>
            </div>

            <div class="mt-3 pt-2 border-top">
              <label class="form-label small text-muted text-uppercase mb-2" style="letter-spacing:0.04em;">Horários da Dose:</label>
              <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
                ${
                  m.horarios && m.horarios.length > 0
                    ? m.horarios
                        .map(
                          (h) => `
                        <div class="time-chip shadow-sm">
                          <i class="bi bi-clock-fill text-muted" style="font-size:0.75rem;"></i>
                          <span>${esc(h.hora)}</span>
                          <button type="button" class="btn-del-time ms-1" data-acao="del-horario" data-id="${h.id}" title="Remover horário">&times;</button>
                        </div>`
                        )
                        .join('')
                    : '<span class="text-muted small fst-italic">Nenhum horário cadastrado para este remédio.</span>'
                }
              </div>

              <!-- Form Inline de Adicionar Horário -->
              <form class="d-flex gap-2 align-items-center" data-form="horario" data-id="${m.id}">
                <div class="input-group input-group-sm" style="max-width: 200px;">
                  <span class="input-group-text bg-white"><i class="bi bi-plus-circle text-primary"></i></span>
                  <input type="time" name="hora" class="form-control" required>
                </div>
                <button type="submit" class="btn btn-sm btn-outline-primary fw-semibold">+ Adicionar Horário</button>
              </form>
            </div>
          </div>`)
          .join('')
      : `
        <div class="card-custom p-5 text-center text-muted mb-4">
          <i class="bi bi-capsule fs-1 text-light d-block mb-3"></i>
          <h4 class="h6 fw-bold text-dark">Nenhum medicamento cadastrado</h4>
          <p class="mb-3 small">Adicione o primeiro medicamento deste paciente para iniciar o monitoramento das doses.</p>
          <button class="btn btn-sm btn-primary-custom" data-bs-toggle="modal" data-bs-target="#modalNovoMedicamento">
            <i class="bi bi-plus-lg me-1"></i> Cadastrar Medicamento
          </button>
        </div>`;

  $('#painelPacientePrincipal').innerHTML = `
    <!-- Card Principal de Identificação do Paciente -->
    <div class="card-custom mb-4 shadow-sm">
      <div class="p-4">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-4">
          
          <!-- Lado Esquerdo: Avatar, Nome e Contatos -->
          <div class="d-flex align-items-center gap-3">
            <div class="avatar-circle avatar-lg shadow-sm" style="background-color: ${cor.bg}; color: ${cor.text};">
              ${iniciais}
            </div>
            <div>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <h1 class="h3 fw-bold mb-0 text-dark">${esc(p.nome)}</h1>
                <span class="badge-pill-soft ${isAtivo ? 'active' : 'paused'}">
                  <span class="rounded-circle ${isAtivo ? 'bg-success' : 'bg-secondary'}" style="width:7px; height:7px;"></span>
                  ${isAtivo ? 'Ligações Automáticas Ativas' : 'Monitoramento Pausado'}
                </span>
              </div>
              
              <div class="d-flex align-items-center gap-3 mt-2 flex-wrap">
                <span class="text-muted d-flex align-items-center gap-1">
                  <i class="bi bi-telephone-fill text-primary"></i>
                  <span class="fw-semibold text-dark">${esc(fmtTel(p.telefone))}</span>
                </span>
                <a href="https://wa.me/55${normalizarDigitos(p.telefone)}" target="_blank" 
                   class="btn btn-sm btn-outline-success py-0 px-2 rounded-pill small d-inline-flex align-items-center gap-1">
                  <i class="bi bi-whatsapp"></i> WhatsApp
                </a>
              </div>
            </div>
          </div>

          <!-- Lado Direito: Ações Principais -->
          <div class="d-flex flex-column align-items-md-end gap-2">
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-primary-custom d-flex align-items-center gap-2 py-2 px-3 shadow-sm" 
                      data-acao="editar-paciente" data-id="${p.id}">
                <i class="bi bi-pencil-square"></i>
                <span>Editar Paciente</span>
              </button>
              <button class="btn btn-soft-danger d-flex align-items-center gap-1 py-2 px-3" 
                      data-acao="del-paciente" data-id="${p.id}">
                <i class="bi bi-trash"></i>
                <span class="d-none d-sm-inline">Excluir</span>
              </button>
            </div>
            
            <div class="form-check form-switch mt-1">
              <input class="form-check-input" type="checkbox" role="switch" id="swAtivo" data-acao="toggle-paciente" ${isAtivo ? 'checked' : ''}>
              <label class="form-check-label small fw-semibold text-muted" for="swAtivo">
                ${isAtivo ? 'Pausar ligações' : 'Ativar ligações'}
              </label>
            </div>
          </div>

        </div>

        <hr class="my-4">

        <!-- Informações do Cuidador Responsável e Alerta -->
        <div class="row g-3 align-items-center bg-light p-3 rounded-3 border">
          <div class="col-md-7">
            <div class="d-flex align-items-center gap-2">
              <div class="bg-white p-2 rounded-circle border text-primary">
                <i class="bi bi-shield-check fs-5"></i>
              </div>
              <div>
                <div class="small text-muted text-uppercase fw-bold" style="font-size:0.7rem; letter-spacing:0.04em;">
                  Cuidador Vinculado (Sua Conta)
                </div>
                <div class="fw-bold text-dark">${esc(cuidadorLogado?.nome || 'Você')}</div>
              </div>
            </div>
          </div>
          <div class="col-md-5 text-md-end">
            <span class="badge bg-white text-dark border p-2 d-inline-flex align-items-center gap-2 shadow-sm">
              <i class="bi bi-bell-fill text-warning"></i>
              <span>Seus alertas chegam em: <strong>${esc(fmtTel(cuidadorLogado?.telefone))}</strong></span>
            </span>
          </div>
        </div>

      </div>
    </div>

    <!-- Cards de Métricas do Paciente -->
    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon primary">
            <i class="bi bi-capsule"></i>
          </div>
          <div>
            <div class="stat-value">${p.medicamentos.length}</div>
            <div class="stat-label">Medicamentos Monitorados</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon success">
            <i class="bi bi-clock-history"></i>
          </div>
          <div>
            <div class="stat-value">${totalHorarios}</div>
            <div class="stat-label">Doses Diárias Cadastradas</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon info">
            <i class="bi bi-telephone-check-fill"></i>
          </div>
          <div>
            <div class="stat-value">${isAtivo ? 'Ativo' : 'Pausado'}</div>
            <div class="stat-label">Status da Telefonia</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Seção de Medicamentos e Prescrições -->
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h2 class="h5 fw-bold mb-0">Medicamentos & Horários</h2>
        <p class="text-muted small mb-0">Configure os remédios que a assistente ligará avisando</p>
      </div>
      <button class="btn btn-primary-custom d-flex align-items-center gap-1 shadow-sm" data-bs-toggle="modal" data-bs-target="#modalNovoMedicamento">
        <i class="bi bi-plus-lg"></i>
        <span>+ Adicionar Medicamento</span>
      </button>
    </div>

    <div class="mb-5">
      ${medsHtml}
    </div>

    <!-- Histórico de Chamadas Recentes do Paciente -->
    <div class="card-custom shadow-sm">
      <div class="card-header-clean py-3">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-clock-history text-primary fs-5"></i>
          <h3 class="h6 fw-bold mb-0">Histórico de Ligações do Paciente</h3>
        </div>
        <span class="badge bg-light text-muted border small">Últimas 20 chamadas</span>
      </div>
      <div class="p-3" id="historicoChamadasContainer">
        <div class="text-center py-3 text-muted small"><span class="spinner-border spinner-border-sm me-1"></span> Carregando histórico...</div>
      </div>
    </div>`;

  carregarHistoricoChamadas(p.id);
}

// Atualização Geral do Painel
async function atualizar() {
  try {
    const authRes = await api('/auth/me');
    cuidadorLogado = authRes.cuidador;
    renderCuidador();
    exibirAppPrincipal();

    pacientes = await api('/pacientes');

    // Valida paciente selecionado
    if (!pacientes.some((p) => p.id === selecionadoId)) {
      selecionadoId = pacientes.length > 0 ? pacientes[0].id : null;
      if (selecionadoId) localStorage.setItem('lembremed_paciente_id', selecionadoId);
      else localStorage.removeItem('lembremed_paciente_id');
    }

    renderListaLateral();

    if (selecionadoId) {
      const detalhe = await api(`/pacientes/${selecionadoId}`);
      renderPacientePrincipal(detalhe);
    } else {
      pacienteAtual = null;
      const navNome = $('#navPacienteNome');
      const navAvatar = $('#navAvatar');
      if (navNome) navNome.textContent = 'Sem paciente';
      if (navAvatar) navAvatar.textContent = '--';

      $('#painelPacientePrincipal').innerHTML = `
        <div class="card-custom p-5 text-center text-muted my-5">
          <i class="bi bi-people fs-1 text-light d-block mb-3"></i>
          <h2 class="h4 fw-bold text-dark">Você ainda não tem pacientes cadastrados</h2>
          <p class="mb-4 text-muted">Cadastre o seu paciente para começar a configurar os medicamentos e receber os alertas.</p>
          <div>
            <button class="btn btn-primary-custom py-2 px-4 shadow-sm" data-bs-toggle="modal" data-bs-target="#modalNovoPaciente">
              <i class="bi bi-person-plus-fill me-1"></i> Cadastrar Meu Primeiro Paciente
            </button>
          </div>
        </div>`;
    }
  } catch (e) {
    if (e.message.includes('Faça login') || e.message.includes('Não autenticado')) {
      exibirTelaAuth();
    } else {
      toast(e.message, 'error');
    }
  }
}

// ==================== EVENTOS ====================

// Formulário de Login
$('#formLogin')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const erroEl = form.querySelector('.erro-auth');
  if (erroEl) erroEl.classList.add('d-none');

  const dados = Object.fromEntries(new FormData(form));

  try {
    const res = await api('/auth/login', { method: 'POST', body: dados });
    localStorage.setItem('lembremed_token', res.token);
    cuidadorLogado = res.cuidador;
    toast(`Bem-vindo(a), ${cuidadorLogado.nome}!`, 'success');
    form.reset();
    await atualizar();
  } catch (e) {
    if (erroEl) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('d-none');
    } else {
      toast(e.message, 'error');
    }
  }
});

// Formulário de Cadastro de Cuidador
$('#formCadastro')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const erroEl = form.querySelector('.erro-auth');
  if (erroEl) erroEl.classList.add('d-none');

  const dados = Object.fromEntries(new FormData(form));

  try {
    const res = await api('/auth/cadastro', { method: 'POST', body: dados });
    localStorage.setItem('lembremed_token', res.token);
    cuidadorLogado = res.cuidador;
    toast(`Conta criada com sucesso! Olá, ${cuidadorLogado.nome}.`, 'success');
    form.reset();
    await atualizar();
  } catch (e) {
    if (erroEl) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('d-none');
    } else {
      toast(e.message, 'error');
    }
  }
});

// Botão Logout
$('#btnLogout')?.addEventListener('click', () => {
  if (confirm('Deseja realmente sair da sua conta?')) {
    fazerLogout(true);
  }
});

// Botão para Abrir Perfil do Cuidador
$('#btnAbrirPerfilCuidador')?.addEventListener('click', () => {
  if (!cuidadorLogado) return;
  $('#perfilCuidadorNome').value = cuidadorLogado.nome;
  $('#perfilCuidadorTelefone').value = fmtTel(cuidadorLogado.telefone);
  $('#perfilCuidadorCanal').value = cuidadorLogado.canal_alerta || 'sms';
  
  const modal = new bootstrap.Modal($('#modalPerfilCuidador'));
  modal.show();
});

// Formulário de Edição do Perfil do Cuidador
$('#formPerfilCuidador')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const erroEl = form.querySelector('.erro-form');
  if (erroEl) erroEl.classList.add('d-none');

  const dados = Object.fromEntries(new FormData(form));

  try {
    const res = await api('/auth/perfil', { method: 'PUT', body: dados });
    cuidadorLogado = res.cuidador;
    fecharModal('modalPerfilCuidador');
    toast('Seu perfil de cuidador foi atualizado com sucesso!', 'success');
    await atualizar();
  } catch (e) {
    if (erroEl) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('d-none');
    } else {
      toast(e.message, 'error');
    }
  }
});

// Busca no Menu Lateral & Máscara de Telefone
document.addEventListener('input', (ev) => {
  if (ev.target && ev.target.id === 'filtroPacientes') {
    filtroBusca = ev.target.value;
    renderListaLateral();
  }
  if (ev.target && ev.target.classList.contains('tel-mask')) {
    aplicarMascaraTelefone(ev.target);
  }
});

// Cliques de Ações
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-acao]');
  if (!el) return;
  const id = Number(el.dataset.id);

  try {
    switch (el.dataset.acao) {
      case 'selecionar-paciente':
        selecionadoId = id;
        localStorage.setItem('lembremed_paciente_id', id);
        renderListaLateral();
        const p = await api(`/pacientes/${id}`);
        renderPacientePrincipal(p);
        fecharMenuLateral();
        break;

      case 'editar-paciente': {
        const pac = await api(`/pacientes/${id}`);
        $('#editPacienteId').value = pac.id;
        $('#editPacienteNome').value = pac.nome;
        $('#editPacienteTelefone').value = fmtTel(pac.telefone);
        $('#editPacienteAtivo').value = pac.ativo ? '1' : '0';

        const modal = new bootstrap.Modal($('#modalEditarPaciente'));
        modal.show();
        break;
      }

      case 'del-paciente':
        if (!confirm('Tem certeza que deseja excluir este paciente? Todos os medicamentos e horários serão removidos.')) return;
        await api(`/pacientes/${id}`, { method: 'DELETE' });
        toast('Paciente excluído.', 'success');
        selecionadoId = null;
        localStorage.removeItem('lembremed_paciente_id');
        await atualizar();
        break;

      case 'editar-med': {
        if (!pacienteAtual) return;
        const med = pacienteAtual.medicamentos.find((m) => m.id === id);
        if (!med) return;
        $('#editMedId').value = med.id;
        $('#editMedNome').value = med.nome;
        $('#editMedDescricao').value = med.descricao;

        const modal = new bootstrap.Modal($('#modalEditarMedicamento'));
        modal.show();
        break;
      }

      case 'del-med':
        if (!confirm('Remover este medicamento e seus horários?')) return;
        await api(`/medicamentos/${id}`, { method: 'DELETE' });
        toast('Medicamento removido.', 'success');
        await atualizar();
        break;

      case 'del-horario':
        await api(`/horarios/${id}`, { method: 'DELETE' });
        toast('Horário removido.', 'info');
        await atualizar();
        break;
    }
  } catch (e) {
    toast(e.message, 'error');
  }
});

// Toggle Ativar / Pausar Ligações
document.addEventListener('change', async (ev) => {
  const el = ev.target.closest('[data-acao="toggle-paciente"]');
  if (!el || !pacienteAtual) return;

  try {
    const p = pacienteAtual;
    await api(`/pacientes/${p.id}`, {
      method: 'PUT',
      body: {
        nome: p.nome,
        telefone: p.telefone,
        ativo: el.checked ? 1 : 0,
      },
    });
    toast(el.checked ? 'Ligações ativadas com sucesso!' : 'Ligações pausadas temporariamente.', 'info');
    await atualizar();
  } catch (e) {
    toast(e.message, 'error');
    el.checked = !el.checked;
  }
});

// Submissão dos Formulários de Paciente e Medicamento
document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  if (['formLogin', 'formCadastro', 'formPerfilCuidador'].includes(form.id)) return;

  ev.preventDefault();
  const erroEl = form.querySelector('.erro-form');
  if (erroEl) erroEl.classList.add('d-none');

  try {
    // 1) Novo Paciente (apenas nome e telefone)
    if (form.id === 'formNovoPaciente') {
      const dados = Object.fromEntries(new FormData(form));
      const novo = await api('/pacientes', { method: 'POST', body: dados });
      selecionadoId = novo.id;
      localStorage.setItem('lembremed_paciente_id', novo.id);
      form.reset();
      fecharModal('modalNovoPaciente');
      fecharMenuLateral();
      toast('Paciente cadastrado com sucesso!', 'success');
      await atualizar();
    }

    // 2) Editar Paciente (apenas nome e telefone)
    else if (form.id === 'formEditarPaciente') {
      const dados = Object.fromEntries(new FormData(form));
      const id = Number(dados.id);
      await api(`/pacientes/${id}`, {
        method: 'PUT',
        body: {
          nome: dados.nome,
          telefone: dados.telefone,
          ativo: Number(dados.ativo) || 1,
        },
      });
      fecharModal('modalEditarPaciente');
      toast('Dados do paciente atualizados!', 'success');
      await atualizar();
    }

    // 3) Novo Medicamento
    else if (form.id === 'formNovoMedicamento') {
      const dados = Object.fromEntries(new FormData(form));
      await api(`/pacientes/${selecionadoId}/medicamentos`, {
        method: 'POST',
        body: {
          nome: dados.nome,
          descricao: dados.descricao,
          horarios: [...horariosNovoMed],
        },
      });
      form.reset();
      horariosNovoMed = ['08:00'];
      renderHorariosNovoMed();
      fecharModal('modalNovoMedicamento');
      toast('Medicamento adicionado com sucesso!', 'success');
      await atualizar();
    }

    // 4) Editar Medicamento
    else if (form.id === 'formEditarMedicamento') {
      const dados = Object.fromEntries(new FormData(form));
      const id = Number(dados.id);
      await api(`/medicamentos/${id}`, {
        method: 'PUT',
        body: {
          nome: dados.nome,
          descricao: dados.descricao,
        },
      });
      fecharModal('modalEditarMedicamento');
      toast('Medicamento atualizado com sucesso!', 'success');
      await atualizar();
    }

    // 5) Adicionar Horário Inline no Card do Remédio
    else if (form.dataset.form === 'horario') {
      const hora = form.querySelector('input[name="hora"]').value;
      await api(`/medicamentos/${form.dataset.id}/horarios`, {
        method: 'POST',
        body: { hora },
      });
      form.reset();
      toast('Horário adicionado.', 'success');
      await atualizar();
    }
  } catch (e) {
    if (erroEl) {
      erroEl.textContent = e.message;
      erroEl.classList.remove('d-none');
    } else {
      toast(e.message, 'error');
    }
  }
});

// ==================== GERENCIAMENTO DE HORÁRIOS VISUAIS NO MODAL ====================

let horariosNovoMed = ['08:00'];

function renderHorariosNovoMed() {
  const container = $('#listaHorariosNovoMed');
  if (!container) return;

  if (!horariosNovoMed || horariosNovoMed.length === 0) {
    container.innerHTML = '<span class="text-muted small fst-italic" style="font-size:0.8rem;">Nenhum horário adicionado ainda.</span>';
    return;
  }

  horariosNovoMed.sort();
  container.innerHTML = horariosNovoMed
    .map(
      (h) => `
      <div class="time-chip shadow-sm bg-white border">
        <i class="bi bi-clock-fill text-primary" style="font-size:0.75rem;"></i>
        <span class="fw-bold">${esc(h)}</span>
        <button type="button" class="btn-del-time ms-1" data-del-novo-hora="${esc(h)}" title="Remover este horário">&times;</button>
      </div>`
    )
    .join('');
}

function adicionarHorarioNovoMed(hora) {
  if (!hora || !/^\d{2}:\d{2}$/.test(hora)) {
    toast('Escolha um horário válido.', 'warning');
    return;
  }
  if (horariosNovoMed.includes(hora)) {
    toast(`O horário ${hora} já está na lista.`, 'info');
    return;
  }
  horariosNovoMed.push(hora);
  renderHorariosNovoMed();
}

function removerHorarioNovoMed(hora) {
  horariosNovoMed = horariosNovoMed.filter((h) => h !== hora);
  renderHorariosNovoMed();
}

// Eventos dos botões de horários do modal
document.addEventListener('click', (ev) => {
  // Botão Adicionar Hora
  if (ev.target.closest('#btnAdicionarHoraNovoMed')) {
    const input = $('#novoMedHoraInput');
    if (input && input.value) {
      adicionarHorarioNovoMed(input.value);
    }
  }

  // Atalhos Rápidos (Manhã, Almoço, Tarde, Noite)
  const atalho = ev.target.closest('.btn-atalho-hora');
  if (atalho) {
    const hora = atalho.dataset.hora;
    if (hora) adicionarHorarioNovoMed(hora);
  }

  // Remover Chip de Horário do Modal
  const btnDel = ev.target.closest('[data-del-novo-hora]');
  if (btnDel) {
    const hora = btnDel.dataset.delNovoHora;
    if (hora) removerHorarioNovoMed(hora);
  }
});

// Tecla Enter no seletor de hora adiciona o horário sem enviar o formulário
$('#novoMedHoraInput')?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    if (ev.target.value) adicionarHorarioNovoMed(ev.target.value);
  }
});

// Inicializa chips visuais ao abrir o modal de novo medicamento
$('#modalNovoMedicamento')?.addEventListener('show.bs.modal', () => {
  horariosNovoMed = ['08:00'];
  renderHorariosNovoMed();
});

// Botão de Atualizar Manual
$('#btnAtualizarTudo')?.addEventListener('click', () => {
  toast('Atualizando dados...', 'info');
  atualizar();
});

// Inicialização: Verifica se já tem token
if (localStorage.getItem('lembremed_token')) {
  atualizar();
} else {
  exibirTelaAuth();
}
