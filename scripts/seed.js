'use strict';

const Loki   = require('lokijs');
const crypto = require('crypto');
const path   = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'chamados.db');

const CATS = {
  requisicao: [
    'Acesso a Software', 'Acesso a Sistema/Serviço', 'Equipamento de TI',
    'Licença de Software', 'Acesso VPN', 'Criação de E-mail',
    'Permissão de Rede/Pasta', 'Outros',
  ],
  incidente: [
    'Sistema/Aplicação Fora do Ar', 'Problema com Internet/Rede',
    'Hardware Defeituoso', 'Impressora com Problema', 'Computador Lento',
    'E-mail com Problema', 'Segurança/Vírus', 'Outros',
  ],
};

const STATUSES    = ['aberto', 'em_andamento', 'fechado'];
const PRIORITIES  = ['baixa', 'media', 'alta'];

const USUARIOS = [
  'Ana Souza', 'Bruno Lima', 'Carla Ferreira', 'Diego Martins',
  'Eduarda Costa', 'Felipe Ramos', 'Gabriela Nunes', 'Henrique Oliveira',
  'Isabela Torres', 'João Alves',
];

const DESCRICOES = {
  'Acesso a Software':           'Preciso de acesso ao software de gestão para realizar minhas atividades.',
  'Acesso a Sistema/Serviço':    'Não consigo acessar o sistema de RH. Meu login retorna erro de permissão.',
  'Equipamento de TI':           'Solicito um segundo monitor para melhorar minha produtividade no home office.',
  'Licença de Software':         'Minha licença do pacote Office expirou e preciso de renovação urgente.',
  'Acesso VPN':                  'Não consigo conectar à VPN corporativa. O cliente apresenta erro de autenticação.',
  'Criação de E-mail':           'Solicito criação de e-mail corporativo para novo colaborador do setor financeiro.',
  'Permissão de Rede/Pasta':     'Preciso de acesso à pasta compartilhada do projeto Alpha no servidor de arquivos.',
  'Outros':                      'Necessito de suporte técnico para configuração do ambiente de trabalho.',
  'Sistema/Aplicação Fora do Ar':'O sistema de emissão de notas fiscais está inacessível desde as 09h. Impacto em toda a equipe.',
  'Problema com Internet/Rede':  'A conexão de internet no 3º andar está muito lenta ou intermitente.',
  'Hardware Defeituoso':         'O HD do meu notebook faz barulho e apresenta lentidão extrema. Risco de perda de dados.',
  'Impressora com Problema':     'A impressora HP da sala de reuniões não está reconhecida em nenhum computador.',
  'Computador Lento':            'Meu computador demora mais de 10 minutos para inicializar e trava ao abrir programas.',
  'E-mail com Problema':         'Não estou recebendo e-mails desde ontem à tarde. Já verifiquei o filtro de spam.',
  'Segurança/Vírus':             'Meu computador exibiu alertas suspeitos e abriu janelas sem minha interação.',
};

