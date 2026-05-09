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
let charts      = { req: null, inc: null, tech: null, sla: null };
let histF       = { q: '', user: '', type: '', status: '', page: 1 };
let formState   = { type: 'requisicao', priority: 'media', software: '' };
let dupTimer      = null;
let currentUser   = null;
let editingUserId = null;
let usersCache      = [];
let currentTicketId = null;

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

// ─── TRANSLATIONS ────────────────────────────────────────────────────────────
const TRANSLATIONS = {
  pt: {
    'brand.name':'Central de Chamados','brand.sub':'Suporte TI',
    'auth.username':'Usuário','auth.password':'Senha','auth.login':'Entrar',
    'auth.username_ph':'seu.usuario','auth.fill_fields':'Preencha usuário e senha.',
    'auth.logging_in':'Entrando...',
    'nav.menu':'Menu','nav.dashboard':'Dashboard','nav.new_ticket':'Novo chamado',
    'nav.tickets':'Chamados','nav.history':'Histórico geral','nav.requests':'Requisições',
    'nav.incidents':'Incidentes','nav.admin':'Administração','nav.users':'Usuários',
    'nav.my_tickets':'Meus chamados',
    'counter.open':'Abertos','counter.in_analysis':'Em análise','counter.total':'Total geral',
    'btn.new_ticket':'Novo chamado','btn.logout':'Sair','btn.cancel':'Cancelar',
    'btn.save':'Salvar','btn.view':'Ver','btn.view_details':'Ver detalhes',
    'status.aberto':'Aberto','status.em_analise':'Em análise','status.pendente':'Pendente',
    'status.pendente_terceiros':'Pend. Terceiros','status.fechado':'Fechado',
    'type.requisicao':'Requisição','type.incidente':'Incidente',
    'priority.alta':'Alta','priority.media':'Média','priority.baixa':'Baixa',
    'role.admin':'Administrador','role.gerencia':'Gerência','role.tecnico':'Técnico','role.usuario':'Usuário',
    'dash.overview':'Visão geral','dash.updated':'Atualizado agora',
    'dash.total':'Total de chamados','dash.open':'Abertos','dash.in_analysis':'Em análise',
    'dash.pending':'Pendente','dash.pending_third':'Pend. Terceiros','dash.closed':'Fechados',
    'dash.requests':'Requisições','dash.incidents':'Incidentes',
    'dash.req_by_type':'Requisições por tipo','dash.inc_by_type':'Incidentes por tipo',
    'dash.recent':'Chamados recentes','dash.see_all':'Ver todos','dash.my_assigned':'Meus chamados atribuídos','dash.no_assigned':'Nenhum chamado atribuído a você.','dash.by_technician':'Chamados por técnico','dash.sla_title':'SLA — Nível de Serviço','dash.sla_within':'Dentro do SLA','dash.sla_risk':'Em risco','dash.sla_breach':'Violado','dash.sla_paused':'Pausado','dash.sla_compliance':'de conformidade','dash.sla_active':'chamados ativos','dash.sla_ref':'Referência de metas SLA',
    'ticket.new':'Abrir novo chamado','ticket.type':'Tipo de chamado',
    'ticket.requester':'Solicitante','ticket.priority':'Prioridade',
    'ticket.category':'Categoria','ticket.description':'Descrição detalhada',
    'ticket.cancel':'Cancelar','ticket.submit':'Registrar chamado',
    'ticket.select_cat':'Selecione uma categoria...',
    'ticket.req_title':'Requisição',
    'ticket.req_desc':'Solicitar acesso a softwares, serviços, equipamentos ou licenças de TI',
    'ticket.inc_title':'Incidente',
    'ticket.inc_desc':'Reportar algo que parou de funcionar ou está com problema',
    'ticket.req_ph':'Descreva o que precisa, para qual projeto ou finalidade, e informe qualquer aprovação já obtida...',
    'ticket.inc_ph':'Descreva o problema: o que ocorre, quando começou, quais erros aparecem e o que já foi tentado...',
    'ticket.submitting':'Registrando...',
    'history.title':'Histórico de Chamados','history.search':'Buscar chamado, usuário...',
    'history.filter_user':'Filtrar por usuário','history.all_types':'Todos os tipos',
    'history.all_status':'Todos os status',
    'td.back':'Voltar','td.status':'Status','td.type':'Tipo','td.priority':'Prioridade',
    'td.requester':'Solicitante','td.category':'Categoria','td.technician':'Técnico',
    'td.opened_at':'Aberto em','td.updated_at':'Última atualização','td.description':'Descrição',
    'td.procedures':'Procedimentos técnicos','td.no_procedures':'Nenhum procedimento registrado.',
    'td.update':'Atualizar chamado','td.assign':'Atribuir a técnico',
    'td.keep_current':'— Manter atual —','td.add_procedure':'Registrar procedimento',
    'td.procedure_ph':'Descreva o procedimento técnico realizado...','td.save':'Salvar',
    'td.unassigned':'Não atribuído',
    'users.title':'Usuários','users.new':'Novo usuário','users.name':'Nome',
    'users.username':'Usuário','users.email':'E-mail','users.role':'Perfil',
    'users.created_at':'Cadastro',
    'mytickets.title':'Meus Chamados','mytickets.empty':'Você ainda não abriu nenhum chamado.',
    'toast.ticket_created':'Chamado registrado com sucesso!',
    'toast.ticket_updated':'Chamado atualizado!','toast.ticket_deleted':'Chamado excluído',
    'toast.status_updated':'Status atualizado','toast.user_created':'Usuário cadastrado com sucesso!',
    'toast.user_updated':'Usuário atualizado com sucesso!','toast.user_deleted':'Usuário excluído.',
    'toast.password_changed':'Senha alterada com sucesso!',
    'pwd.change_title':'Alterar senha','pwd.current':'Senha atual *','pwd.new':'Nova senha *',
    'pwd.confirm':'Confirmar nova senha *','pwd.save':'Alterar senha',
    'pwd.wrong':'Senha atual incorreta.','pwd.no_match':'As senhas não coincidem.',
    'pwd.min_length':'A senha deve ter ao menos 6 caracteres.',
    'view.dashboard':'Dashboard','view.new':'Novo Chamado','view.history':'Histórico de Chamados',
    'view.users':'Usuários','view.mytickets':'Meus Chamados','view.ticket':'Detalhe do Chamado',
    'loading':'Carregando...','confirm.delete_ticket':'Excluir este chamado definitivamente?',
    'confirm.delete_user':'Excluir este usuário?',
    'empty.no_tickets':'Nenhum chamado encontrado','empty.no_data':'Sem dados ainda',
    'total_label':'total',
    'req_count_label':'total',
  },
  en: {
    'brand.name':'IT Help Desk','brand.sub':'IT Support',
    'auth.username':'Username','auth.password':'Password','auth.login':'Login',
    'auth.username_ph':'your.username','auth.fill_fields':'Please fill in username and password.',
    'auth.logging_in':'Logging in...',
    'nav.menu':'Menu','nav.dashboard':'Dashboard','nav.new_ticket':'New ticket',
    'nav.tickets':'Tickets','nav.history':'All tickets','nav.requests':'Requests',
    'nav.incidents':'Incidents','nav.admin':'Administration','nav.users':'Users',
    'nav.my_tickets':'My tickets',
    'counter.open':'Open','counter.in_analysis':'In analysis','counter.total':'Total',
    'btn.new_ticket':'New ticket','btn.logout':'Logout','btn.cancel':'Cancel',
    'btn.save':'Save','btn.view':'View','btn.view_details':'View details',
    'status.aberto':'Open','status.em_analise':'In analysis','status.pendente':'Pending',
    'status.pendente_terceiros':'Pend. 3rd party','status.fechado':'Closed',
    'type.requisicao':'Request','type.incidente':'Incident',
    'priority.alta':'High','priority.media':'Medium','priority.baixa':'Low',
    'role.admin':'Administrator','role.gerencia':'Management','role.tecnico':'Technician','role.usuario':'User',
    'dash.overview':'Overview','dash.updated':'Just updated',
    'dash.total':'Total tickets','dash.open':'Open','dash.in_analysis':'In analysis',
    'dash.pending':'Pending','dash.pending_third':'Pend. 3rd party','dash.closed':'Closed',
    'dash.requests':'Requests','dash.incidents':'Incidents',
    'dash.req_by_type':'Requests by type','dash.inc_by_type':'Incidents by type',
    'dash.recent':'Recent tickets','dash.see_all':'View all','dash.my_assigned':'My assigned tickets','dash.no_assigned':'No tickets assigned to you.','dash.by_technician':'Tickets by technician','dash.sla_title':'SLA — Service Level','dash.sla_within':'Within SLA','dash.sla_risk':'At risk','dash.sla_breach':'Breached','dash.sla_paused':'Paused','dash.sla_compliance':'compliance','dash.sla_active':'active tickets','dash.sla_ref':'SLA target reference',
    'ticket.new':'Open new ticket','ticket.type':'Ticket type',
    'ticket.requester':'Requester','ticket.priority':'Priority',
    'ticket.category':'Category','ticket.description':'Detailed description',
    'ticket.cancel':'Cancel','ticket.submit':'Submit ticket',
    'ticket.select_cat':'Select a category...',
    'ticket.req_title':'Request',
    'ticket.req_desc':'Request access to software, services, equipment or IT licenses',
    'ticket.inc_title':'Incident',
    'ticket.inc_desc':'Report something that stopped working or has a problem',
    'ticket.req_ph':'Describe what you need, for which project or purpose...',
    'ticket.inc_ph':'Describe the problem: what happens, when it started, what errors appear...',
    'ticket.submitting':'Submitting...',
    'history.title':'Ticket History','history.search':'Search ticket, user...',
    'history.filter_user':'Filter by user','history.all_types':'All types',
    'history.all_status':'All statuses',
    'td.back':'Back','td.status':'Status','td.type':'Type','td.priority':'Priority',
    'td.requester':'Requester','td.category':'Category','td.technician':'Technician',
    'td.opened_at':'Opened at','td.updated_at':'Last updated','td.description':'Description',
    'td.procedures':'Technical procedures','td.no_procedures':'No procedures recorded yet.',
    'td.update':'Update ticket','td.assign':'Assign to technician',
    'td.keep_current':'— Keep current —','td.add_procedure':'Add procedure',
    'td.procedure_ph':'Describe the technical procedure performed...','td.save':'Save',
    'td.unassigned':'Unassigned',
    'users.title':'Users','users.new':'New user','users.name':'Name',
    'users.username':'Username','users.email':'E-mail','users.role':'Role',
    'users.created_at':'Created at',
    'mytickets.title':'My Tickets','mytickets.empty':'You have not opened any tickets yet.',
    'toast.ticket_created':'Ticket submitted successfully!',
    'toast.ticket_updated':'Ticket updated!','toast.ticket_deleted':'Ticket deleted',
    'toast.status_updated':'Status updated','toast.user_created':'User created successfully!',
    'toast.user_updated':'User updated successfully!','toast.user_deleted':'User deleted.',
    'toast.password_changed':'Password changed successfully!',
    'pwd.change_title':'Change password','pwd.current':'Current password *',
    'pwd.new':'New password *','pwd.confirm':'Confirm new password *',
    'pwd.save':'Change password','pwd.wrong':'Current password is incorrect.',
    'pwd.no_match':'Passwords do not match.',
    'pwd.min_length':'Password must be at least 6 characters.',
    'view.dashboard':'Dashboard','view.new':'New Ticket','view.history':'Ticket History',
    'view.users':'Users','view.mytickets':'My Tickets','view.ticket':'Ticket Detail',
    'loading':'Loading...','confirm.delete_ticket':'Permanently delete this ticket?',
    'confirm.delete_user':'Delete this user?',
    'empty.no_tickets':'No tickets found','empty.no_data':'No data yet',
    'total_label':'total',
    'req_count_label':'total',
  },
};

