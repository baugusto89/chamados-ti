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
let loki, col, colUsers;

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
        colUsers = loki.getCollection('users');
        if (!colUsers) {
          colUsers = loki.addCollection('users', {
            indices: ['username', 'email'],
          });
        }
        migrateStatuses();
        loki.saveDatabase(() => resolve());
      },
      autosave:         true,
      autosaveInterval: 2000,
    });
  });
}

// ─── PASSWORD HELPERS ─────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(
    crypto.scryptSync(password, salt, 64),
    Buffer.from(hash, 'hex')
  );
}

// ─── USER DB HELPERS ──────────────────────────────────────────────────────────
function cleanUser(doc) {
  if (!doc) return null;
  const { $loki, meta, password, ...rest } = doc;
  return rest;
}

function findAllUsers() {
  return colUsers.chain().simplesort('created_at', false).data().map(cleanUser);
}

function findUserById(id) {
  return colUsers.findOne({ id });
}

function findUserByUsername(username) {
  return colUsers.findOne({ username: { $regex: new RegExp(`^${username}$`, 'i') } });
}

function findUserByEmail(email) {
  return colUsers.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
}

function insertUser(doc) {
  colUsers.insert(doc);
  return cleanUser(colUsers.findOne({ id: doc.id }));
}

function deleteUserDoc(id) {
  const doc = colUsers.findOne({ id });
  if (!doc) return false;
  colUsers.remove(doc);
  return true;
}

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
// Strip LokiJS internal metadata before sending to client
function clean(doc) {
  if (!doc) return null;
  const { $loki, meta, ...rest } = doc;
  return rest;
}

// Apply text/enum filters and return sorted, paginated results
function queryTickets({ type, status, user, q, limit, offset, created_by }) {
  let results = col.chain().find();

  if (created_by) results = results.find({ created_by });
  if (type)       results = results.find({ type });
  if (status)     results = results.find({ status });

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

function checkDuplicate(user_name, type, category, subcategory) {
  return col.chain()
    .find({ type, category })
    .data()
    .filter(t => {
      if (t.user_name.toLowerCase() !== user_name.toLowerCase()) return false;
      if (subcategory) return (t.subcategory || '').toLowerCase() === subcategory.toLowerCase();
      return true;
    })
    .sort((a, b) => b.created_at - a.created_at)
    .map(clean);
}

function getStats() {
  const all = col.data;
  return {
    total:              all.length,
    abertos:            all.filter(t => t.status === 'aberto').length,
    em_analise:         all.filter(t => t.status === 'em_analise').length,
    pendente:           all.filter(t => t.status === 'pendente').length,
    pendente_terceiros: all.filter(t => t.status === 'pendente_terceiros').length,
    fechados:           all.filter(t => t.status === 'fechado').length,
    requisicoes:        all.filter(t => t.type   === 'requisicao').length,
    incidentes:         all.filter(t => t.type   === 'incidente').length,
  };
}

function getStatsByCategory(type) {
  const counts = {};
  col.find({ type }).forEach(t => { counts[t.category] = (counts[t.category] || 0) + 1; });
  return Object.entries(counts)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

function migrateStatuses() {
  if (!col) return;
  const docs = col.find({ status: 'em_andamento' });
  if (!docs.length) return;
  docs.forEach(doc => { doc.status = 'em_analise'; col.update(doc); });
  console.log(`✅  Migration: ${docs.length} ticket(s) em_andamento → em_analise`);
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  const raw   = Array.from(bytes).map(b => chars[b % chars.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────
const VALID_TYPES      = new Set(['requisicao', 'incidente']);
const VALID_PRIORITIES = new Set(['baixa', 'media', 'alta']);
const VALID_STATUSES   = new Set(['aberto', 'em_analise', 'pendente', 'pendente_terceiros', 'fechado']);

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

// ─── SESSION STORE ────────────────────────────────────────────────────────────
const sessions = new Map(); // token → { userId, username, name, expires }
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId:                user.id,
    username:              user.username,
    name:                  user.name,
    role:                  user.role || 'usuario',
    requiresPasswordChange: user.password_reset === true,
    expires:               Date.now() + SESSION_TTL,
  });
  return token;
}

function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
  req.session = session;
  next();
}

// Clean expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
}, 60 * 60 * 1000);

