'use strict';

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
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
let view      = 'dashboard';
let cats      = { requisicao: [], incidente: [] };
let charts    = { req: null, inc: null };
let histF     = { q: '', user: '', type: '', status: '', page: 1 };
let formState = { type: 'requisicao', priority: 'media' };
let dupTimer  = null;

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

function setLoading(id, loading) {
  const el = document.getElementById(id);
  if (!el) return;
  if (loading) el.innerHTML = `<div class="loader"><div class="spinner"></div> Carregando...</div>`;
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

// ─── ROUTING ─────────────────────────────────────────────────────────────────
function go(v, typeFilter) {
  destroyCharts();
  view = v;
  if (v === 'history' && typeFilter) histF.type = typeFilter;
  else if (v === 'history') histF.type = '';
  histF.page = 1;

  document.querySelectorAll('.nav-item')
    .forEach(b => b.classList.remove('active', 'active-req', 'active-inc'));

  const map = { dashboard: 'nav-dashboard', new: 'nav-new', history: 'nav-history' };
  document.getElementById(map[v])?.classList.add('active');
  if (v === 'history' && typeFilter === 'requisicao') document.getElementById('nav-req')?.classList.add('active-req');
  if (v === 'history' && typeFilter === 'incidente')  document.getElementById('nav-inc')?.classList.add('active-inc');

  const titles = { dashboard: 'Dashboard', new: 'Novo Chamado', history: 'Histórico de Chamados' };
  document.getElementById('topbar-title').textContent = titles[v] || '';

  const c = document.getElementById('app');
  c.className = 'content fade-in';
  void c.offsetWidth;
  render();
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  if (view === 'dashboard') renderDashboard();
  else if (view === 'new')  renderNew();
  else if (view === 'history') renderHistory();
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
      'req-chart-area', 'req-count', 'doughnut',
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

  area.innerHTML = `<div class="chart-wrap"><canvas id="${key}-chart" role="img" aria-label="Gráfico por categoria">${labels.map((l,i)=>`${l}: ${values[i]}`).join(', ')}</canvas></div><div class="chart-legend" id="${key}-legend"></div>`;

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

  const leg = document.getElementById(`${key}-legend`);
  if (leg) {
    leg.innerHTML = labels.map((l, i) =>
      `<span class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${l}: <strong>${values[i]}</strong></span>`
    ).join('');
  }
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

  // Duplicate indicator stored in ticket data (from server on history load)
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

  return `
  <div class="t-item ${pClass}" id="row-${id}">
    <div class="t-icon ${cls}"><i class="ti ${icon}" aria-hidden="true"></i></div>
    <div class="t-body">
      <div class="t-meta">
        <span class="t-id">${t.id}</span>
        ${typeBadge} ${sMap[t.status] || ''}
        ${t.type === 'incidente' ? pMap[t.priority] || '' : ''}
      </div>
      <div class="t-cat">${escHtml(t.category)}</div>
      <div class="t-user"><i class="ti ti-user" aria-hidden="true"></i>${escHtml(t.user_name)}</div>
      <div class="t-desc">${escHtml(t.description)}</div>
      <div class="t-foot">
        <span class="t-time"><i class="ti ti-clock" aria-hidden="true"></i>${fmtDate(t.created_at)}</span>
      </div>
      ${dup}
    </div>
    <div class="t-actions">
      <select class="status-sel" onchange="updateStatus('${id}', this.value)">
        <option value="aberto"       ${t.status==='aberto'       ?'selected':''}>Aberto</option>
        <option value="em_andamento" ${t.status==='em_andamento' ?'selected':''}>Em andamento</option>
        <option value="fechado"      ${t.status==='fechado'      ?'selected':''}>Fechado</option>
      </select>
      <button class="del-btn" onclick="deleteTicket('${id}')" title="Excluir chamado" aria-label="Excluir chamado">
        <i class="ti ti-trash" aria-hidden="true"></i>
      </button>
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
    // Refresh sidebar
    const stats = await api.get('/stats');
    updateSidebar(stats.overview);
  } catch (err) {
    toast(err.message, 'error');
    render(); // revert select UI
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

    // Enrich with duplicate info from server
    const enriched = await Promise.all(
      tickets.map(async t => {
        try {
          const dup = await api.get(
            `/check-duplicate?user=${encodeURIComponent(t.user_name)}&type=${t.type}&category=${encodeURIComponent(t.category)}`
          );
          // Only show dup info if there are OTHER tickets (not just this one)
          if (dup.duplicate && dup.count > 0) t._dup = dup;
        } catch (_) {}
        return t;
      })
    );

    el.innerHTML = enriched.length
      ? `<div class="t-list">${enriched.map(t => ticketRow(t, true)).join('')}</div>`
      : `<div class="empty"><i class="ti ti-inbox" aria-hidden="true"></i><p>Nenhum chamado encontrado</p></div>`;

    // Pagination
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

// ─── NEW TICKET ───────────────────────────────────────────────────────────────
function renderNew() {
  const catList = cats[formState.type] || [];
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
            <label class="form-label" for="fn">Nome do usuário *</label>
            <input class="form-input" id="fn" type="text" placeholder="Nome completo" oninput="scheduleDupCheck()">
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
          <select class="form-select" id="fc" onchange="scheduleDupCheck()">
            <option value="">Selecione uma categoria...</option>
            ${catList.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
          </select>
        </div>

        <div id="dup-area"></div>

        <div class="form-group">
          <label class="form-label" for="fd">Descrição detalhada *</label>
          <textarea class="form-textarea" id="fd" placeholder="${formState.type === 'requisicao'
            ? 'Descreva o que precisa, para qual projeto ou finalidade, e informe qualquer aprovação já obtida...'
            : 'Descreva o problema: o que ocorre, quando começou, quais erros aparecem e o que já foi tentado...'}"></textarea>
        </div>

        <div class="form-actions">
          <button class="btn" onclick="go('dashboard')"><i class="ti ti-x" aria-hidden="true"></i>Cancelar</button>
          <button class="btn btn-primary" id="submit-btn" onclick="submitTicket()">
            <i class="ti ti-send" aria-hidden="true"></i>Registrar chamado
          </button>
        </div>
      </div>
    </div>`;
}

function setType(t) {
  formState.type = t;
  renderNew();
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

  try {
    const res = await api.get(
      `/check-duplicate?user=${encodeURIComponent(user)}&type=${formState.type}&category=${encodeURIComponent(cat)}`
    );
    if (!res.duplicate) { area.innerHTML = ''; return; }
    const cls  = res.kind === 'warning' ? 'a-warn' : 'a-info';
    const icon = res.kind === 'warning' ? 'ti-alert-triangle' : 'ti-info-circle';
    area.innerHTML = `
      <div class="alert-box ${cls}">
        <i class="ti ${icon}" aria-hidden="true"></i>
        <div>${escHtml(res.message)}</div>
      </div>`;
  } catch (_) { /* silently skip */ }
}

async function submitTicket() {
  const user_name   = document.getElementById('fn')?.value?.trim();
  const category    = document.getElementById('fc')?.value;
  const description = document.getElementById('fd')?.value?.trim();
  const priority    = document.getElementById('fp')?.value || 'media';

  if (!user_name || !category || !description) {
    const missing = [];
    if (!user_name)   missing.push('Nome do usuário');
    if (!category)    missing.push('Categoria');
    if (!description) missing.push('Descrição');
    toast('Preencha: ' + missing.join(', '), 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div> Registrando...'; }

  try {
    await api.post('/tickets', {
      type: formState.type, category, user_name, description, priority,
    });
    toast('Chamado registrado com sucesso!');
    histF = { q: '', user: '', type: '', status: '', page: 1 };
    go('history');
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send" aria-hidden="true"></i>Registrar chamado'; }
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  // Load categories from server
  try {
    cats = await api.get('/categories');
  } catch (_) {
    // Fallback if server not ready
    cats = {
      requisicao: ['Acesso a Software','Acesso a Sistema/Serviço','Equipamento de TI','Licença de Software','Acesso VPN','Criação de E-mail','Permissão de Rede/Pasta','Outros'],
      incidente:  ['Sistema/Aplicação Fora do Ar','Problema com Internet/Rede','Hardware Defeituoso','Impressora com Problema','Computador Lento','E-mail com Problema','Segurança/Vírus','Outros'],
    };
  }

  // Initial sidebar stats
  try {
    const stats = await api.get('/stats');
    updateSidebar(stats.overview);
  } catch (_) {}

  go('dashboard');
}

init();