let lang = localStorage.getItem('ct_lang') || 'pt';

function t(key) {
  return (TRANSLATIONS[lang] || TRANSLATIONS.pt)[key] || key;
}

function toggleLang() {
  lang = lang === 'pt' ? 'en' : 'pt';
  localStorage.setItem('ct_lang', lang);
  applyTranslations();
  render();
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const val = t(el.getAttribute('data-i18n'));
    if (val) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const val = t(el.getAttribute('data-i18n-placeholder'));
    if (val) el.placeholder = val;
  });
  const langLabel      = document.getElementById('lang-label');
  const loginLangLabel = document.getElementById('login-lang-label');
  if (langLabel)      langLabel.textContent      = lang === 'pt' ? 'PT' : 'EN';
  if (loginLangLabel) loginLangLabel.textContent = lang === 'pt' ? 'PT' : 'EN';
  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en';
  document.title = lang === 'pt' ? 'Central de Chamados TI' : 'IT Help Desk';
  if (currentUser) applyRoleUI(currentUser.role);
  const titles = {
    dashboard: t('view.dashboard'), new: t('view.new'), history: t('view.history'),
    users: t('view.users'), mytickets: t('view.mytickets'), ticket: t('view.ticket'),
  };
  const titleEl = document.getElementById('topbar-title');
  if (titleEl && titles[view]) titleEl.textContent = titles[view];
}

// ─── STATUS MAP ───────────────────────────────────────────────────────────────
const STATUS_MAP = {
  aberto:             { label: 'Aberto',          cls: 'b-blue',   icon: 'ti-circle-dot'   },
  em_analise:         { label: 'Em análise',       cls: 'b-amber',  icon: 'ti-loader-2'     },
  pendente:           { label: 'Pendente',         cls: 'b-orange', icon: 'ti-clock-pause'  },
  pendente_terceiros: { label: 'Pend. Terceiros',  cls: 'b-purple', icon: 'ti-users'        },
  fechado:            { label: 'Fechado',          cls: 'b-green',  icon: 'ti-circle-check' },
};
const STATUS_OPTIONS = ['aberto', 'em_analise', 'pendente', 'pendente_terceiros', 'fechado'];

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
  const { abertos, em_analise, total } = stats;
  document.getElementById('cnt-open').textContent  = abertos    || 0;
  document.getElementById('cnt-prog').textContent  = em_analise || 0;
  document.getElementById('cnt-total').textContent = total      || 0;
}