function genId(n) {
  const num  = String(n).padStart(4, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `TI${num}-${rand}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n) {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

const TICKETS = [
  // ── Abertos recentes ──────────────────────────────────────────
  { type: 'incidente',  category: 'Sistema/Aplicação Fora do Ar', user_name: 'Ana Souza',        priority: 'alta',  status: 'aberto',       daysAgo: 0  },
  { type: 'incidente',  category: 'Segurança/Vírus',              user_name: 'Bruno Lima',       priority: 'alta',  status: 'aberto',       daysAgo: 1  },
  { type: 'requisicao', category: 'Acesso VPN',                   user_name: 'Carla Ferreira',   priority: 'media', status: 'aberto',       daysAgo: 1  },
  { type: 'requisicao', category: 'Criação de E-mail',            user_name: 'Diego Martins',    priority: 'baixa', status: 'aberto',       daysAgo: 2  },
  { type: 'incidente',  category: 'Problema com Internet/Rede',   user_name: 'Eduarda Costa',    priority: 'alta',  status: 'aberto',       daysAgo: 2  },
  { type: 'requisicao', category: 'Equipamento de TI',            user_name: 'Felipe Ramos',     priority: 'baixa', status: 'aberto',       daysAgo: 3  },
  { type: 'incidente',  category: 'Computador Lento',             user_name: 'Gabriela Nunes',   priority: 'media', status: 'aberto',       daysAgo: 3  },
  { type: 'requisicao', category: 'Licença de Software',          user_name: 'Henrique Oliveira',priority: 'media', status: 'aberto',       daysAgo: 4  },
  // ── Em andamento ──────────────────────────────────────────────
  { type: 'incidente',  category: 'Hardware Defeituoso',          user_name: 'Isabela Torres',   priority: 'alta',  status: 'em_andamento', daysAgo: 5  },
  { type: 'requisicao', category: 'Acesso a Software',            user_name: 'João Alves',       priority: 'media', status: 'em_andamento', daysAgo: 5  },
  { type: 'incidente',  category: 'Impressora com Problema',      user_name: 'Ana Souza',        priority: 'baixa', status: 'em_andamento', daysAgo: 6  },
  { type: 'requisicao', category: 'Permissão de Rede/Pasta',      user_name: 'Bruno Lima',       priority: 'media', status: 'em_andamento', daysAgo: 7  },
  { type: 'incidente',  category: 'E-mail com Problema',          user_name: 'Carla Ferreira',   priority: 'alta',  status: 'em_andamento', daysAgo: 8  },
  { type: 'requisicao', category: 'Acesso a Sistema/Serviço',     user_name: 'Diego Martins',    priority: 'media', status: 'em_andamento', daysAgo: 9  },
  // ── Fechados ──────────────────────────────────────────────────
  { type: 'requisicao', category: 'Criação de E-mail',            user_name: 'Eduarda Costa',    priority: 'baixa', status: 'fechado',      daysAgo: 10 },
  { type: 'incidente',  category: 'Computador Lento',             user_name: 'Felipe Ramos',     priority: 'media', status: 'fechado',      daysAgo: 12 },
  { type: 'requisicao', category: 'Equipamento de TI',            user_name: 'Gabriela Nunes',   priority: 'baixa', status: 'fechado',      daysAgo: 14 },
  { type: 'incidente',  category: 'Sistema/Aplicação Fora do Ar', user_name: 'Henrique Oliveira',priority: 'alta',  status: 'fechado',      daysAgo: 16 },
  { type: 'requisicao', category: 'Acesso VPN',                   user_name: 'Isabela Torres',   priority: 'media', status: 'fechado',      daysAgo: 18 },
  { type: 'incidente',  category: 'Hardware Defeituoso',          user_name: 'João Alves',       priority: 'alta',  status: 'fechado',      daysAgo: 20 },
  { type: 'requisicao', category: 'Licença de Software',          user_name: 'Ana Souza',        priority: 'baixa', status: 'fechado',      daysAgo: 22 },
  { type: 'incidente',  category: 'Problema com Internet/Rede',   user_name: 'Bruno Lima',       priority: 'media', status: 'fechado',      daysAgo: 25 },
  { type: 'requisicao', category: 'Permissão de Rede/Pasta',      user_name: 'Carla Ferreira',   priority: 'baixa', status: 'fechado',      daysAgo: 28 },
  { type: 'incidente',  category: 'Segurança/Vírus',              user_name: 'Diego Martins',    priority: 'alta',  status: 'fechado',      daysAgo: 30 },
  { type: 'requisicao', category: 'Outros',                       user_name: 'Eduarda Costa',    priority: 'baixa', status: 'fechado',      daysAgo: 32 },
];

const db = new Loki(DB_PATH, {
  adapter:          new Loki.LokiFsAdapter(),
  autoload:         true,
  autoloadCallback: run,
});

function run() {
  let col = db.getCollection('tickets');
  if (!col) col = db.addCollection('tickets', { indices: ['type', 'status', 'user_name', 'created_at'] });

  const existing = col.count();
  if (existing > 0) {
    console.log(`ℹ️  Banco já contém ${existing} chamado(s). Seed abortado para evitar duplicatas.`);
    console.log('   Para reinserir, remova o arquivo data/chamados.db e rode novamente.');
    process.exit(0);
  }

  TICKETS.forEach((t, i) => {
    const created = daysAgo(t.daysAgo) - (i * 60 * 1000); // 1 min apart
    col.insert({
      id:          genId(i + 1),
      type:        t.type,
      category:    t.category,
      user_name:   t.user_name,
      description: DESCRICOES[t.category] || 'Descrição do chamado de teste.',
      priority:    t.priority,
      status:      t.status,
      created_at:  created,
      updated_at:  t.status !== 'aberto' ? created + 3600000 : created,
    });
  });

  db.saveDatabase(() => {
    console.log(`✅ ${TICKETS.length} chamados inseridos com sucesso.`);

    const abertos      = TICKETS.filter(t => t.status === 'aberto').length;
    const em_andamento = TICKETS.filter(t => t.status === 'em_andamento').length;
    const fechados     = TICKETS.filter(t => t.status === 'fechado').length;
    const requisicoes  = TICKETS.filter(t => t.type === 'requisicao').length;
    const incidentes   = TICKETS.filter(t => t.type === 'incidente').length;

    console.log(`\n   Abertos:       ${abertos}`);
    console.log(`   Em andamento:  ${em_andamento}`);
    console.log(`   Fechados:      ${fechados}`);
    console.log(`   Requisições:   ${requisicoes}`);
    console.log(`   Incidentes:    ${incidentes}`);
    process.exit(0);
  });
}
