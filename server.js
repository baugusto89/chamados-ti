'use strict';

require('dotenv').config();

const express   = require('express');
const Loki      = require('lokijs');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const cors      = require('cors');
const path      = require('path');
const crypto    = require('crypto');
const fs        = require('fs');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT           = process.env.PORT           || 3000;
const DB_PATH        = process.env.DB_PATH        || path.join(__dirname, 'data', 'chamados.db');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || `http://localhost:${PORT}`;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// ─── DATABASE SETUP ───────────────────────────────────────────────────────────
// LokiJS: in-memory database with automatic file persistence
let loki, col;

function initDB() {
  return new Promise((resolve) => {
    loki = new Loki(DB_PATH, {
      adapter:          new Loki.LokiFsAdapter(),
      autoload:         true,
      autoloadCallback: () => {
        col = loki.getCollection('tickets');
        if (!col) {
          col = loki.addCollection('tickets', {
            indices: ['type', 'status', 'user_name', 'created_at'],
          });
        }
        loki.saveDatabase(() => resolve());
      },
      autosave:         true,
      autosaveInterval: 2000,  // persist every 2 seconds
    });
  });
}

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
// Strip LokiJS internal metadata before sending to client
function clean(doc) {
  if (!doc) return null;
  const { $loki, meta, ...rest } = doc;
  return rest;
}

// Apply text/enum filters and return sorted, paginated results
function queryTickets({ type, status, user, q, limit, offset }) {
  let results = col.chain().find();

  if (type)   results = results.find({ type });
  if (status) results = results.find({ status });

  let data = results.simplesort('created_at', true).data();

  if (user) {
    const u = user.toLowerCase();
    data = data.filter(t => t.user_name.toLowerCase().includes(u));
  }
  if (q) {
    const s = q.toLowerCase();
    data = data.filter(t =>
      t.category.toLowerCase().includes(s)    ||
      t.description.toLowerCase().includes(s) ||
      t.user_name.toLowerCase().includes(s)   ||
      t.id.toLowerCase().includes(s)
    );
  }

  return { total: data.length, rows: data.slice(offset, offset + limit).map(clean) };
}

function findById(id) {
  return clean(col.findOne({ id }));
}

function insertTicket(doc) {
  col.insert(doc);
  return clean(col.findOne({ id: doc.id }));
}

function updateStatus(id, status) {
  const doc = col.findOne({ id });
  if (!doc) return null;
  doc.status     = status;
  doc.updated_at = Date.now();
  col.update(doc);
  return clean(col.findOne({ id }));
}

function removeTicket(id) {
  const doc = col.findOne({ id });
  if (!doc) return false;
  col.remove(doc);
  return true;
}

function checkDuplicate(user_name, type, category) {
  return col.chain()
    .find({ type, category })
    .data()
    .filter(t => t.user_name.toLowerCase() === user_name.toLowerCase())
    .sort((a, b) => b.created_at - a.created_at)
    .map(clean);
}

function getStats() {
  const all = col.data;
  return {
    total:        all.length,
    abertos:      all.filter(t => t.status === 'aberto').length,
    em_andamento: all.filter(t => t.status === 'em_andamento').length,
    fechados:     all.filter(t => t.status === 'fechado').length,
    requisicoes:  all.filter(t => t.type   === 'requisicao').length,
    incidentes:   all.filter(t => t.type   === 'incidente').length,
  };
}

function getStatsByCategory(type) {
  const counts = {};
  col.find({ type }).forEach(t => { counts[t.category] = (counts[t.category] || 0) + 1; });
  return Object.entries(counts)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────
const VALID_TYPES      = new Set(['requisicao', 'incidente']);
const VALID_PRIORITIES = new Set(['baixa', 'media', 'alta']);
const VALID_STATUSES   = new Set(['aberto', 'em_andamento', 'fechado']);

const CATS = {
  requisicao: new Set([
    'Acesso a Software', 'Acesso a Sistema/Serviço', 'Equipamento de TI',
    'Licença de Software', 'Acesso VPN', 'Criação de E-mail',
    'Permissão de Rede/Pasta', 'Outros',
  ]),
  incidente: new Set([
    'Sistema/Aplicação Fora do Ar', 'Problema com Internet/Rede',
    'Hardware Defeituoso', 'Impressora com Problema', 'Computador Lento',
    'E-mail com Problema', 'Segurança/Vírus', 'Outros',
  ]),
};

function sanitize(str, maxLen = 500) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function validateTicketBody(body) {
  const errors = [];
  const { type, category, user_name, description, priority } = body;

  if (!VALID_TYPES.has(type))
    errors.push('Tipo inválido. Use "requisicao" ou "incidente".');

  if (type && CATS[type] && !CATS[type].has(category))
    errors.push(`Categoria inválida para o tipo "${type}".`);

  if (!user_name || user_name.trim().length < 2)
    errors.push('Nome do usuário deve ter ao menos 2 caracteres.');

  if (!description || description.trim().length < 5)
    errors.push('Descrição deve ter ao menos 5 caracteres.');

  if (priority && !VALID_PRIORITIES.has(priority))
    errors.push('Prioridade inválida. Use "baixa", "media" ou "alta".');

  return errors;
}

function generateId(tickets_count) {
  const num  = String(tickets_count + 1).padStart(4, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `TI${num}-${rand}`;
}

// ─── EXPRESS APP ──────────────────────────────────────────────────────────────
const app = express();

// Security headers (allow inline scripts/styles for the SPA)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'",
                   'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
      styleSrc:   ["'self'", "'unsafe-inline'",
                   'fonts.googleapis.com', 'cdn.jsdelivr.net'],
      fontSrc:    ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));

