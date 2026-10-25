-- Cuidadores entram só pela conta do Google (google_id = "sub" do Google).
-- O celular que recebe os SMS é pedido no primeiro acesso, por isso começa vazio.
CREATE TABLE IF NOT EXISTS cuidadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS pacientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuidador_id INTEGER NOT NULL REFERENCES cuidadores(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  -- Se o paciente atende e ainda não tomou, o sistema liga de novo para confirmar depois destes minutos
  minutos_religar INTEGER NOT NULL DEFAULT 5,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS medicamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paciente_id INTEGER NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS horarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicamento_id INTEGER NOT NULL REFERENCES medicamentos(id) ON DELETE CASCADE,
  hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]' AND hora < '24:00'),
  ativo INTEGER NOT NULL DEFAULT 1,
  UNIQUE (medicamento_id, hora)
);

-- tipo: lembrete = diz o remédio e pergunta se já tomou (no horário, até ser atendida);
--       confirmacao = só pergunta, minutos_religar depois de o paciente atender e ainda não ter tomado.
-- tentativa numera todas as ligações da dose.
CREATE TABLE IF NOT EXISTS chamadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  horario_id INTEGER NOT NULL REFERENCES horarios(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  tentativa INTEGER NOT NULL DEFAULT 1,
  tipo TEXT NOT NULL DEFAULT 'confirmacao' CHECK (tipo IN ('lembrete', 'confirmacao')),
  status TEXT NOT NULL DEFAULT 'discando'
    CHECK (status IN ('discando', 'confirmada', 'sem_resposta', 'falhou', 'escalonada')),
  -- 1 quando o paciente atendeu (a Twilio pediu o roteiro da ligação)
  atendida INTEGER NOT NULL DEFAULT 0,
  -- 1 quando quem atendeu foi a caixa postal (conta como não atendida)
  caixa_postal INTEGER NOT NULL DEFAULT 0,
  call_sid TEXT,
  -- Resultado informado pela Twilio ao fim da ligação (diagnóstico de entrega)
  twilio_status TEXT,
  sip_code INTEGER,
  duracao_seg INTEGER,
  toque_seg INTEGER,
  -- Última frase que o paciente falou na ligação ("tomei sim", "ainda não"...)
  resposta TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (horario_id, data, tentativa)
);

CREATE INDEX IF NOT EXISTS idx_chamadas_call_sid ON chamadas(call_sid);
