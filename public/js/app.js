'use strict';

// ─── AUTH TOKEN ───────────────────────────────────────────────────────────────
let authToken = localStorage.getItem('ct_token') || null;

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const api = {
  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    if (res.status === 401) { showLogin(); throw new Error('Sessão expirada.'); }
    const data = await res.json();
    if (!res.ok) throw new Error(data.errors?.[0] || data.error || 'Erro desconhecido');
    return data;
  },
  get:    (path)        => api.request('GET',    path),
  post:   (path, body)  => api.request('POST',   path, body),
  patch:  (path, body)  => api.request('PATCH',  path, body),
  delete: (path)        => api.request('DELETE', path),
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let view        = 'dashboard';
let cats        = { requisicao: [], incidente: [] };
let charts      = { req: null, inc: null };
let histF       = { q: '', user: '', type: '', status: '', page: 1 };
let formState   = { type: 'requisicao', priority: 'media', software: '' };
let dupTimer      = null;
let currentUser   = null;
let editingUserId = null;
let usersCache    = [];

// ─── SOFTWARE LIST ────────────────────────────────────────────────────────────
// logo: { type:'icon', value:'ti-*', color:'#hex' }  → tabler icon (no external request)
//        { type:'img',  value:'domain.com' }          → DuckDuckGo favicon
const SOFTWARE_LIST = [
  { name: 'ChatGPT',      logo: { type: 'icon', value: 'ti-brand-openai',  color: '#10a37f' } },
  { name: 'Protheus',     logo: { type: 'img',  value: 'totvs.com' } },
  { name: 'Figma Design', logo: { type: 'icon', value: 'ti-brand-figma',   color: '#f24e1e' } },
  { name: 'Databricks',   logo: { type: 'img',  value: 'databricks.com' } },
  { name: 'TailScale',    logo: { type: 'img',  value: 'tailscale.com' } },
  { name: 'Lovable',      logo: { type: 'img',  value: 'lovable.dev' } },
  { name: 'Claude AI',    logo: { type: 'img',  value: 'claude.ai' } },
  { name: 'Claude Code',  logo: { type: 'img',  value: 'anthropic.com' } },
  { name: 'AWS',          logo: { type: 'icon', value: 'ti-brand-aws',     color: '#ff9900' } },
  { name: 'CMS',          logo: { type: 'icon', value: 'ti-layout-grid',   color: '#6b7280' } },
  { name: 'Shortcut',     logo: { type: 'img',  value: 'shortcut.com' } },
  { name: 'Paytrack',     logo: { type: 'img',  value: 'paytrack.com.br' } },
  { name: 'Amplitude',    logo: { type: 'img',  value: 'amplitude.com' } },
  { name: 'Gmail',        logo: { type: 'icon', value: 'ti-brand-gmail',   color: '#ea4335' } },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="ti ti-${type === 'success' ? 'check' : 'alert-circle'}" aria-hidden="true"></i> ${msg}`;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function destroyCharts() {
  if (charts.req) { charts.req.destroy(); charts.req = null; }
  if (charts.inc) { charts.inc.destroy(); charts.inc = null; }
}

function updateSidebar(stats) {
  if (!stats) return;
  const { abertos, em_andamento, total } = stats;
  document.getElementById('cnt-open').textContent  = abertos       || 0;
  document.getElementById('cnt-prog').textContent  = em_andamento  || 0;
  document.getElementById('cnt-total').textContent = total         || 0;
}

// ─── ROLE UI ──────────────────────────────────────────────────────────────────
const ROLE_LABELS = { admin: 'Administrador', tecnico: 'Técnico', usuario: 'Usuário' };

function applyRoleUI(role) {
  const chamadoSection = document.getElementById('nav-section-chamados');
  const chamadoDivider = document.getElementById('nav-divider-chamados');
  const adminSection   = document.getElementById('nav-section-admin');
  const adminDivider   = document.getElementById('nav-divider-admin');
  const counters       = document.getElementById('sidebar-counters');
  const dashBtn        = document.getElementById('nav-dashboard');

  const show = el => el && (el.style.display = '');
  const hide = el => el && (el.style.display = 'none');

  if (role === 'usuario') {
    show(chamadoSection); show(chamadoDivider);
    hide(adminSection);   hide(adminDivider);
    hide(counters);
    if (dashBtn) dashBtn.innerHTML = '<i class="ti ti-ticket" aria-hidden="true"></i> Meus chamados';
  } else if (role === 'tecnico') {
    show(chamadoSection); show(chamadoDivider);
    hide(adminSection);   hide(adminDivider);
    show(counters);
    if (dashBtn) dashBtn.innerHTML = '<i class="ti ti-layout-dashboard" aria-hidden="true"></i> Dashboard';
  } else {
    show(chamadoSection); show(chamadoDivider);
    show(adminSection);   show(adminDivider);
    show(counters);
    if (dashBtn) dashBtn.innerHTML = '<i class="ti ti-layout-dashboard" aria-hidden="true"></i> Dashboard';
  }
}

function updateUserBadge(user) {
  if (!user) return;
  const avatarEl = document.getElementById('su-avatar');
  const nameEl   = document.getElementById('su-name');
  const roleEl   = document.getElementById('su-role');
  if (avatarEl) avatarEl.textContent = user.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  if (nameEl)   nameEl.textContent   = user.name;
  if (roleEl)   roleEl.textContent   = ROLE_LABELS[user.role] || user.role;
}

// ─── ROUTING ─────────────────────────────────────────────────────────────────
function go(v, typeFilter) {
  destroyCharts();

  // Role guards
  if (currentUser?.role === 'usuario') {
    if (v === 'dashboard' || v === 'users') v = 'mytickets';
  } else if (currentUser?.role === 'tecnico') {
    if (v === 'users') v = 'dashboard';
  }

  view = v;
  if (v === 'history' && typeFilter) histF.type = typeFilter;
  else if (v === 'history') histF.type = '';
  histF.page = 1;

  document.querySelectorAll('.nav-item')
    .forEach(b => b.classList.remove('active', 'active-req', 'active-inc'));

  const map = {
    dashboard: 'nav-dashboard', new: 'nav-new', history: 'nav-history',
    users: 'nav-users', mytickets: 'nav-dashboard',
  };
  document.getElementById(map[v])?.classList.add('active');
  if (v === 'history' && typeFilter === 'requisicao') document.getElementById('nav-req')?.classList.add('active-req');
  if (v === 'history' && typeFilter === 'incidente')  document.getElementById('nav-inc')?.classList.add('active-inc');

  const titles = {
    dashboard: 'Dashboard', new: 'Novo Chamado', history: 'Histórico de Chamados',
    users: 'Usuários', mytickets: 'Meus Chamados',
  };
  document.getElementById('topbar-title').textContent = titles[v] || '';

  const c = document.getElementById('app');
  c.className = 'content fade-in';
  void c.offsetWidth;
  render();
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  if      (view === 'dashboard')  renderDashboard();
  else if (view === 'new')        renderNew();
  else if (view === 'history')    renderHistory();
  else if (view === 'users')      renderUsers();
  else if (view === 'mytickets')  renderMyTickets();
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('app');
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Visão geral</h1>
      <span style="font-size:12px;color:var(--text-3)" id="dash-ts">Carregando...</span>
    </div>
    <div id="metrics" class="metrics"><div class="loader"><div class="spinner"></div></div></div>
    <div class="charts-row">
      <div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--blue)"><i class="ti ti-file-invoice" aria-hidden="true"></i> Requisições por tipo</div>
          <span class="card-badge b-blue" id="req-count">—</span>
        </div>
        <div id="req-chart-area"><div class="loader"><div class="spinner"></div></div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--coral)"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Incidentes por tipo</div>
          <span class="card-badge b-coral" id="inc-count">—</span>
        </div>
        <div id="inc-chart-area"><div class="loader"><div class="spinner"></div></div></div>
      </div>
    </div>
    <div class="recent-card">
      <div class="recent-head">
        <span style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:600">Chamados recentes</span>
        <button class="btn btn-sm" onclick="go('history')">Ver todos <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
      </div>
      <div id="recent-list"><div class="loader"><div class="spinner"></div></div></div>
    </div>`;

  try {
    const [statsData, ticketsData] = await Promise.all([
      api.get('/stats'),
      api.get('/tickets?limit=5'),
    ]);

    const s = statsData.overview;
    updateSidebar(s);
    document.getElementById('dash-ts').textContent = 'Atualizado agora';

    // Metrics
    document.getElementById('metrics').innerHTML = `
      <div class="metric m-neutral">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-ticket" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.total}</div><div class="metric-lbl">Total de chamados</div>
      </div>
      <div class="metric m-blue">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-circle-dot" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.abertos}</div><div class="metric-lbl">Abertos</div>
      </div>
      <div class="metric m-amber">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-loader-2" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.em_andamento}</div><div class="metric-lbl">Em andamento</div>
      </div>
      <div class="metric m-green">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-circle-check" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.fechados}</div><div class="metric-lbl">Fechados</div>
      </div>
      <div class="metric m-blue">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-file-invoice" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.requisicoes}</div><div class="metric-lbl">Requisições</div>
      </div>
      <div class="metric m-coral">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-alert-triangle" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.incidentes}</div><div class="metric-lbl">Incidentes</div>
      </div>`;

    // Charts
    buildChart('req', statsData.byCategory.requisicao,
      'req-chart-area', 'req-count', 'bar',
      ['#2563EB','#1D4ED8','#3B82F6','#60A5FA','#93C5FD','#1E40AF','#BFDBFE','#DBEAFE']);

    buildChart('inc', statsData.byCategory.incidente,
      'inc-chart-area', 'inc-count', 'bar',
      ['#DC4B1E','#B83D17','#EA6B3E','#F59063','#FBB597','#922910','#FDCFB8','#FEE4D8']);

    // Recent
    const rows = ticketsData.tickets;
    document.getElementById('recent-list').innerHTML = rows.length
      ? `<div class="t-list">${rows.map(t => ticketRow(t, false)).join('')}</div>`
      : `<div class="empty"><i class="ti ti-inbox" aria-hidden="true"></i><p>Nenhum chamado. <button class="empty-link" onclick="go('new')">Abrir primeiro →</button></p></div>`;

  } catch (err) {
    console.error(err);
    toast('Erro ao carregar dashboard', 'error');
  }
}