// CORS — tighten in production by setting ALLOWED_ORIGIN
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ['GET','POST','PATCH','DELETE'] }));

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Rate limiting — API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

// Stricter limit for writes
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: { error: 'Limite de criação atingido. Aguarde alguns minutos.' },
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ─── API ROUTES ───────────────────────────────────────────────────────────────
const api = express.Router();
api.use(apiLimiter);

// GET /api/tickets — list with filters + pagination
api.get('/tickets', (req, res) => {
  try {
    const type   = sanitize(req.query.type   || '', 20);
    const status = sanitize(req.query.status || '', 20);
    const user   = sanitize(req.query.user   || '', 100);
    const q      = sanitize(req.query.q      || '', 200);
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    if (type   && !VALID_TYPES.has(type))     return res.status(400).json({ error: 'Tipo inválido.' });
    if (status && !VALID_STATUSES.has(status)) return res.status(400).json({ error: 'Status inválido.' });

    const { total, rows } = queryTickets({ type, status, user, q, limit, offset });

    res.json({
      tickets: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[GET /tickets]', err);
    res.status(500).json({ error: 'Erro interno ao buscar chamados.' });
  }
});

// GET /api/tickets/:id
api.get('/tickets/:id', (req, res) => {
  try {
    const ticket = findById(sanitize(req.params.id, 20));
    if (!ticket) return res.status(404).json({ error: 'Chamado não encontrado.' });
    res.json(ticket);
  } catch (err) {
    console.error('[GET /tickets/:id]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/tickets — create
api.post('/tickets', writeLimiter, (req, res) => {
  try {
    const body = {
      type:        sanitize(req.body.type        || '', 20),
      category:    sanitize(req.body.category    || '', 100),
      user_name:   sanitize(req.body.user_name   || '', 150),
      description: sanitize(req.body.description || '', 2000),
      priority:    sanitize(req.body.priority    || 'media', 10),
    };

    const errors = validateTicketBody(body);
    if (errors.length) return res.status(400).json({ errors });

    const now = Date.now();
    const id  = generateId(col.data.length);

    const ticket = insertTicket({ id, ...body, status: 'aberto', created_at: now, updated_at: now });
    res.status(201).json(ticket);
  } catch (err) {
    console.error('[POST /tickets]', err);
    res.status(500).json({ error: 'Erro interno ao criar chamado.' });
  }
});

// PATCH /api/tickets/:id/status
api.patch('/tickets/:id/status', writeLimiter, (req, res) => {
  try {
    const id     = sanitize(req.params.id, 20);
    const status = sanitize(req.body.status || '', 20);

    if (!VALID_STATUSES.has(status))
      return res.status(400).json({ error: 'Status inválido.' });

    if (!findById(id)) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const updated = updateStatus(id, status);
    res.json(updated);
  } catch (err) {
    console.error('[PATCH /tickets/:id/status]', err);
    res.status(500).json({ error: 'Erro interno ao atualizar status.' });
  }
});

// DELETE /api/tickets/:id
api.delete('/tickets/:id', writeLimiter, (req, res) => {
  try {
    const id = sanitize(req.params.id, 20);
    if (!findById(id)) return res.status(404).json({ error: 'Chamado não encontrado.' });
    removeTicket(id);
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[DELETE /tickets/:id]', err);
    res.status(500).json({ error: 'Erro interno ao excluir chamado.' });
  }
});

// GET /api/check-duplicate
api.get('/check-duplicate', (req, res) => {
  try {
    const user_name = sanitize(req.query.user     || '', 150);
    const type      = sanitize(req.query.type     || '', 20);
    const category  = sanitize(req.query.category || '', 100);

    if (!user_name || !type || !category)
      return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });

    if (!VALID_TYPES.has(type))
      return res.status(400).json({ error: 'Tipo inválido.' });

    const matches = checkDuplicate(user_name, type, category);
    if (!matches.length) return res.json({ duplicate: false });

    if (type === 'requisicao') {
      const open = matches.filter(m => m.status !== 'fechado');
      if (open.length) {
        return res.json({
          duplicate: true, kind: 'warning', count: open.length,
          message: `${user_name} já possui ${open.length} requisição(ões) aberta(s) do tipo "${category}". Este usuário já solicitou esse tipo de requisição.`,
        });
      }
      return res.json({
        duplicate: true, kind: 'info', count: matches.length,
        message: `${user_name} já solicitou "${category}" antes (${matches.length}x), mas o chamado foi encerrado.`,
      });
    }
    return res.json({
      duplicate: true, kind: 'info', count: matches.length,
      message: `Este problema foi registrado ${matches.length}x anteriormente para ${user_name}. Verifique se há um problema estrutural.`,
    });
  } catch (err) {
    console.error('[GET /check-duplicate]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/stats
api.get('/stats', (_req, res) => {
  try {
    res.json({
      overview:   getStats(),
      byCategory: {
        requisicao: getStatsByCategory('requisicao'),
        incidente:  getStatsByCategory('incidente'),
      },
    });
  } catch (err) {
    console.error('[GET /stats]', err);
    res.status(500).json({ error: 'Erro interno ao buscar estatísticas.' });
  }
});

// GET /api/categories
api.get('/categories', (_req, res) => {
  res.json({ requisicao: [...CATS.requisicao], incidente: [...CATS.incidente] });
});

app.use('/api', api);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ─── START ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅  Central de Chamados TI rodando em http://localhost:${PORT}`);
    console.log(`📂  Banco de dados: ${DB_PATH}\n`);
  });
}).catch(err => {
  console.error('❌  Falha ao inicializar banco de dados:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT',  () => { loki.close(); process.exit(0); });
process.on('SIGTERM', () => { loki.close(); process.exit(0); });