// ─── ADMIN SEED ───────────────────────────────────────────────────────────────
const VALID_ROLES = new Set(['admin', 'tecnico', 'usuario']);

function createAdminIfNeeded() {
  if (!findUserByUsername('admin')) {
    insertUser({
      id:         crypto.randomUUID(),
      name:       'Administrador',
      email:      'admin@empresa.com',
      username:   'admin',
      role:       'admin',
      password:   hashPassword('admin123'),
      created_at: Date.now(),
    });
    console.log('✅  Conta admin criada: usuario=admin / senha=admin123');
  }
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
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'icons.duckduckgo.com'],
      connectSrc: ["'self'", 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
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
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

// Stricter limit for writes
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 200,
  message: { error: 'Limite de criação atingido. Aguarde alguns minutos.' },
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ─── AUTH ROUTES (public) ─────────────────────────────────────────────────────
app.post('/api/auth/login', writeLimiter, (req, res) => {
  try {
    const username = sanitize(req.body.username || '', 80).toLowerCase();
    const password = req.body.password || '';
    const user = findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password))
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    const token = createSession(user);
    res.json({ token, user: cleanUser(user) });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.slice(7) || '';
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  // Re-check DB so admin reset takes effect on next poll
  const dbUser = findUserById(req.session.userId);
  if (dbUser) req.session.requiresPasswordChange = dbUser.password_reset === true;
  res.json(req.session);
});

app.post('/api/auth/change-own-password', requireAuth, writeLimiter, (req, res) => {
  try {
    const currentPassword = (req.body.currentPassword || '').trim();
    const newPassword     = (req.body.newPassword     || '').trim();
    if (!currentPassword || !newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Dados inválidos.' });
    const doc = colUsers.findOne({ id: req.session.userId });
    if (!doc) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!verifyPassword(currentPassword, doc.password))
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    doc.password   = hashPassword(newPassword);
    doc.updated_at = Date.now();
    colUsers.update(doc);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /auth/change-own-password]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  try {
    const password = (req.body.password || '').trim();
    if (!password || password.length < 6)
      return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres.' });
    const doc = colUsers.findOne({ id: req.session.userId });
    if (!doc) return res.status(404).json({ error: 'Usuário não encontrado.' });
    doc.password       = hashPassword(password);
    doc.password_reset = false;
    doc.updated_at     = Date.now();
    colUsers.update(doc);
    req.session.requiresPasswordChange = false;
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /auth/change-password]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── API ROUTES ───────────────────────────────────────────────────────────────
const api = express.Router();
api.use(apiLimiter);
api.use(requireAuth);

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

    const created_by = req.session.role === 'usuario' ? req.session.userId : null;
    const { total, rows } = queryTickets({ type, status, user, q, limit, offset, created_by });

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
      subcategory: sanitize(req.body.subcategory || '', 100),
      user_name:   sanitize(req.body.user_name   || '', 150),
      description: sanitize(req.body.description || '', 2000),
      priority:    sanitize(req.body.priority    || 'media', 10),
    };

    const errors = validateTicketBody(body);
    if (errors.length) return res.status(400).json({ errors });

    const now = Date.now();
    const id  = generateId(col.data.length);

    const techs    = colUsers.find({ role: 'tecnico' });
    const assigned = techs.length ? techs[Math.floor(Math.random() * techs.length)] : null;
    const ticket = insertTicket({
      id, ...body,
      status:           'aberto',
      created_by:       req.session.userId,
      assigned_to:      assigned?.id   || null,
      assigned_to_name: assigned?.name || null,
      procedures:       [],
      created_at:       now,
      updated_at:       now,
    });
    res.status(201).json(ticket);
  } catch (err) {
    console.error('[POST /tickets]', err);
    res.status(500).json({ error: 'Erro interno ao criar chamado.' });
  }
});