const BLUE_PAL  = ['#2563EB','#1D4ED8','#3B82F6','#60A5FA','#93C5FD','#1E40AF'];
const CORAL_PAL = ['#DC4B1E','#B83D17','#EA6B3E','#F59063','#FBB597','#922910'];

function buildChart(key, data, areaId, countId, type, palette) {
  const area = document.getElementById(areaId);
  if (!area) return;

  const total = data.reduce((s, r) => s + r.total, 0);
  document.getElementById(countId).textContent = `${total} total`;

  if (!data.length) {
    area.innerHTML = `<div class="empty" style="padding:30px"><i class="ti ti-chart-donut" aria-hidden="true"></i><p>Sem dados ainda</p></div>`;
    return;
  }

  const labels = data.map(r => r.category);
  const values = data.map(r => r.total);
  const colors = labels.map((_, i) => palette[i % palette.length]);

  area.innerHTML = `<div class="chart-wrap"><canvas id="${key}-chart" role="img" aria-label="Gráfico por categoria">${labels.map((l,i)=>`${l}: ${values[i]}`).join(', ')}</canvas></div>`;

  const canvas = document.getElementById(`${key}-chart`);
  if (!canvas) return;

  charts[key] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderRadius: type === 'bar' ? 5 : undefined,
        borderWidth: 0,
        cutout: type === 'doughnut' ? '62%' : undefined,
        hoverOffset: type === 'doughnut' ? 5 : undefined,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: i => labels[i[0].dataIndex],
            label: c => ` ${c.raw} chamado(s)`,
          },
        },
      },
      ...(type === 'bar' ? {
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 35 } },
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
        },
      } : {}),
    },
  });
}