// ─── ROLE UI ──────────────────────────────────────────────────────────────────
const ROLE_LABELS = { admin: 'role.admin', gerencia: 'role.gerencia', tecnico: 'role.tecnico', usuario: 'role.usuario' };
const ADMIN_ROLES = new Set(['admin', 'gerencia']);

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
    if (dashBtn) dashBtn.innerHTML = `<i class="ti ti-ticket" aria-hidden="true"></i> <span data-i18n="nav.my_tickets">${t('nav.my_tickets')}</span>`;
  } else if (role === 'tecnico') {
    show(chamadoSection); show(chamadoDivider);
    hide(adminSection);   hide(adminDivider);
    show(counters);
    if (dashBtn) dashBtn.innerHTML = `<i class="ti ti-layout-dashboard" aria-hidden="true"></i> <span data-i18n="nav.dashboard">${t('nav.dashboard')}</span>`;
  } else {
    // admin e gerencia
    show(chamadoSection); show(chamadoDivider);
    show(adminSection);   show(adminDivider);
    show(counters);
    if (dashBtn) dashBtn.innerHTML = `<i class="ti ti-layout-dashboard" aria-hidden="true"></i> <span data-i18n="nav.dashboard">${t('nav.dashboard')}</span>`;
  }
}

function updateUserBadge(user) {
  if (!user) return;
  const avatarEl = document.getElementById('su-avatar');
  const nameEl   = document.getElementById('su-name');
  const roleEl   = document.getElementById('su-role');
  if (avatarEl) avatarEl.textContent = user.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  if (nameEl)   nameEl.textContent   = user.name;
  if (roleEl)   roleEl.textContent   = t(ROLE_LABELS[user.role] || user.role);
}