// PATCH /api/tickets/:id — general update (status, procedure, reassign)
api.patch('/tickets/:id', writeLimiter, (req, res) => {
  try {
    if (req.session.role === 'usuario')
      return res.status(403).json({ error: 'Sem permissão.' });

    const id  = sanitize(req.params.id, 20);
    const doc = col.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const now = Date.now();

    if (req.body.status !== undefined) {
      const status = sanitize(req.body.status, 20);
      if (!VALID_STATUSES.has(status))
        return res.status(400).json({ error: 'Status inválido.' });
      doc.status = status;
    }

    if (req.body.assigned_to !== undefined) {
      const techDoc = colUsers.findOne({ id: req.body.assigned_to });
      if (!techDoc || techDoc.role !== 'tecnico')
        return res.status(400).json({ error: 'Técnico não encontrado.' });
      doc.assigned_to      = techDoc.id;
      doc.assigned_to_name = techDoc.name;
    }

    if (req.body.procedure) {
      const text = sanitize(req.body.procedure, 2000);
      if (text.length < 5)
        return res.status(400).json({ error: 'Procedimento muito curto (mínimo 5 caracteres).' });
      if (!Array.isArray(doc.procedures)) doc.procedures = [];
      doc.procedures.push({ text, technician_name: req.session.name, created_at: now });
    }

    doc.updated_at = now;
    col.update(doc);
    res.json(clean(col.findOne({ id })));
  } catch (err) {
    console.error('[PATCH /tickets/:id]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PATCH /api/tickets/:id/status
api.patch('/tickets/:id/status', writeLimiter, (req, res) => {
  try {
    if (req.session.role === 'usuario')
      return res.status(403).json({ error: 'Sem permissão para alterar status.' });

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
    const user_name   = sanitize(req.query.user        || '', 150);
    const type        = sanitize(req.query.type        || '', 20);
    const category    = sanitize(req.query.category    || '', 100);
    const subcategory = sanitize(req.query.subcategory || '', 100);

    if (!user_name || !type || !category)
      return res.status(400).json({ error: 'Parâmetros obrigatórios ausentes.' });

    if (!VALID_TYPES.has(type))
      return res.status(400).json({ error: 'Tipo inválido.' });

    const matches = checkDuplicate(user_name, type, category, subcategory);
    if (!matches.length) return res.json({ duplicate: false });

    const subject = subcategory ? `"${subcategory}"` : `"${category}"`;

    if (type === 'requisicao') {
      const open = matches.filter(m => m.status !== 'fechado');
      if (open.length) {
        return res.json({
          duplicate: true, kind: 'warning', count: open.length,
          message: `${user_name} já possui ${open.length} requisição(ões) aberta(s) para ${subject}. Verifique antes de abrir um novo chamado.`,
        });
      }
      return res.json({
        duplicate: true, kind: 'info', count: matches.length,
        message: `${user_name} já solicitou ${subject} antes (${matches.length}x), mas o chamado foi encerrado.`,
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

// GET /api/technicians
api.get('/technicians', (_req, res) => {
  try {
    res.json(colUsers.find({ role: 'tecnico' }).map(cleanUser));
  } catch (err) {
    console.error('[GET /technicians]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── USER ROUTES ──────────────────────────────────────────────────────────────
api.get('/users', (_req, res) => {
  try {
    res.json(findAllUsers());
  } catch (err) {
    console.error('[GET /users]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

api.post('/users', writeLimiter, (req, res) => {
  try {
    const name     = sanitize(req.body.name     || '', 150).trim();
    const email    = sanitize(req.body.email    || '', 200).trim().toLowerCase();
    const username = sanitize(req.body.username || '', 80).trim().toLowerCase();
    const password = (req.body.password || '').trim();
    const role     = sanitize(req.body.role     || 'usuario', 20);

    const errors = [];
    if (!name     || name.length     < 2) errors.push('Nome deve ter ao menos 2 caracteres.');
    if (!email    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('E-mail inválido.');
    if (!username || username.length < 3 || !/^[a-z0-9._-]+$/.test(username))
      errors.push('Nome de usuário deve ter ao menos 3 caracteres (letras, números, . _ -).');
    if (!password || password.length < 6) errors.push('Senha deve ter ao menos 6 caracteres.');
    if (!VALID_ROLES.has(role)) errors.push('Perfil inválido.');
    if (errors.length) return res.status(400).json({ errors });

    if (findUserByUsername(username)) return res.status(409).json({ errors: ['Nome de usuário já está em uso.'] });
    if (findUserByEmail(email))       return res.status(409).json({ errors: ['E-mail já está em uso.'] });

    const user = insertUser({
      id:         crypto.randomUUID(),
      name,
      email,
      username,
      role,
      password:   hashPassword(password),
      created_at: Date.now(),
    });
    res.status(201).json(user);
  } catch (err) {
    console.error('[POST /users]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

api.patch('/users/:id', writeLimiter, (req, res) => {
  try {
    const id  = sanitize(req.params.id, 50);
    const doc = colUsers.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const name     = sanitize(req.body.name     !== undefined ? req.body.name     : doc.name,     150).trim();
    const email    = sanitize(req.body.email    !== undefined ? req.body.email    : doc.email,    200).trim().toLowerCase();
    const username = sanitize(req.body.username !== undefined ? req.body.username : doc.username, 80).trim().toLowerCase();
    const role     = sanitize(req.body.role     !== undefined ? req.body.role     : doc.role,     20);
    const password = (req.body.password || '').trim();

    const errors = [];
    if (!name     || name.length     < 2) errors.push('Nome deve ter ao menos 2 caracteres.');
    if (!email    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('E-mail inválido.');
    if (!username || username.length < 3 || !/^[a-z0-9._-]+$/.test(username))
      errors.push('Nome de usuário deve ter ao menos 3 caracteres (letras, números, . _ -).');
    if (!VALID_ROLES.has(role)) errors.push('Perfil inválido.');
    if (password && password.length < 6) errors.push('Nova senha deve ter ao menos 6 caracteres.');
    if (errors.length) return res.status(400).json({ errors });

    const dupUser  = findUserByUsername(username);
    const dupEmail = findUserByEmail(email);
    if (dupUser  && dupUser.id  !== id) return res.status(409).json({ errors: ['Nome de usuário já está em uso.'] });
    if (dupEmail && dupEmail.id !== id) return res.status(409).json({ errors: ['E-mail já está em uso.'] });

    doc.name       = name;
    doc.email      = email;
    doc.username   = username;
    doc.role       = role;
    doc.updated_at = Date.now();
    if (password) doc.password = hashPassword(password);
    colUsers.update(doc);

    res.json(cleanUser(colUsers.findOne({ id })));
  } catch (err) {
    console.error('[PATCH /users/:id]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

api.post('/users/:id/reset-password', writeLimiter, (req, res) => {
  try {
    if (req.session.role !== 'admin')
      return res.status(403).json({ error: 'Apenas administradores podem resetar senhas.' });
    const id  = sanitize(req.params.id, 50);
    const doc = colUsers.findOne({ id });
    if (!doc) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const tempPassword     = generateTempPassword();
    doc.password           = hashPassword(tempPassword);
    doc.password_reset     = true;
    doc.updated_at         = Date.now();
    colUsers.update(doc);
    res.json({ ok: true, tempPassword });
  } catch (err) {
    console.error('[POST /users/:id/reset-password]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

api.delete('/users/:id', (req, res) => {
  try {
    const id = sanitize(req.params.id, 50);
    if (!deleteUserDoc(id)) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /users]', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
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
  createAdminIfNeeded();
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