// ─── TICKET ROW ───────────────────────────────────────────────────────────────
function ticketRow(t, showDup) {
  const isReq = t.type === 'requisicao';
  const icon  = isReq ? 'ti-file-invoice' : 'ti-alert-triangle';
  const cls   = isReq ? 'req' : 'inc';

  const sMap = {
    aberto:       `<span class="badge b-blue"><i class="ti ti-circle-dot"></i>Aberto</span>`,
    em_andamento: `<span class="badge b-amber"><i class="ti ti-loader-2"></i>Em andamento</span>`,
    fechado:      `<span class="badge b-green"><i class="ti ti-circle-check"></i>Fechado</span>`,
  };
  const pMap = {
    alta:  `<span class="badge b-coral">Alta</span>`,
    media: `<span class="badge b-amber">Média</span>`,
    baixa: `<span class="badge b-gray">Baixa</span>`,
  };

  const typeBadge = isReq
    ? `<span class="badge b-blue">Requisição</span>`
    : `<span class="badge b-coral">Incidente</span>`;

  let dup = '';
  if (showDup && t._dup) {
    const dc = t._dup;
    if (dc.kind === 'warning') {
      dup = `<div class="dup-tag dup-warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>${dc.message}</span></div>`;
    } else {
      dup = `<div class="dup-tag dup-info"><i class="ti ti-info-circle" aria-hidden="true"></i><span>${dc.message}</span></div>`;
    }
  }

  const pClass = t.type === 'incidente' ? `p-${t.priority}` : '';
  const id = t.id.replace(/'/g, '');
  const isUsuario = currentUser?.role === 'usuario';

  return `
  <div class="t-item ${pClass}" id="row-${id}">
    <div class="t-icon ${cls}"><i class="ti ${icon}" aria-hidden="true"></i></div>
    <div class="t-body">
      <div class="t-meta">
        <span class="t-id">${t.id}</span>
        ${typeBadge} ${sMap[t.status] || ''}
        ${t.type === 'incidente' ? pMap[t.priority] || '' : ''}
      </div>
      <div class="t-cat">${escHtml(t.category)}${t.subcategory ? `<span class="t-subcat"> · ${escHtml(t.subcategory)}</span>` : ''}</div>
      <div class="t-user"><i class="ti ti-user" aria-hidden="true"></i>${escHtml(t.user_name)}</div>
      <div class="t-desc">${escHtml(t.description)}</div>
      <div class="t-foot">
        <span class="t-time"><i class="ti ti-clock" aria-hidden="true"></i>${fmtDate(t.created_at)}</span>
      </div>
      ${dup}
    </div>
    <div class="t-actions">
      ${isUsuario ? `${sMap[t.status] || ''}` : `
      <select class="status-sel" onchange="updateStatus('${id}', this.value)">
        <option value="aberto"       ${t.status==='aberto'       ?'selected':''}>Aberto</option>
        <option value="em_andamento" ${t.status==='em_andamento' ?'selected':''}>Em andamento</option>
        <option value="fechado"      ${t.status==='fechado'      ?'selected':''}>Fechado</option>
      </select>
      <button class="del-btn" onclick="deleteTicket('${id}')" title="Excluir chamado" aria-label="Excluir chamado">
        <i class="ti ti-trash" aria-hidden="true"></i>
      </button>`}
    </div>
  </div>`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── STATUS / DELETE ──────────────────────────────────────────────────────────
async function updateStatus(id, status) {
  try {
    await api.patch(`/tickets/${encodeURIComponent(id)}/status`, { status });
    toast('Status atualizado');
    const stats = await api.get('/stats');
    updateSidebar(stats.overview);
  } catch (err) {
    toast(err.message, 'error');
    render();
  }
}

async function deleteTicket(id) {
  if (!confirm('Excluir este chamado definitivamente?')) return;
  try {
    await api.delete(`/tickets/${encodeURIComponent(id)}`);
    const row = document.getElementById(`row-${id}`);
    if (row) row.remove();
    toast('Chamado excluído');
    const stats = await api.get('/stats');
    updateSidebar(stats.overview);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
async function renderHistory() {
  const typeLabel = { requisicao: 'Requisições', incidente: 'Incidentes', '': 'Todos' }[histF.type] || 'Todos';

  document.getElementById('app').innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Histórico — ${typeLabel}</h1>
      <button class="btn btn-primary btn-sm" onclick="go('new')"><i class="ti ti-plus" aria-hidden="true"></i>Novo chamado</button>
    </div>
    <div class="filter-bar">
      <input type="search" placeholder="Buscar chamado, usuário..." id="fq" value="${escHtml(histF.q)}"
        oninput="histF.q=this.value;histF.page=1;loadHistory()">
      <input type="text" placeholder="Filtrar por usuário" id="fu" value="${escHtml(histF.user)}"
        oninput="histF.user=this.value;histF.page=1;loadHistory()" style="max-width:180px">
      <select id="ft" onchange="histF.type=this.value;histF.page=1;loadHistory()">
        <option value="">Todos os tipos</option>
        <option value="requisicao" ${histF.type==='requisicao'?'selected':''}>Requisições</option>
        <option value="incidente"  ${histF.type==='incidente' ?'selected':''}>Incidentes</option>
      </select>
      <select id="fs" onchange="histF.status=this.value;histF.page=1;loadHistory()">
        <option value="">Todos os status</option>
        <option value="aberto"       ${histF.status==='aberto'       ?'selected':''}>Abertos</option>
        <option value="em_andamento" ${histF.status==='em_andamento' ?'selected':''}>Em andamento</option>
        <option value="fechado"      ${histF.status==='fechado'      ?'selected':''}>Fechados</option>
      </select>
    </div>
    <div class="history-card">
      <div id="h-list"><div class="loader"><div class="spinner"></div> Carregando...</div></div>
    </div>
    <div id="pagination" class="pagination"></div>`;

  await loadHistory();
}

let histDebounce = null;
async function loadHistory() {
  clearTimeout(histDebounce);
  histDebounce = setTimeout(_doLoadHistory, 300);
}

async function _doLoadHistory() {
  const el = document.getElementById('h-list');
  if (!el) return;

  const params = new URLSearchParams({
    q:      histF.q,
    user:   histF.user,
    type:   histF.type,
    status: histF.status,
    page:   histF.page,
    limit:  20,
  });

  try {
    const data = await api.get(`/tickets?${params}`);
    const { tickets, pagination } = data;

    const enriched = await Promise.all(
      tickets.map(async t => {
        try {
          const dupParams = `/check-duplicate?user=${encodeURIComponent(t.user_name)}&type=${t.type}&category=${encodeURIComponent(t.category)}`
            + (t.subcategory ? `&subcategory=${encodeURIComponent(t.subcategory)}` : '');
          const dup = await api.get(dupParams);
          if (dup.duplicate && dup.count > 0) t._dup = dup;
        } catch (_) {}
        return t;
      })
    );

    el.innerHTML = enriched.length
      ? `<div class="t-list">${enriched.map(t => ticketRow(t, true)).join('')}</div>`
      : `<div class="empty"><i class="ti ti-inbox" aria-hidden="true"></i><p>Nenhum chamado encontrado</p></div>`;

    const pg = document.getElementById('pagination');
    if (pg && pagination.pages > 1) {
      pg.innerHTML = `
        <button class="btn btn-sm" onclick="changePage(${pagination.page - 1})" ${pagination.page <= 1 ? 'disabled' : ''}>
          <i class="ti ti-chevron-left" aria-hidden="true"></i>
        </button>
        <span class="page-info">Página ${pagination.page} de ${pagination.pages} · ${pagination.total} chamados</span>
        <button class="btn btn-sm" onclick="changePage(${pagination.page + 1})" ${pagination.page >= pagination.pages ? 'disabled' : ''}>
          <i class="ti ti-chevron-right" aria-hidden="true"></i>
        </button>`;
    } else if (pg) {
      pg.innerHTML = pagination.total > 0
        ? `<span class="page-info">${pagination.total} chamado(s) encontrado(s)</span>` : '';
    }
  } catch (err) {
    if (el) el.innerHTML = `<div class="empty"><i class="ti ti-alert-circle" aria-hidden="true"></i><p>Erro ao carregar chamados</p></div>`;
    toast(err.message, 'error');
  }
}

function changePage(p) { histF.page = p; loadHistory(); }

// ─── MY TICKETS (Usuário Comum view) ─────────────────────────────────────────
async function renderMyTickets() {
  const el = document.getElementById('app');
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Meus Chamados</h1>
      <button class="btn btn-primary btn-sm" onclick="go('new')">
        <i class="ti ti-plus" aria-hidden="true"></i> Novo chamado
      </button>
    </div>
    <div id="mytickets-body"><div class="loader"><div class="spinner"></div> Carregando...</div></div>`;

  try {
    const data    = await api.get('/tickets?limit=100');
    const tickets = data.tickets;
    const body    = document.getElementById('mytickets-body');
    if (!body) return;

    if (!tickets.length) {
      body.innerHTML = `
        <div class="empty">
          <i class="ti ti-ticket" aria-hidden="true"></i>
          <p>Você ainda não abriu nenhum chamado. <button class="empty-link" onclick="go('new')">Abrir primeiro →</button></p>
        </div>`;
      return;
    }

    const sMap = {
      aberto:       { label: 'Aberto',        cls: 'b-blue',  icon: 'ti-circle-dot'   },
      em_andamento: { label: 'Em andamento',  cls: 'b-amber', icon: 'ti-loader-2'     },
      fechado:      { label: 'Fechado',       cls: 'b-green', icon: 'ti-circle-check' },
    };

    body.innerHTML = `<div class="my-tickets-grid">${tickets.map(t => {
      const s = sMap[t.status] || sMap.aberto;
      const typeCls = t.type === 'requisicao' ? 'b-blue' : 'b-coral';
      const typeLabel = t.type === 'requisicao' ? 'Requisição' : 'Incidente';
      return `
      <div class="my-ticket-card myt-${t.status}">
        <div class="myt-head">
          <span class="myt-id">${escHtml(t.id)}</span>
          <span class="badge ${typeCls}">${typeLabel}</span>
        </div>
        <div>
          <div class="myt-cat">${escHtml(t.category)}</div>
          ${t.subcategory ? `<div class="myt-subcat">${escHtml(t.subcategory)}</div>` : ''}
        </div>
        <div class="myt-desc">${escHtml(t.description)}</div>
        <div class="myt-foot">
          <span class="badge ${s.cls}"><i class="ti ${s.icon}"></i>${s.label}</span>
          <span class="myt-time"><i class="ti ti-clock"></i>${fmtDate(t.created_at)}</span>
        </div>
      </div>`;
    }).join('')}</div>`;

  } catch (err) {
    const body = document.getElementById('mytickets-body');
    if (body) body.innerHTML = `<div class="empty"><i class="ti ti-alert-circle" aria-hidden="true"></i><p>Erro ao carregar chamados.</p></div>`;
    toast(err.message, 'error');
  }
}

// ─── NEW TICKET ───────────────────────────────────────────────────────────────
function renderNew() {
  const catList     = cats[formState.type] || [];
  const isUsuario   = currentUser?.role === 'usuario';
  const nameValue   = isUsuario ? `value="${escHtml(currentUser.name)}"` : '';
  const nameReadonly = isUsuario ? 'readonly style="background:var(--bg);color:var(--text-2);cursor:default"' : '';

  document.getElementById('app').innerHTML = `
    <div class="form-wrap">
      <div class="page-header"><h1 class="page-title">Abrir novo chamado</h1></div>
      <div class="form-card">
        <div style="margin-bottom:18px">
          <div class="form-label">Tipo de chamado</div>
          <div class="type-grid">
            <button class="type-opt ${formState.type==='requisicao'?'sel-req':''}" onclick="setType('requisicao')">
              <i class="ti ti-file-invoice type-icon" aria-hidden="true"></i>
              <span class="type-name">Requisição</span>
              <span class="type-desc">Solicitar acesso a softwares, serviços, equipamentos ou licenças de TI</span>
            </button>
            <button class="type-opt ${formState.type==='incidente'?'sel-inc':''}" onclick="setType('incidente')">
              <i class="ti ti-alert-triangle type-icon" aria-hidden="true"></i>
              <span class="type-name">Incidente</span>
              <span class="type-desc">Reportar algo que parou de funcionar ou está com problema</span>
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="fn">Solicitante *</label>
            <input class="form-input" id="fn" type="text" placeholder="Nome completo" ${nameValue} ${nameReadonly} oninput="scheduleDupCheck()">
          </div>
          ${formState.type === 'incidente' ? `
          <div class="form-group">
            <label class="form-label" for="fp">Prioridade</label>
            <select class="form-select" id="fp">
              <option value="baixa">Baixa</option>
              <option value="media" selected>Média</option>
              <option value="alta">Alta</option>
            </select>
          </div>` : '<div></div>'}
        </div>

        <div class="form-group">
          <label class="form-label" for="fc">Categoria *</label>
          <select class="form-select" id="fc" onchange="onCatChange()">
            <option value="">Selecione uma categoria...</option>
            ${catList.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
          </select>
        </div>

        <div id="software-picker-area"></div>

        <div id="dup-area"></div>

        <div class="form-group">
          <label class="form-label" for="fd">Descrição detalhada *</label>
          <textarea class="form-textarea" id="fd" placeholder="${formState.type === 'requisicao'
            ? 'Descreva o que precisa, para qual projeto ou finalidade, e informe qualquer aprovação já obtida...'
            : 'Descreva o problema: o que ocorre, quando começou, quais erros aparecem e o que já foi tentado...'}"></textarea>
        </div>

        <div class="form-actions">
          <button class="btn" onclick="go(currentUser?.role === 'usuario' ? 'mytickets' : 'dashboard')"><i class="ti ti-x" aria-hidden="true"></i>Cancelar</button>
          <button class="btn btn-primary" id="submit-btn" onclick="submitTicket()">
            <i class="ti ti-send" aria-hidden="true"></i>Registrar chamado
          </button>
        </div>
      </div>
    </div>`;
}

function setType(t) {
  formState.type = t;
  formState.software = '';
  renderNew();
}

function onCatChange() {
  formState.software = '';
  renderSoftwarePicker();
  scheduleDupCheck();
}

function renderSoftwarePicker() {
  const area = document.getElementById('software-picker-area');
  if (!area) return;
  const cat = document.getElementById('fc')?.value;
  if (cat !== 'Acesso a Software') { area.innerHTML = ''; return; }

  const items = SOFTWARE_LIST.map(s => {
    const sel = formState.software === s.name;
    let logoHtml;
    if (s.logo.type === 'icon') {
      logoHtml = `<i class="ti ${s.logo.value} sw-icon" style="color:${s.logo.color}" aria-hidden="true"></i>`;
    } else {
      const src = `https://icons.duckduckgo.com/ip3/${s.logo.value}.ico`;
      logoHtml  = `<img src="${src}" class="sw-logo" alt="" onerror="this.outerHTML='<i class=\\'ti ti-app-window sw-icon\\'></i>'">`;
    }
    return `<button type="button" class="sw-opt${sel ? ' sw-sel' : ''}" onclick="selectSoftware('${escHtml(s.name)}')">${logoHtml}<span class="sw-name">${escHtml(s.name)}</span></button>`;
  }).join('');

  area.innerHTML = `
    <div class="form-group">
      <label class="form-label">Software solicitado *</label>
      <div class="sw-grid">${items}</div>
      ${formState.software ? `<input type="hidden" id="fsw" value="${escHtml(formState.software)}">` : ''}
    </div>`;
}

function selectSoftware(name) {
  formState.software = name;
  renderSoftwarePicker();
  scheduleDupCheck();
}

function scheduleDupCheck() {
  clearTimeout(dupTimer);
  dupTimer = setTimeout(checkDuplicate, 500);
}

async function checkDuplicate() {
  const user = document.getElementById('fn')?.value?.trim();
  const cat  = document.getElementById('fc')?.value;
  const area = document.getElementById('dup-area');
  if (!area) return;
  if (!user || !cat) { area.innerHTML = ''; return; }

  const sub = cat === 'Acesso a Software' ? formState.software : '';
  if (cat === 'Acesso a Software' && !sub) { area.innerHTML = ''; return; }

  try {
    const params = `/check-duplicate?user=${encodeURIComponent(user)}&type=${formState.type}&category=${encodeURIComponent(cat)}`
      + (sub ? `&subcategory=${encodeURIComponent(sub)}` : '');
    const res = await api.get(params);
    if (!res.duplicate) { area.innerHTML = ''; return; }
    const cls  = res.kind === 'warning' ? 'a-warn' : 'a-info';
    const icon = res.kind === 'warning' ? 'ti-alert-triangle' : 'ti-info-circle';
    area.innerHTML = `
      <div class="alert-box ${cls}">
        <i class="ti ${icon}" aria-hidden="true"></i>
        <div>${escHtml(res.message)}</div>
      </div>`;
  } catch (_) {}
}

async function submitTicket() {
  const user_name   = document.getElementById('fn')?.value?.trim();
  const category    = document.getElementById('fc')?.value;
  const description = document.getElementById('fd')?.value?.trim();
  const priority    = document.getElementById('fp')?.value || 'media';
  const subcategory = category === 'Acesso a Software' ? formState.software : '';

  if (!user_name || !category || !description) {
    const missing = [];
    if (!user_name)   missing.push('Solicitante');
    if (!category)    missing.push('Categoria');
    if (!description) missing.push('Descrição');
    toast('Preencha: ' + missing.join(', '), 'error');
    return;
  }
  if (category === 'Acesso a Software' && !subcategory) {
    toast('Selecione o software solicitado.', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Registrando...'; }

  try {
    await api.post('/tickets', {
      type: formState.type, category, subcategory, user_name, description, priority,
    });
    toast('Chamado registrado com sucesso!');
    histF = { q: '', user: '', type: '', status: '', page: 1 };
    go(currentUser?.role === 'usuario' ? 'mytickets' : 'history');
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i>Registrar chamado'; }
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function showLogin() {
  authToken   = null;
  currentUser = null;
  localStorage.removeItem('ct_token');
  document.getElementById('app-shell').style.display    = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('l-username').focus();
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display    = 'flex';
}

async function handleLogin() {
  const btn      = document.getElementById('btn-login');
  const errBox   = document.getElementById('login-error');
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;

  errBox.style.display = 'none';
  if (!username || !password) {
    errBox.textContent   = 'Preencha usuário e senha.';
    errBox.style.display = 'flex';
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Entrando...';

  try {
    const data = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    }).then(r => r.json().then(d => ({ ok: r.ok, ...d })));

    if (!data.ok) throw new Error(data.error || 'Credenciais inválidas.');

    authToken   = data.token;
    currentUser = { id: data.user.id, name: data.user.name, username: data.user.username, role: data.user.role, requiresPasswordChange: data.user.password_reset === true };
    localStorage.setItem('ct_token', authToken);
    showApp();
    applyRoleUI(currentUser.role);
    updateUserBadge(currentUser);

    try {
      cats = await api.get('/categories');
    } catch (_) {
      cats = {
        requisicao: ['Acesso a Software','Acesso a Sistema/Serviço','Equipamento de TI','Licença de Software','Acesso VPN','Criação de E-mail','Permissão de Rede/Pasta','Outros'],
        incidente:  ['Sistema/Aplicação Fora do Ar','Problema com Internet/Rede','Hardware Defeituoso','Impressora com Problema','Computador Lento','E-mail com Problema','Segurança/Vírus','Outros'],
      };
    }

    if (currentUser.role !== 'usuario') {
      try {
        const stats = await api.get('/stats');
        updateSidebar(stats.overview);
      } catch (_) {}
    }

    go(currentUser.role === 'usuario' ? 'mytickets' : 'dashboard');
    if (currentUser.requiresPasswordChange) showChangePasswordModal();
  } catch (err) {
    errBox.innerHTML     = `<i class="ti ti-alert-circle"></i> ${err.message}`;
    errBox.style.display = 'flex';
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-login" aria-hidden="true"></i> Entrar';
  }
}

async function handleLogout() {
  try { await api.request('POST', '/auth/logout'); } catch (_) {}
  showLogin();
}

// ─── USERS ───────────────────────────────────────────────────────────────────
function userInitials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function roleBadge(role) {
  const map = {
    admin:   '<span class="badge b-coral">Admin</span>',
    tecnico: '<span class="badge b-amber">Técnico</span>',
    usuario: '<span class="badge b-gray">Usuário</span>',
  };
  return map[role] || `<span class="badge b-gray">${escHtml(role)}</span>`;
}

async function renderUsers() {
  const el = document.getElementById('app');
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Usuários</h1>
      <button class="btn btn-primary btn-sm" onclick="openUserModal()">
        <i class="ti ti-user-plus" aria-hidden="true"></i> Novo usuário
      </button>
    </div>
    <div id="users-body"><div class="loader"><div class="spinner"></div> Carregando...</div></div>`;
  await loadUsers();
}

async function loadUsers() {
  const body = document.getElementById('users-body');
  if (!body) return;
  try {
    const users = await api.get('/users');
    usersCache = users;
    if (!users.length) {
      body.innerHTML = `<div class="empty"><i class="ti ti-users" aria-hidden="true"></i><p>Nenhum usuário cadastrado ainda.</p></div>`;
      return;
    }
    body.innerHTML = `
      <div class="user-table-wrap">
        <table class="user-table">
          <thead>
            <tr>
              <th></th>
              <th>Nome</th>
              <th>Usuário</th>
              <th>E-mail</th>
              <th>Perfil</th>
              <th>Cadastro</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><div class="u-avatar">${escHtml(userInitials(u.name))}</div></td>
                <td class="u-name">${escHtml(u.name)}</td>
                <td><span class="u-username">@${escHtml(u.username)}</span></td>
                <td class="u-email">${escHtml(u.email)}</td>
                <td>${roleBadge(u.role)}</td>
                <td class="u-date">${fmtDate(u.created_at)}</td>
                <td class="u-actions">
                  <button class="edit-btn" onclick="editUser('${u.id}')" title="Editar usuário" aria-label="Editar usuário">
                    <i class="ti ti-edit" aria-hidden="true"></i>
                  </button>
                  <button class="del-btn" onclick="deleteUserById('${u.id}')" title="Excluir usuário" aria-label="Excluir usuário">
                    <i class="ti ti-trash" aria-hidden="true"></i>
                  </button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (_) {
    body.innerHTML = `<div class="empty"><i class="ti ti-alert-circle" aria-hidden="true"></i><p>Erro ao carregar usuários.</p></div>`;
  }
}

function openUserModal(user = null) {
  editingUserId = user?.id || null;
  const editing = !!editingUserId;

  // Title + submit button
  document.getElementById('user-modal-title').innerHTML = editing
    ? '<i class="ti ti-edit" aria-hidden="true"></i> Editar usuário'
    : '<i class="ti ti-user-plus" aria-hidden="true"></i> Novo usuário';
  document.getElementById('btn-modal-submit').innerHTML = editing
    ? '<i class="ti ti-check" aria-hidden="true"></i> Salvar alterações'
    : '<i class="ti ti-user-plus" aria-hidden="true"></i> Cadastrar';

  // Fill fields
  document.getElementById('u-name').value             = user?.name     || '';
  document.getElementById('u-username').value          = user?.username || '';
  document.getElementById('u-email').value            = user?.email    || '';
  document.getElementById('u-password').value         = '';
  document.getElementById('u-password-confirm').value = '';

  const roleEl = document.getElementById('u-role');
  if (roleEl) roleEl.value = user?.role || 'usuario';

  // Password section: visible only when creating
  const pwSection = document.getElementById('u-password-section');
  if (pwSection) pwSection.style.display = editing ? 'none' : '';

  // Reset button: visible only when editing
  const resetBtn = document.getElementById('btn-modal-reset');
  if (resetBtn) resetBtn.style.display = editing ? '' : 'none';

  document.getElementById('user-modal-errors').innerHTML = '';
  document.getElementById('user-modal').style.display = 'flex';
  document.getElementById('u-name').focus();
}

function closeUserModal() {
  document.getElementById('user-modal').style.display = 'none';
}

async function submitUser() {
  const btn    = document.getElementById('btn-modal-submit');
  const errBox = document.getElementById('user-modal-errors');
  errBox.innerHTML = '';

  const name     = document.getElementById('u-name')?.value.trim();
  const username = document.getElementById('u-username')?.value.trim();
  const email    = document.getElementById('u-email')?.value.trim();
  const password = document.getElementById('u-password')?.value;
  const confirm  = document.getElementById('u-password-confirm')?.value;
  const role     = document.getElementById('u-role')?.value || 'usuario';
  const editing  = !!editingUserId;

  if (!editing && password !== confirm) {
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>As senhas não coincidem.</div></div>`;
    document.getElementById('u-password-confirm').focus();
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = `<div class="spinner" style="width:13px;height:13px"></div> ${editing ? 'Salvando...' : 'Cadastrando...'}`;

  try {
    if (editing) {
      await api.patch(`/users/${encodeURIComponent(editingUserId)}`, { name, username, email, role });
      closeUserModal();
      toast('Usuário atualizado com sucesso!');
    } else {
      await api.post('/users', { name, username, email, password, role });
      closeUserModal();
      toast('Usuário cadastrado com sucesso!');
    }
    loadUsers();
  } catch (err) {
    const msg = err.message || 'Erro ao salvar.';
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>${msg}</div></div>`;
  } finally {
    btn.disabled  = false;
    btn.innerHTML = editing
      ? '<i class="ti ti-check" aria-hidden="true"></i> Salvar alterações'
      : '<i class="ti ti-user-plus" aria-hidden="true"></i> Cadastrar';
  }
}

function editUser(id) {
  const user = usersCache.find(u => u.id === id);
  if (user) openUserModal(user);
}

async function resetUserPassword() {
  if (!editingUserId) return;
  const user = usersCache.find(u => u.id === editingUserId);
  const name = user?.name || 'este usuário';
  if (!confirm(`Resetar a senha de ${name}?\n\nUma senha provisória será gerada e o usuário deverá criar uma senha permanente no próximo login.`)) return;
  try {
    const res = await api.post(`/users/${encodeURIComponent(editingUserId)}/reset-password`);
    closeUserModal();
    showTempPasswordModal(res.tempPassword);
  } catch (err) {
    document.getElementById('user-modal-errors').innerHTML =
      `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>${err.message}</div></div>`;
  }
}

function showTempPasswordModal(password) {
  document.getElementById('tpw-value').textContent = password;
  const copyBtn = document.getElementById('btn-tpw-copy');
  copyBtn.innerHTML = '<i class="ti ti-copy" aria-hidden="true"></i> Copiar';
  document.getElementById('tpw-modal').style.display = 'flex';
}

// ─── CHANGE PASSWORD MODAL (forced reset) ────────────────────────────────────
function showChangePasswordModal() {
  document.getElementById('cp-password').value = '';
  document.getElementById('cp-confirm').value  = '';
  document.getElementById('cp-errors').innerHTML = '';
  document.getElementById('cp-modal').style.display = 'flex';
  document.getElementById('cp-password').focus();
}

async function submitChangePassword() {
  const btn      = document.getElementById('cp-btn-submit');
  const errBox   = document.getElementById('cp-errors');
  const password = document.getElementById('cp-password').value;
  const confirm  = document.getElementById('cp-confirm').value;

  errBox.innerHTML = '';
  if (password !== confirm) {
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>As senhas não coincidem.</div></div>`;
    return;
  }
  if (!password || password.length < 6) {
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>A senha deve ter ao menos 6 caracteres.</div></div>`;
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Salvando...';

  try {
    await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body:    JSON.stringify({ password }),
    }).then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error); return d; }));

    if (currentUser) currentUser.requiresPasswordChange = false;
    document.getElementById('cp-modal').style.display = 'none';
    toast('Senha definida com sucesso!');
  } catch (err) {
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>${err.message}</div></div>`;
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Definir nova senha';
  }
}

async function deleteUserById(id) {
  if (!confirm('Excluir este usuário?')) return;
  try {
    await api.delete(`/users/${encodeURIComponent(id)}`);
    toast('Usuário excluído.');
    loadUsers();
  } catch (err) {
    toast(err.message || 'Erro ao excluir.', 'error');
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  if (authToken) {
    try {
      const me = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      }).then(r => { if (!r.ok) throw new Error(); return r.json(); });
      currentUser = { id: me.userId, name: me.name, username: me.username, role: me.role, requiresPasswordChange: me.requiresPasswordChange === true };
    } catch (_) {
      authToken = null;
      localStorage.removeItem('ct_token');
    }
  }

  if (!authToken) { showLogin(); return; }

  showApp();
  applyRoleUI(currentUser?.role || 'usuario');
  updateUserBadge(currentUser);

  try {
    cats = await api.get('/categories');
  } catch (_) {
    cats = {
      requisicao: ['Acesso a Software','Acesso a Sistema/Serviço','Equipamento de TI','Licença de Software','Acesso VPN','Criação de E-mail','Permissão de Rede/Pasta','Outros'],
      incidente:  ['Sistema/Aplicação Fora do Ar','Problema com Internet/Rede','Hardware Defeituoso','Impressora com Problema','Computador Lento','E-mail com Problema','Segurança/Vírus','Outros'],
    };
  }

  if (currentUser?.role !== 'usuario') {
    try {
      const stats = await api.get('/stats');
      updateSidebar(stats.overview);
    } catch (_) {}
  }

  go(currentUser?.role === 'usuario' ? 'mytickets' : 'dashboard');
  if (currentUser?.requiresPasswordChange) showChangePasswordModal();
}

// Login listeners
document.getElementById('btn-login').addEventListener('click', handleLogin);
document.getElementById('l-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
document.getElementById('l-username').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('l-password').focus(); });
document.getElementById('l-btn-eye').addEventListener('click', () => {
  const inp  = document.getElementById('l-password');
  const btn  = document.getElementById('l-btn-eye');
  const show = inp.type === 'password';
  inp.type   = show ? 'text' : 'password';
  btn.innerHTML = `<i class="ti ti-eye${show ? '-off' : ''}" aria-hidden="true"></i>`;
});
document.getElementById('btn-logout').addEventListener('click', handleLogout);

document.getElementById('nav-dashboard').addEventListener('click', () => go('dashboard'));
document.getElementById('nav-new').addEventListener('click', () => go('new'));
document.getElementById('nav-history').addEventListener('click', () => go('history'));
document.getElementById('nav-req').addEventListener('click', () => go('history', 'requisicao'));
document.getElementById('nav-inc').addEventListener('click', () => go('history', 'incidente'));
document.getElementById('nav-users').addEventListener('click', () => go('users'));
document.getElementById('btn-topbar-new').addEventListener('click', () => go('new'));

// Modal listeners
document.getElementById('btn-modal-close').addEventListener('click', closeUserModal);
document.getElementById('btn-modal-cancel').addEventListener('click', closeUserModal);
document.getElementById('btn-modal-submit').addEventListener('click', submitUser);
document.getElementById('btn-modal-reset').addEventListener('click', resetUserPassword);
document.getElementById('user-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeUserModal(); });

// Temp-password modal listeners
document.getElementById('btn-tpw-close').addEventListener('click', () => {
  document.getElementById('tpw-modal').style.display = 'none';
});
document.getElementById('btn-tpw-ok').addEventListener('click', () => {
  document.getElementById('tpw-modal').style.display = 'none';
});
document.getElementById('btn-tpw-copy').addEventListener('click', () => {
  const pwd = document.getElementById('tpw-value').textContent;
  navigator.clipboard.writeText(pwd).then(() => {
    const btn = document.getElementById('btn-tpw-copy');
    btn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Copiado!';
    setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy" aria-hidden="true"></i> Copiar'; }, 2000);
  });
});

// Change-password modal listeners
document.getElementById('cp-btn-submit').addEventListener('click', submitChangePassword);
document.getElementById('cp-password').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('cp-confirm').focus(); });
document.getElementById('cp-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangePassword(); });
document.getElementById('cp-btn-eye').addEventListener('click', () => {
  const inp = document.getElementById('cp-password');
  const btn = document.getElementById('cp-btn-eye');
  const show = inp.type === 'password';
  inp.type  = show ? 'text' : 'password';
  btn.innerHTML = `<i class="ti ti-eye${show ? '-off' : ''}" aria-hidden="true"></i>`;
});
document.getElementById('cp-btn-eye-confirm').addEventListener('click', () => {
  const inp = document.getElementById('cp-confirm');
  const btn = document.getElementById('cp-btn-eye-confirm');
  const show = inp.type === 'password';
  inp.type  = show ? 'text' : 'password';
  btn.innerHTML = `<i class="ti ti-eye${show ? '-off' : ''}" aria-hidden="true"></i>`;
});
document.getElementById('btn-eye').addEventListener('click', () => {
  const inp  = document.getElementById('u-password');
  const btn  = document.getElementById('btn-eye');
  const show = inp.type === 'password';
  inp.type   = show ? 'text' : 'password';
  btn.innerHTML = `<i class="ti ti-eye${show ? '-off' : ''}" aria-hidden="true"></i>`;
});
document.getElementById('btn-eye-confirm').addEventListener('click', () => {
  const inp  = document.getElementById('u-password-confirm');
  const btn  = document.getElementById('btn-eye-confirm');
  const show = inp.type === 'password';
  inp.type   = show ? 'text' : 'password';
  btn.innerHTML = `<i class="ti ti-eye${show ? '-off' : ''}" aria-hidden="true"></i>`;
});

init();