// ─── ROUTING ─────────────────────────────────────────────────────────────────
function go(v, typeFilter) {
  destroyCharts();

  // Role guards
  const role = currentUser?.role;
  if (role === 'usuario') {
    if (v === 'dashboard' || v === 'users') v = 'mytickets';
  } else if (role === 'tecnico') {
    if (v === 'users') v = 'dashboard';
  }
  // admin e gerencia: sem restrições

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
    dashboard: t('view.dashboard'), new: t('view.new'), history: t('view.history'),
    users: t('view.users'), mytickets: t('view.mytickets'), ticket: t('view.ticket'),
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
  else if (view === 'ticket')     renderTicketDetail(currentTicketId);
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  Object.keys(charts).forEach(k => { if (charts[k]) { charts[k].destroy(); charts[k] = null; } });
  const el = document.getElementById('app');
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('dash.overview')}</h1>
      <span style="font-size:12px;color:var(--text-3)" id="dash-ts">${t('loading')}</span>
    </div>
    <div id="metrics" class="metrics"><div class="loader"><div class="spinner"></div></div></div>
    <div class="charts-row">
      <div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--blue)"><i class="ti ti-file-invoice" aria-hidden="true"></i> ${t('dash.req_by_type')}</div>
          <span class="card-badge b-blue" id="req-count">—</span>
        </div>
        <div id="req-chart-area"><div class="loader"><div class="spinner"></div></div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title" style="color:var(--coral)"><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${t('dash.inc_by_type')}</div>
          <span class="card-badge b-coral" id="inc-count">—</span>
        </div>
        <div id="inc-chart-area"><div class="loader"><div class="spinner"></div></div></div>
      </div>
    </div>
    <div class="dash-bottom-row">
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="ti ti-clock-check" aria-hidden="true"></i> ${t('dash.sla_title')}</div>
          <span class="card-badge b-green" id="sla-badge">—</span>
        </div>
        <div id="sla-chart-area"><div class="loader"><div class="spinner"></div></div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title"><i class="ti ti-user-check" aria-hidden="true"></i> ${t('dash.by_technician')}</div>
          <span class="card-badge b-gray" id="tech-count">—</span>
        </div>
        <div id="tech-chart-area"><div class="loader"><div class="spinner"></div></div></div>
      </div>
    </div>
    <div class="recent-card">
      <div class="recent-head">
        <span style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:600" id="recent-title"></span>
        <button class="btn btn-sm" id="recent-action"></button>
      </div>
      <div id="recent-list"><div class="loader"><div class="spinner"></div></div></div>
    </div>`;

  const isTecnico = currentUser?.role === 'tecnico';
  const assignedQuery = isTecnico
    ? `/tickets?assigned_to=${encodeURIComponent(currentUser.id)}&limit=100`
    : '/tickets?limit=5';

  try {
    const [statsData, ticketsData] = await Promise.all([
      api.get('/stats'),
      api.get(assignedQuery),
    ]);

    const s = statsData.overview;
    updateSidebar(s);
    document.getElementById('dash-ts').textContent = t('dash.updated');

    // Recent / Assigned section header
    const titleEl  = document.getElementById('recent-title');
    const actionEl = document.getElementById('recent-action');
    if (isTecnico) {
      if (titleEl)  titleEl.textContent = t('dash.my_assigned');
      if (actionEl) {
        actionEl.innerHTML = `${t('dash.see_all')} <i class="ti ti-arrow-right" aria-hidden="true"></i>`;
        actionEl.onclick = () => openStatusDrawer('', '');
      }
    } else {
      if (titleEl)  titleEl.textContent = t('dash.recent');
      if (actionEl) {
        actionEl.innerHTML = `${t('dash.see_all')} <i class="ti ti-arrow-right" aria-hidden="true"></i>`;
        actionEl.onclick = () => go('history');
      }
    }

    // Metrics
    document.getElementById('metrics').innerHTML = `
      <div class="metric m-neutral metric-clickable" onclick="openStatusDrawer('','')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-ticket" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.total}</div><div class="metric-lbl">${t('dash.total')}</div>
      </div>
      <div class="metric m-blue metric-clickable" onclick="openStatusDrawer('aberto','')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-circle-dot" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.abertos}</div><div class="metric-lbl">${t('dash.open')}</div>
      </div>
      <div class="metric m-amber metric-clickable" onclick="openStatusDrawer('em_analise','')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-loader-2" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.em_analise}</div><div class="metric-lbl">${t('dash.in_analysis')}</div>
      </div>
      <div class="metric m-orange metric-clickable" onclick="openStatusDrawer('pendente','')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-clock-pause" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.pendente}</div><div class="metric-lbl">${t('dash.pending')}</div>
      </div>
      <div class="metric m-purple metric-clickable" onclick="openStatusDrawer('pendente_terceiros','')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-users" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.pendente_terceiros}</div><div class="metric-lbl">${t('dash.pending_third')}</div>
      </div>
      <div class="metric m-green metric-clickable" onclick="openStatusDrawer('fechado','')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-circle-check" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.fechados}</div><div class="metric-lbl">${t('dash.closed')}</div>
      </div>
      <div class="metric m-blue metric-clickable" onclick="openStatusDrawer('','requisicao')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-file-invoice" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.requisicoes}</div><div class="metric-lbl">${t('dash.requests')}</div>
      </div>
      <div class="metric m-coral metric-clickable" onclick="openStatusDrawer('','incidente')">
        <div class="metric-top"><div class="metric-icon"><i class="ti ti-alert-triangle" aria-hidden="true"></i></div></div>
        <div class="metric-num">${s.incidentes}</div><div class="metric-lbl">${t('dash.incidents')}</div>
      </div>`;

    // Charts
    buildChart('req', statsData.byCategory.requisicao,
      'req-chart-area', 'req-count', 'bar',
      ['#2563EB','#1D4ED8','#3B82F6','#60A5FA','#93C5FD','#1E40AF','#BFDBFE','#DBEAFE']);

    buildChart('inc', statsData.byCategory.incidente,
      'inc-chart-area', 'inc-count', 'bar',
      ['#DC4B1E','#B83D17','#EA6B3E','#F59063','#FBB597','#922910','#FDCFB8','#FEE4D8']);

    buildSlaChart(statsData.sla);
    buildTechPieChart(statsData.byTechnician);

    // Recent / Assigned list
    const rows = ticketsData.tickets;
    const emptyMsg = isTecnico
      ? `<div class="empty"><i class="ti ti-inbox" aria-hidden="true"></i><p>${t('dash.no_assigned')}</p></div>`
      : `<div class="empty"><i class="ti ti-inbox" aria-hidden="true"></i><p>Nenhum chamado. <button class="empty-link" onclick="go('new')">Abrir primeiro →</button></p></div>`;
    document.getElementById('recent-list').innerHTML = rows.length
      ? `<div class="t-list">${rows.map(tk => ticketRow(tk, false)).join('')}</div>`
      : emptyMsg;

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

function buildSlaChart(sla) {
  const area    = document.getElementById('sla-chart-area');
  const badgeEl = document.getElementById('sla-badge');
  if (!area) return;

  if (!sla) { area.innerHTML = ''; return; }

  const pct   = sla.compliance;
  const color = pct >= 90 ? '#16A34A' : pct >= 70 ? '#D97706' : '#DC2626';

  if (badgeEl) {
    badgeEl.textContent = `${pct}%`;
    badgeEl.className   = `card-badge ${pct >= 90 ? 'b-green' : pct >= 70 ? 'b-amber' : 'b-coral'}`;
  }

  area.innerHTML = `
    <div class="sla-wrap">
      <div class="sla-donut-wrap">
        <canvas id="sla-chart" width="160" height="160"></canvas>
        <div class="sla-center">
          <div class="sla-pct" style="color:${color}">${pct}%</div>
          <div class="sla-pct-lbl">${t('dash.sla_compliance')}</div>
        </div>
      </div>
      <div class="sla-right">
        <div class="sla-metrics">
          <div class="sla-metric">
            <span class="sla-dot" style="background:#16A34A"></span>
            <span class="sla-metric-lbl">${t('dash.sla_within')}</span>
            <span class="sla-metric-val" style="color:#16A34A">${sla.dentro}</span>
          </div>
          <div class="sla-metric">
            <span class="sla-dot" style="background:#D97706"></span>
            <span class="sla-metric-lbl">${t('dash.sla_risk')}</span>
            <span class="sla-metric-val" style="color:#D97706">${sla.risco}</span>
          </div>
          <div class="sla-metric">
            <span class="sla-dot" style="background:#DC2626"></span>
            <span class="sla-metric-lbl">${t('dash.sla_breach')}</span>
            <span class="sla-metric-val" style="color:#DC2626">${sla.violado}</span>
          </div>
          <div class="sla-metric">
            <span class="sla-dot" style="background:var(--text-3)"></span>
            <span class="sla-metric-lbl">${t('dash.sla_paused')}</span>
            <span class="sla-metric-val" style="color:var(--text-2)">${sla.pausado}</span>
          </div>
        </div>
        <div class="sla-ref">
          <div class="sla-ref-title">${t('dash.sla_ref')}</div>
          <table class="sla-table">
            <tr><td><span class="badge b-coral" style="font-size:10px">Incidente Alta</span></td><td>4 h</td></tr>
            <tr><td><span class="badge b-amber" style="font-size:10px">Incidente Média</span></td><td>8 h</td></tr>
            <tr><td><span class="badge b-gray"  style="font-size:10px">Incidente Baixa</span></td><td>24 h</td></tr>
            <tr><td><span class="badge b-blue"  style="font-size:10px">Requisição</span></td><td>72 h</td></tr>
          </table>
          <p class="sla-note"><i class="ti ti-pause" aria-hidden="true"></i> SLA pausado em Pendente / Pend. Terceiros</p>
        </div>
      </div>
    </div>`;

  const canvas = document.getElementById('sla-chart');
  if (!canvas) return;

  const hasData = sla.active > 0;
  charts.sla = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: [t('dash.sla_within'), t('dash.sla_risk'), t('dash.sla_breach')],
      datasets: [{
        data: hasData ? [sla.dentro, sla.risco, sla.violado] : [1],
        backgroundColor: hasData ? ['#16A34A', '#D97706', '#DC2626'] : ['#e5e7eb'],
        borderWidth: 0,
        cutout: '72%',
        hoverOffset: 4,
      }],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: hasData,
          callbacks: {
            label: c => ` ${c.raw} chamado(s)`,
          },
        },
      },
    },
  });
}

function buildTechPieChart(data) {
  const area    = document.getElementById('tech-chart-area');
  const countEl = document.getElementById('tech-count');
  if (!area) return;

  if (!data || !data.length) {
    if (countEl) countEl.textContent = '0';
    area.innerHTML = `<div class="empty" style="padding:30px"><i class="ti ti-chart-donut" aria-hidden="true"></i><p>${t('empty.no_data')}</p></div>`;
    return;
  }

  const total = data.reduce((s, r) => s + r.total, 0);
  if (countEl) countEl.textContent = `${total} total`;

  const labels  = data.map(r => r.name);
  const values  = data.map(r => r.total);
  const palette = [
    '#2563EB','#DC4B1E','#10B981','#F59E0B','#8B5CF6',
    '#EC4899','#06B6D4','#84CC16','#F97316','#6366F1',
    '#14B8A6','#EF4444','#A855F7','#EAB308','#3B82F6',
  ];
  const colors = labels.map((_, i) => palette[i % palette.length]);

  area.innerHTML = `<div class="tech-pie-wrap"><div class="tech-pie-canvas-wrap"><canvas id="tech-chart" width="260" height="230" aria-label="Gráfico 3D por técnico"></canvas></div><div class="tech-pie-legend" id="tech-legend"></div></div>`;

  const canvas = document.getElementById('tech-chart');
  if (!canvas) return;

  charts.tech = null;
  draw3DPie(canvas, values, colors, total);

  const legend = document.getElementById('tech-legend');
  if (legend) {
    legend.innerHTML = data.map((r, i) => `
      <div class="tech-legend-item">
        <span class="tech-legend-dot" style="background:${colors[i]}"></span>
        <span class="tech-legend-name">${escHtml(r.name)}</span>
        <span class="tech-legend-count">${r.total} <span style="font-weight:400;color:var(--text-3)">(${Math.round(r.total/total*100)}%)</span></span>
      </div>`).join('');
  }
}

function draw3DPie(canvas, values, colors, total) {
  const ctx   = canvas.getContext('2d');
  const W     = canvas.width;
  const H     = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const cx    = W / 2;
  const cy    = H * 0.42;
  const rx    = W * 0.38;
  const ry    = rx * 0.42;   // squash for perspective
  const depth = 26;           // 3D extrusion height

  // Build slices
  const slices = [];
  let angle = -Math.PI / 2;
  for (let i = 0; i < values.length; i++) {
    const sweep = (values[i] / total) * 2 * Math.PI;
    slices.push({ start: angle, end: angle + sweep, color: colors[i] });
    angle += sweep;
  }

  // Darken hex color for side faces
  function darken(hex, f = 0.52) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
  }

  // Painter's algorithm: sort so back-facing slices render before front-facing
  const sorted = [...slices].sort((a, b) =>
    Math.sin((a.start + a.end) / 2) - Math.sin((b.start + b.end) / 2)
  );

  // Pass 1 — draw outer rim (side faces)
  for (const s of sorted) {
    ctx.beginPath();
    ctx.moveTo(cx + rx * Math.cos(s.start), cy + ry * Math.sin(s.start));
    ctx.ellipse(cx, cy, rx, ry, 0, s.start, s.end);
    ctx.lineTo(cx + rx * Math.cos(s.end), cy + depth + ry * Math.sin(s.end));
    ctx.ellipse(cx, cy + depth, rx, ry, 0, s.end, s.start, true);
    ctx.closePath();
    ctx.fillStyle = darken(s.color);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Pass 2 — draw radial side edges (left/right faces of each slice)
  for (const s of sorted) {
    for (const a of [s.start, s.end]) {
      const x = cx + rx * Math.cos(a);
      const y = cy + ry * Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + depth);
      ctx.lineTo(cx, cy + depth);
      ctx.closePath();
      ctx.fillStyle = darken(s.color, 0.45);
      ctx.fill();
    }
  }

  // Pass 3 — draw top faces
  for (const s of sorted) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, s.start, s.end);
    ctx.closePath();

    // Radial gradient for slight shine
    const midA  = (s.start + s.end) / 2;
    const gx    = cx + rx * 0.35 * Math.cos(midA);
    const gy    = cy + ry * 0.35 * Math.sin(midA);
    const grad  = ctx.createRadialGradient(gx, gy, 0, cx, cy, rx);
    grad.addColorStop(0, lighten(s.color));
    grad.addColorStop(1, s.color);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function lighten(hex, f = 1.35) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8)  & 255) * f));
    const b = Math.min(255, Math.round(( n        & 255) * f));
    return `rgb(${r},${g},${b})`;
  }
}

// ─── TICKET ROW ───────────────────────────────────────────────────────────────
function ticketRow(tk, showDup) {
  const isReq = tk.type === 'requisicao';
  const icon  = isReq ? 'ti-file-invoice' : 'ti-alert-triangle';
  const cls   = isReq ? 'req' : 'inc';

  const sMap = Object.fromEntries(
    Object.entries(STATUS_MAP).map(([k, v]) =>
      [k, `<span class="badge ${v.cls}"><i class="ti ${v.icon}"></i>${t('status.'+k)||v.label}</span>`]
    )
  );
  const pMap = {
    alta:  `<span class="badge b-coral">${t('priority.alta')}</span>`,
    media: `<span class="badge b-amber">${t('priority.media')}</span>`,
    baixa: `<span class="badge b-gray">${t('priority.baixa')}</span>`,
  };

  const typeBadge = isReq
    ? `<span class="badge b-blue">${t('type.requisicao')}</span>`
    : `<span class="badge b-coral">${t('type.incidente')}</span>`;

  let dup = '';
  if (showDup && tk._dup) {
    const dc = tk._dup;
    if (dc.kind === 'warning') {
      dup = `<div class="dup-tag dup-warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i><span>${dc.message}</span></div>`;
    } else {
      dup = `<div class="dup-tag dup-info"><i class="ti ti-info-circle" aria-hidden="true"></i><span>${dc.message}</span></div>`;
    }
  }

  const pClass = tk.type === 'incidente' ? `p-${tk.priority}` : '';
  const id = tk.id.replace(/'/g, '');
  const isUsuario = currentUser?.role === 'usuario';

  return `
  <div class="t-item ${pClass}" id="row-${id}">
    <div class="t-icon ${cls}"><i class="ti ${icon}" aria-hidden="true"></i></div>
    <div class="t-body">
      <div class="t-meta">
        <span class="t-id">${tk.id}</span>
        ${typeBadge} ${sMap[tk.status] || ''}
        ${tk.type === 'incidente' ? pMap[tk.priority] || '' : ''}
      </div>
      <div class="t-cat">${escHtml(tk.category)}${tk.subcategory ? `<span class="t-subcat"> · ${escHtml(tk.subcategory)}</span>` : ''}</div>
      <div class="t-user"><i class="ti ti-user" aria-hidden="true"></i>${escHtml(tk.user_name)}</div>
      <div class="t-desc">${escHtml(tk.description)}</div>
      <div class="t-foot">
        <span class="t-time"><i class="ti ti-clock" aria-hidden="true"></i>${fmtDate(tk.created_at)}</span>
      </div>
      ${dup}
    </div>
    <div class="t-actions">
      ${isUsuario ? `${sMap[tk.status] || ''}` : `
      <button class="view-btn" onclick="openTicket('${id}')" title="${t('btn.view_details')}" aria-label="${t('btn.view_details')}">
        <i class="ti ti-eye" aria-hidden="true"></i> ${t('btn.view')}
      </button>
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

function openTicket(id) {
  currentTicketId = id;
  closeStatusDrawer();
  go('ticket');
}

// ─── STATUS / DELETE ──────────────────────────────────────────────────────────
async function updateStatus(id, status) {
  try {
    await api.patch(`/tickets/${encodeURIComponent(id)}/status`, { status });
    toast(t('toast.status_updated'));
    const stats = await api.get('/stats');
    updateSidebar(stats.overview);
  } catch (err) {
    toast(err.message, 'error');
    render();
  }
}

async function deleteTicket(id) {
  if (!confirm(t('confirm.delete_ticket'))) return;
  try {
    await api.delete(`/tickets/${encodeURIComponent(id)}`);
    const row = document.getElementById(`row-${id}`);
    if (row) row.remove();
    toast(t('toast.ticket_deleted'));
    const stats = await api.get('/stats');
    updateSidebar(stats.overview);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────
async function renderHistory() {
  const typeLabel = {
    requisicao: t('type.requisicao'), incidente: t('type.incidente'), '': t('history.all_types')
  }[histF.type] || t('history.all_types');

  document.getElementById('app').innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('history.title')} — ${typeLabel}</h1>
      <button class="btn btn-primary btn-sm" onclick="go('new')"><i class="ti ti-plus" aria-hidden="true"></i> ${t('btn.new_ticket')}</button>
    </div>
    <div class="filter-bar">
      <input type="search" placeholder="${t('history.search')}" id="fq" value="${escHtml(histF.q)}"
        oninput="histF.q=this.value;histF.page=1;loadHistory()">
      <input type="text" placeholder="${t('history.filter_user')}" id="fu" value="${escHtml(histF.user)}"
        oninput="histF.user=this.value;histF.page=1;loadHistory()" style="max-width:180px">
      <select id="ft" onchange="histF.type=this.value;histF.page=1;loadHistory()">
        <option value="">${t('history.all_types')}</option>
        <option value="requisicao" ${histF.type==='requisicao'?'selected':''}>${t('type.requisicao')}</option>
        <option value="incidente"  ${histF.type==='incidente' ?'selected':''}>${t('type.incidente')}</option>
      </select>
      <select id="fs" onchange="histF.status=this.value;histF.page=1;loadHistory()">
        <option value="">${t('history.all_status')}</option>
        ${STATUS_OPTIONS.map(k =>
          `<option value="${k}" ${histF.status===k?'selected':''}>${t('status.'+k)||STATUS_MAP[k].label}</option>`
        ).join('')}
      </select>
    </div>
    <div class="history-card">
      <div id="h-list"><div class="loader"><div class="spinner"></div> Carregando...</div></div>
    </div>
    <div id="pagination" class="pagination"></div>`;

  await loadHistory();
}

let histDebounce = null;
let sdState      = { status: '', type: '', q: '', assignedTo: '', timer: null };
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

    el.innerHTML = tickets.length
      ? `<div class="t-list">${tickets.map(tk => ticketRow(tk, false)).join('')}</div>`
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
      <h1 class="page-title">${t('mytickets.title')}</h1>
      <button class="btn btn-primary btn-sm" onclick="go('new')">
        <i class="ti ti-plus" aria-hidden="true"></i> ${t('btn.new_ticket')}
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

    body.innerHTML = `<div class="my-tickets-grid">${tickets.map(tk => {
      const s = STATUS_MAP[tk.status] || STATUS_MAP.aberto;
      const typeCls = tk.type === 'requisicao' ? 'b-blue' : 'b-coral';
      const typeLabel = tk.type === 'requisicao' ? t('type.requisicao') : t('type.incidente');
      return `
      <div class="my-ticket-card myt-${tk.status}">
        <div class="myt-head">
          <span class="myt-id">${escHtml(tk.id)}</span>
          <span class="badge ${typeCls}">${typeLabel}</span>
        </div>
        <div>
          <div class="myt-cat">${escHtml(tk.category)}</div>
          ${tk.subcategory ? `<div class="myt-subcat">${escHtml(tk.subcategory)}</div>` : ''}
        </div>
        <div class="myt-desc">${escHtml(tk.description)}</div>
        <div class="myt-foot">
          <span class="badge ${s.cls}"><i class="ti ${s.icon}"></i>${t('status.'+tk.status)||s.label}</span>
          <span class="myt-time"><i class="ti ti-clock"></i>${fmtDate(tk.created_at)}</span>
        </div>
        <div style="margin-top:8px">
          <button class="view-btn" onclick="openTicket('${escHtml(tk.id.replace(/'/g,''))}')" style="width:100%;justify-content:center">
            <i class="ti ti-eye" aria-hidden="true"></i> ${t('btn.view_details')}
          </button>
        </div>
      </div>`;
    }).join('')}</div>`;

  } catch (err) {
    const body = document.getElementById('mytickets-body');
    if (body) body.innerHTML = `<div class="empty"><i class="ti ti-alert-circle" aria-hidden="true"></i><p>Erro ao carregar chamados.</p></div>`;
    toast(err.message, 'error');
  }
}

// ─── TICKET DETAIL ───────────────────────────────────────────────────────────
async function renderTicketDetail(id) {
  const el = document.getElementById('app');
  if (!id) { go('history'); return; }

  el.innerHTML = `
    <div class="page-header">
      <button class="btn btn-sm" onclick="go(currentUser?.role==='usuario'?'mytickets':'history')">
        <i class="ti ti-arrow-left" aria-hidden="true"></i> ${t('td.back')}
      </button>
      <h1 class="page-title" id="td-title">Carregando...</h1>
    </div>
    <div id="td-body"><div class="loader"><div class="spinner"></div> Carregando...</div></div>`;

  try {
    const isEditor = currentUser?.role !== 'usuario';
    const [ticket, technicians] = await Promise.all([
      api.get(`/tickets/${encodeURIComponent(id)}`),
      isEditor ? api.get('/technicians') : Promise.resolve([]),
    ]);

    document.getElementById('td-title').textContent = ticket.id;

    const s    = STATUS_MAP[ticket.status] || STATUS_MAP.aberto;
    const isReq = ticket.type === 'requisicao';
    const pBadge = { alta: 'b-coral', media: 'b-amber', baixa: 'b-gray' };
    const pLabel = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

    const proceduresHtml = (ticket.procedures || []).length
      ? [...ticket.procedures].reverse().map(p => `
          <div class="proc-item">
            <div class="proc-meta">
              <span class="proc-tech"><i class="ti ti-user-check"></i>${escHtml(p.technician_name)}</span>
              <span class="proc-time"><i class="ti ti-clock"></i>${fmtDate(p.created_at)}</span>
            </div>
            <div class="proc-text">${escHtml(p.text)}</div>
          </div>`).join('')
      : `<div class="empty" style="padding:20px"><i class="ti ti-notes-off" aria-hidden="true"></i><p>${t('td.no_procedures')}</p></div>`;

    const safeId = escHtml(id.replace(/'/g, ''));
    const editorHtml = isEditor ? `
      <div class="td-form-card">
        <div class="td-form-title"><i class="ti ti-edit" aria-hidden="true"></i> ${t('td.update')}</div>
        <div class="form-group">
          <label class="form-label">${t('td.status')}</label>
          <select class="form-select" id="td-status">
            ${STATUS_OPTIONS.map(k =>
              `<option value="${k}" ${ticket.status===k?'selected':''}>${t('status.'+k)||STATUS_MAP[k].label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('td.assign')}</label>
          <select class="form-select" id="td-assign">
            <option value="">${t('td.keep_current')}</option>
            ${technicians.map(tech =>
              `<option value="${tech.id}" ${ticket.assigned_to===tech.id?'selected':''}>${escHtml(tech.name)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">${t('td.add_procedure')}</label>
          <textarea class="form-textarea" id="td-procedure" rows="4"
            placeholder="${t('td.procedure_ph')}"></textarea>
        </div>
        <div class="form-actions" style="justify-content:flex-end">
          <button class="btn btn-primary" onclick="saveTicketDetail('${safeId}')">
            <i class="ti ti-device-floppy" aria-hidden="true"></i> ${t('td.save')}
          </button>
        </div>
      </div>` : '';

    document.getElementById('td-body').innerHTML = `
      <div class="ticket-detail-layout">
        <div class="ticket-detail-main">
          <div class="td-info-card">
            <div class="td-info-row">
              <span class="td-info-label">${t('td.status')}</span>
              <span class="badge ${s.cls}"><i class="ti ${s.icon}"></i>${s.label}</span>
            </div>
            <div class="td-info-row">
              <span class="td-info-label">${t('td.type')}</span>
              <span class="badge ${isReq?'b-blue':'b-coral'}">${isReq?t('type.requisicao'):t('type.incidente')}</span>
            </div>
            ${ticket.type==='incidente' ? `
            <div class="td-info-row">
              <span class="td-info-label">${t('td.priority')}</span>
              <span class="badge ${pBadge[ticket.priority]||'b-gray'}">${t('priority.'+ticket.priority)||pLabel[ticket.priority]||ticket.priority}</span>
            </div>` : ''}
            <div class="td-info-row">
              <span class="td-info-label">${t('td.requester')}</span>
              <span>${escHtml(ticket.user_name)}</span>
            </div>
            <div class="td-info-row">
              <span class="td-info-label">${t('td.category')}</span>
              <span>${escHtml(ticket.category)}${ticket.subcategory?` · ${escHtml(ticket.subcategory)}`:''}</span>
            </div>
            <div class="td-info-row">
              <span class="td-info-label">${t('td.technician')}</span>
              <span>${ticket.assigned_to_name ? escHtml(ticket.assigned_to_name) : `<em style="color:var(--text-3)">${t('td.unassigned')}</em>`}</span>
            </div>
            <div class="td-info-row">
              <span class="td-info-label">${t('td.opened_at')}</span>
              <span>${fmtDate(ticket.created_at)}</span>
            </div>
            <div class="td-info-row">
              <span class="td-info-label">${t('td.updated_at')}</span>
              <span>${fmtDate(ticket.updated_at)}</span>
            </div>
            <div class="td-info-row td-desc-row">
              <span class="td-info-label">${t('td.description')}</span>
              <p class="td-desc-text">${escHtml(ticket.description)}</p>
            </div>
          </div>

          <div class="td-procedures-card">
            <div class="td-section-title"><i class="ti ti-notes" aria-hidden="true"></i> ${t('td.procedures')}</div>
            <div id="td-procedures">${proceduresHtml}</div>
          </div>
        </div>

        <div class="ticket-detail-side">
          ${editorHtml}
        </div>
      </div>`;

  } catch (err) {
    document.getElementById('td-body').innerHTML =
      `<div class="empty"><i class="ti ti-alert-circle"></i><p>${escHtml(err.message)}</p></div>`;
    toast(err.message, 'error');
  }
}

async function saveTicketDetail(id) {
  const statusEl = document.getElementById('td-status');
  const assignEl = document.getElementById('td-assign');
  const procEl   = document.getElementById('td-procedure');
  if (!statusEl) return;

  const payload = { status: statusEl.value };
  if (assignEl?.value)              payload.assigned_to = assignEl.value;
  const proc = procEl?.value?.trim();
  if (proc)                         payload.procedure   = proc;

  try {
    await api.patch(`/tickets/${encodeURIComponent(id)}`, payload);
    toast(t('toast.ticket_updated'));
    const [, stats] = await Promise.all([
      renderTicketDetail(id),
      api.get('/stats'),
    ]);
    updateSidebar(stats.overview);
  } catch (err) {
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
      <div class="page-header"><h1 class="page-title">${t('ticket.new')}</h1></div>
      <div class="form-card">
        <div style="margin-bottom:18px">
          <div class="form-label">${t('ticket.type')}</div>
          <div class="type-grid">
            <button class="type-opt ${formState.type==='requisicao'?'sel-req':''}" onclick="setType('requisicao')">
              <i class="ti ti-file-invoice type-icon" aria-hidden="true"></i>
              <span class="type-name">${t('ticket.req_title')}</span>
              <span class="type-desc">${t('ticket.req_desc')}</span>
            </button>
            <button class="type-opt ${formState.type==='incidente'?'sel-inc':''}" onclick="setType('incidente')">
              <i class="ti ti-alert-triangle type-icon" aria-hidden="true"></i>
              <span class="type-name">${t('ticket.inc_title')}</span>
              <span class="type-desc">${t('ticket.inc_desc')}</span>
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="fn">${t('ticket.requester')} *</label>
            <input class="form-input" id="fn" type="text" placeholder="${t('ticket.requester')}" ${nameValue} ${nameReadonly} oninput="scheduleDupCheck()">
          </div>
          ${formState.type === 'incidente' ? `
          <div class="form-group">
            <label class="form-label" for="fp">${t('ticket.priority')}</label>
            <select class="form-select" id="fp">
              <option value="baixa">${t('priority.baixa')}</option>
              <option value="media" selected>${t('priority.media')}</option>
              <option value="alta">${t('priority.alta')}</option>
            </select>
          </div>` : '<div></div>'}
        </div>

        <div class="form-group">
          <label class="form-label" for="fc">${t('ticket.category')} *</label>
          <select class="form-select" id="fc" onchange="onCatChange()">
            <option value="">${t('ticket.select_cat')}</option>
            ${catList.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('')}
          </select>
        </div>

        <div id="software-picker-area"></div>

        <div id="dup-area"></div>

        <div class="form-group">
          <label class="form-label" for="fd">${t('ticket.description')} *</label>
          <textarea class="form-textarea" id="fd" placeholder="${formState.type === 'requisicao'
            ? t('ticket.req_ph') : t('ticket.inc_ph')}"></textarea>
        </div>

        <div class="form-actions">
          <button class="btn" onclick="go(currentUser?.role === 'usuario' ? 'mytickets' : 'dashboard')">
            <i class="ti ti-x" aria-hidden="true"></i> ${t('ticket.cancel')}
          </button>
          <button class="btn btn-primary" id="submit-btn" onclick="submitTicket()">
            <i class="ti ti-send" aria-hidden="true"></i> ${t('ticket.submit')}
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
  const area = document.getElementById('dup-area');
  if (area) area.innerHTML = '';
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
  if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:14px;height:14px"></div> ${t('ticket.submitting')}`; }

  try {
    await api.post('/tickets', {
      type: formState.type, category, subcategory, user_name, description, priority,
    });
    toast(t('toast.ticket_created'));
    histF = { q: '', user: '', type: '', status: '', page: 1 };
    go(currentUser?.role === 'usuario' ? 'mytickets' : 'history');
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="ti ti-send" aria-hidden="true"></i> ${t('ticket.submit')}`; }
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
    errBox.textContent   = t('auth.fill_fields');
    errBox.style.display = 'flex';
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = `<div class="spinner" style="width:14px;height:14px"></div> ${t('auth.logging_in')}`;

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
    applyTranslations();

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
    btn.innerHTML = `<i class="ti ti-login" aria-hidden="true"></i> <span data-i18n="auth.login">${t('auth.login')}</span>`;
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
  const cls = { admin: 'b-coral', tecnico: 'b-amber', usuario: 'b-gray' }[role] || 'b-gray';
  return `<span class="badge ${cls}">${t('role.'+role) || escHtml(role)}</span>`;
}

async function renderUsers() {
  const el = document.getElementById('app');
  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('users.title')}</h1>
      <button class="btn btn-primary btn-sm" onclick="openUserModal()">
        <i class="ti ti-user-plus" aria-hidden="true"></i> ${t('users.new')}
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
              <th>${t('users.name')}</th>
              <th>${t('users.username')}</th>
              <th>${t('users.email')}</th>
              <th>${t('users.role')}</th>
              <th>${t('users.created_at')}</th>
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
      toast(t('toast.user_updated'));
    } else {
      await api.post('/users', { name, username, email, password, role });
      closeUserModal();
      toast(t('toast.user_created'));
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
  if (!confirm(t('confirm.delete_user'))) return;
  try {
    await api.delete(`/users/${encodeURIComponent(id)}`);
    toast(t('toast.user_deleted'));
    loadUsers();
  } catch (err) {
    toast(err.message || 'Erro ao excluir.', 'error');
  }
}

// ─── CHANGE OWN PASSWORD ─────────────────────────────────────────────────────
function openChangePasswordModal() {
  document.getElementById('chgpwd-current').value  = '';
  document.getElementById('chgpwd-new').value      = '';
  document.getElementById('chgpwd-confirm').value  = '';
  document.getElementById('chgpwd-errors').innerHTML = '';
  document.getElementById('chgpwd-modal').style.display = 'flex';
  document.getElementById('chgpwd-current').focus();
}

function closeChangePasswordModal() {
  document.getElementById('chgpwd-modal').style.display = 'none';
}

async function submitChangeOwnPassword() {
  const btn        = document.getElementById('btn-chgpwd-submit');
  const errBox     = document.getElementById('chgpwd-errors');
  const current    = document.getElementById('chgpwd-current').value;
  const newPwd     = document.getElementById('chgpwd-new').value;
  const confirmPwd = document.getElementById('chgpwd-confirm').value;

  errBox.innerHTML = '';
  if (!newPwd || newPwd.length < 6) {
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>${t('pwd.min_length')}</div></div>`;
    return;
  }
  if (newPwd !== confirmPwd) {
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>${t('pwd.no_match')}</div></div>`;
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = `<div class="spinner" style="width:13px;height:13px"></div> ${t('loading')}`;

  try {
    await api.post('/auth/change-own-password', { currentPassword: current, newPassword: newPwd });
    closeChangePasswordModal();
    toast(t('toast.password_changed'));
  } catch (err) {
    const msg = err.message?.includes('incorreta') ? t('pwd.wrong') : err.message;
    errBox.innerHTML = `<div class="alert-box a-danger"><i class="ti ti-alert-circle"></i><div>${msg}</div></div>`;
  } finally {
    btn.disabled  = false;
    btn.innerHTML = `<i class="ti ti-lock" aria-hidden="true"></i> <span data-i18n="pwd.save">${t('pwd.save')}</span>`;
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
  applyTranslations();

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

// Language toggle
document.getElementById('btn-lang-toggle').addEventListener('click', toggleLang);
document.getElementById('login-lang-btn').addEventListener('click', toggleLang);

// Change own password modal
document.getElementById('btn-change-password').addEventListener('click', openChangePasswordModal);
document.getElementById('btn-chgpwd-close').addEventListener('click', closeChangePasswordModal);
document.getElementById('btn-chgpwd-cancel').addEventListener('click', closeChangePasswordModal);
document.getElementById('btn-chgpwd-submit').addEventListener('click', submitChangeOwnPassword);
document.getElementById('chgpwd-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeChangePasswordModal(); });
document.getElementById('chgpwd-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') submitChangeOwnPassword(); });
['chgpwd-eye-cur','chgpwd-eye-new','chgpwd-eye-confirm'].forEach(id => {
  const inputId = { 'chgpwd-eye-cur': 'chgpwd-current', 'chgpwd-eye-new': 'chgpwd-new', 'chgpwd-eye-confirm': 'chgpwd-confirm' }[id];
  document.getElementById(id).addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    const btn = document.getElementById(id);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = `<i class="ti ti-eye${show ? '-off' : ''}" aria-hidden="true"></i>`;
  });
});

// ─── STATUS DRAWER ───────────────────────────────────────────────────────────
async function openStatusDrawer(status, type) {
  sdState.status     = status;
  sdState.type       = type;
  sdState.q          = '';
  sdState.assignedTo = '';
  clearTimeout(sdState.timer);

  const searchEl = document.getElementById('sd-search');
  const typeEl   = document.getElementById('sd-type-filter');
  const techEl   = document.getElementById('sd-tech-filter');
  if (searchEl) { searchEl.value = ''; }
  if (typeEl)   { typeEl.value = type; typeEl.disabled = !!type; }
  if (techEl)   { techEl.value = ''; }

  // Populate technician list (only for admin/tecnico)
  if (techEl && currentUser?.role !== 'usuario') {
    try {
      const techs = await api.get('/technicians');
      techEl.innerHTML = `<option value="">Todos os técnicos</option>`
        + techs.map(tc => `<option value="${tc.id}">${escHtml(tc.name)}</option>`).join('');
    } catch (_) {
      techEl.innerHTML = `<option value="">Todos os técnicos</option>`;
    }
    techEl.style.display = '';
  } else if (techEl) {
    techEl.style.display = 'none';
  }

  const iconEl  = document.getElementById('sd-icon');
  const titleEl = document.getElementById('sd-title');
  const badgeEl = document.getElementById('sd-badge');
  if (badgeEl) badgeEl.textContent = '';

  if (status) {
    const sm = STATUS_MAP[status];
    if (iconEl)  iconEl.innerHTML  = `<span class="badge ${sm.cls}" style="font-size:13px"><i class="ti ${sm.icon}"></i></span>`;
    if (titleEl) titleEl.textContent = t('status.' + status) || sm.label;
  } else if (type) {
    const isReq = type === 'requisicao';
    if (iconEl)  iconEl.innerHTML  = `<span class="badge ${isReq ? 'b-blue' : 'b-coral'}" style="font-size:13px"><i class="ti ${isReq ? 'ti-file-invoice' : 'ti-alert-triangle'}"></i></span>`;
    if (titleEl) titleEl.textContent = t('type.' + type);
  } else {
    if (iconEl)  iconEl.innerHTML  = `<span class="badge b-gray" style="font-size:13px"><i class="ti ti-ticket"></i></span>`;
    if (titleEl) titleEl.textContent = t('dash.total');
  }

  document.getElementById('sd-overlay').style.display = 'flex';
  loadStatusDrawer();
}

function closeStatusDrawer() {
  document.getElementById('sd-overlay').style.display = 'none';
}

async function loadStatusDrawer() {
  const body    = document.getElementById('sd-body');
  const badgeEl = document.getElementById('sd-badge');
  if (!body) return;
  body.innerHTML = `<div class="loader"><div class="spinner"></div></div>`;

  const params = new URLSearchParams({ limit: 100 });
  if (sdState.status)     params.set('status', sdState.status);
  if (sdState.type)       params.set('type', sdState.type);
  if (sdState.q)          params.set('q', sdState.q);
  if (sdState.assignedTo) params.set('assigned_to', sdState.assignedTo);

  try {
    const data    = await api.get(`/tickets?${params}`);
    const tickets = data.tickets;
    const total   = data.pagination?.total ?? tickets.length;
    if (badgeEl) badgeEl.textContent = total;
    body.innerHTML = tickets.length
      ? `<div class="t-list">${tickets.map(tk => ticketRow(tk, false)).join('')}</div>`
      : `<div class="empty"><i class="ti ti-inbox" aria-hidden="true"></i><p>${t('empty.no_tickets')}</p></div>`;
  } catch (err) {
    body.innerHTML = `<div class="empty"><i class="ti ti-alert-circle" aria-hidden="true"></i><p>Erro ao carregar chamados.</p></div>`;
  }
}

document.getElementById('btn-sd-close').addEventListener('click', closeStatusDrawer);
document.getElementById('sd-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeStatusDrawer(); });
document.getElementById('sd-search').addEventListener('input', e => {
  sdState.q = e.target.value.trim();
  clearTimeout(sdState.timer);
  sdState.timer = setTimeout(loadStatusDrawer, 400);
});
document.getElementById('sd-type-filter').addEventListener('change', e => {
  if (!document.getElementById('sd-type-filter').disabled) {
    sdState.type = e.target.value;
    loadStatusDrawer();
  }
});
document.getElementById('sd-tech-filter').addEventListener('change', e => {
  sdState.assignedTo = e.target.value;
  loadStatusDrawer();
});

// Apply translations on first load (before login)
applyTranslations();

init();
