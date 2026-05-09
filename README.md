# Central de Chamados TI

Sistema web de gerenciamento de chamados de suporte técnico. Permite que usuários abram requisições e incidentes, técnicos acompanhem o andamento e administradores gerenciem toda a operação e os usuários da plataforma.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Tecnologias](#tecnologias)
- [Instalação e Execução](#instalação-e-execução)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Conta Padrão](#conta-padrão)
- [Perfis de Acesso](#perfis-de-acesso)
- [Funcionalidades](#funcionalidades)
- [SLA — Nível de Serviço](#sla--nível-de-serviço)
- [Categorias de Chamados](#categorias-de-chamados)
- [Arquitetura](#arquitetura)
- [API — Rotas](#api--rotas)
- [Banco de Dados](#banco-de-dados)
- [Segurança](#segurança)
- [Deploy](#deploy)

---

## Visão Geral

A aplicação é um **SPA (Single Page Application)** servida por um servidor Express. O frontend é construído em JavaScript puro (sem frameworks) e se comunica com o backend via API REST autenticada por token. Os dados são persistidos em um arquivo local gerenciado pelo LokiJS.

```
Navegador ──── HTTP/JSON ────► Express (server.js)
                                    │
                               LokiJS (arquivo .db)
```

---

## Tecnologias

| Camada | Tecnologia |
|--------|-----------|
| Servidor | Node.js ≥ 18, Express 4 |
| Banco de dados | LokiJS 1.5 (JSON em disco) |
| Segurança | Helmet, express-rate-limit, `crypto.scryptSync` |
| Frontend | HTML5, CSS3, JavaScript (ES2022+) |
| Ícones | Tabler Icons (CDN) |
| Gráficos | Chart.js 4 (CDN) + Canvas 2D API |
| Dev | nodemon |

---

## Instalação e Execução

### Pré-requisitos

- Node.js **18 ou superior**
- npm

### Passos

```bash
# 1. Clonar o repositório
git clone <url-do-repositorio>
cd chamados-ti

# 2. Instalar dependências
npm install
# ou via Makefile
make install

# 3. (Opcional) Popular banco com dados de exemplo
node scripts/seed.js

# 4. Iniciar o servidor
npm start          # produção
npm run dev        # desenvolvimento com hot-reload
make dev           # via Makefile (usa DB separado: data/dev-chamados.db)
```

O servidor ficará disponível em **http://localhost:3000**.

Na primeira execução, a conta de administrador padrão é criada automaticamente (veja [Conta Padrão](#conta-padrão)).

---

## Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto (opcional — todos têm valores padrão):

```env
PORT=3000
DB_PATH=./data/chamados.db
ALLOWED_ORIGIN=http://localhost:3000
```

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta HTTP do servidor |
| `DB_PATH` | `./data/chamados.db` | Caminho do arquivo do banco de dados |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | Origem permitida pelo CORS |

---

## Conta Padrão

Ao iniciar pela primeira vez, o sistema cria automaticamente uma conta de administrador:

| Campo | Valor |
|-------|-------|
| Usuário | `admin` |
| Senha | `admin123` |

> **Recomendação:** Altere a senha da conta admin imediatamente após o primeiro acesso em produção.

---

## Perfis de Acesso

O sistema possui quatro perfis de usuário com permissões distintas:

### Administrador (`admin`)
- Acesso completo a todas as funcionalidades
- Visualiza e gerencia **todos** os chamados
- Gerencia usuários: criar, editar, excluir e resetar senhas
- Acessa o dashboard completo com métricas, gráficos e SLA
- Altera o status de qualquer chamado
- Promove ou rebaixa perfis de outros usuários
- Altera a própria senha pelo menu lateral

### Gerência (`gerencia`)
- **Mesmas permissões do Administrador**
- Acesso completo ao dashboard, histórico, usuários e todas as operações
- Destinado a gestores que precisam de visibilidade total sem acesso técnico de sistema
- Altera a própria senha pelo menu lateral

### Técnico (`tecnico`)
- Visualiza e gerencia **todos** os chamados
- Acessa o dashboard, histórico, requisições e incidentes
- Entra no detalhe de cada chamado para registrar procedimentos técnicos, alterar status e reatribuir para outro técnico
- Dashboard exibe apenas os chamados **atribuídos ao próprio técnico** na seção inferior
- **Não** acessa o menu de gerenciamento de usuários
- Altera a própria senha pelo menu lateral

### Usuário Comum (`usuario`)
- Visualiza **somente seus próprios chamados** em formato de cards
- Abre novos chamados (nome preenchido automaticamente)
- Filtra seus chamados por Requisições ou Incidentes
- **Não** altera status de chamados
- **Não** acessa o histórico geral nem o painel de usuários
- Altera a própria senha pelo menu lateral

---

## Funcionalidades

### Tela de Login

> **Screenshot:** `docs/screenshots/login.png`

![Tela de Login](docs/screenshots/login.png)

- Autenticação com usuário e senha
- Seletor de idioma (PT / EN) disponível antes do login
- Sessão por token aleatório (32 bytes hex) com TTL de **8 horas**
- Token armazenado no `localStorage` e enviado como `Authorization: Bearer <token>`
- Sessões expiradas são limpas automaticamente a cada hora no servidor
- Logout invalida o token imediatamente no servidor

---

### Dashboard (admin / gerência / técnico)

> **Screenshot:** `docs/screenshots/dashboard.png`

![Dashboard](docs/screenshots/dashboard.png)

#### Cards de métricas (clicáveis)

Cada card exibe um contador e, ao ser clicado, abre o **Drawer de Chamados** filtrado pelo status ou tipo correspondente:

| Card | Filtro aplicado |
|------|----------------|
| Total de chamados | Todos |
| Abertos | `status = aberto` |
| Em análise | `status = em_analise` |
| Pendente | `status = pendente` |
| Pend. Terceiros | `status = pendente_terceiros` |
| Fechados | `status = fechado` |
| Requisições | `type = requisicao` |
| Incidentes | `type = incidente` |

#### Gráficos de categoria

Gráficos de barras (Chart.js) mostrando a distribuição de Requisições e Incidentes por categoria.

#### Gráfico SLA e Gráfico de técnicos

Exibidos lado a lado na mesma linha — detalhados nas seções abaixo.

#### Seção inferior

- **Admin / Gerência:** lista dos 5 chamados mais recentes com botão "Ver todos" → histórico
- **Técnico:** lista completa dos chamados atribuídos ao técnico logado com botão "Ver todos" → drawer geral

---

### Drawer de Chamados (por status / tipo)

> **Screenshot:** `docs/screenshots/drawer-status.png`

![Drawer de Chamados](docs/screenshots/drawer-status.png)

Painel lateral deslizante acionado pelo clique nos cards de métricas do dashboard:

- **Título e ícone** refletem o filtro aplicado (status ou tipo)
- **Contador** mostra o total de chamados encontrados
- **Busca por texto** — filtra em tempo real (debounce 400 ms) por ID, categoria, descrição ou usuário
- **Filtro por tipo** — Todos / Requisição / Incidente (bloqueado quando o card de tipo foi o acionador)
- **Filtro por técnico** — seletor dinâmico carregado via API; visível apenas para admin, gerência e técnico
- Lista de chamados com botões de ação (Ver detalhes / Excluir) para admin, gerência e técnico
- Clicar em "Ver detalhes" fecha o drawer e navega para a tela de detalhe do chamado
- Fechar com o botão ✕ ou clicando no backdrop

---

### Gráfico SLA — Nível de Serviço

> **Screenshot:** `docs/screenshots/sla-chart.png`

![Gráfico SLA](docs/screenshots/sla-chart.png)

Exibido no dashboard ao lado do gráfico de técnicos. Monitora em tempo real a conformidade com as metas de SLA definidas abaixo.

#### Metas de SLA (padrão ITIL enterprise)

| Tipo | Prioridade | Tempo máximo de resolução |
|------|-----------|--------------------------|
| Incidente | Alta (P1) | **4 horas** |
| Incidente | Média (P2) | **8 horas** |
| Incidente | Baixa (P3) | **24 horas** |
| Requisição | — | **72 horas** (3 dias úteis) |

#### Categorias de SLA

| Categoria | Critério |
|-----------|---------|
| **Dentro do SLA** | Tempo decorrido < 80% da meta |
| **Em risco** | Tempo decorrido entre 80% e 100% da meta |
| **Violado** | Tempo decorrido > 100% da meta |
| **Pausado** | Chamado em status *Pendente* ou *Pend. Terceiros* (relógio suspenso) |

O percentual de conformidade é exibido no centro do gráfico doughnut e no badge do card, com cor dinâmica:
- **Verde** — ≥ 90%
- **Âmbar** — ≥ 70%
- **Vermelho** — < 70%

> O relógio do SLA é **pausado** automaticamente nos status `Pendente` e `Pendente de Terceiros`, seguindo a prática ITIL de não penalizar o tempo em que a equipe aguarda resposta externa. Chamados *Fechados* são excluídos da contagem ativa.

---

### Gráfico 3D de Chamados por Técnico

> **Screenshot:** `docs/screenshots/tech-chart.png`

![Gráfico por Técnico](docs/screenshots/tech-chart.png)

Gráfico de pizza 3D renderizado via Canvas 2D API (sem biblioteca externa):

- Cada fatia representa um técnico e sua quantidade de chamados atribuídos
- Tickets sem técnico atribuído aparecem como "Não atribuído"
- Legenda lateral com nome, contagem e percentual de cada técnico
- Efeito 3D gerado por algoritmo do pintor: faces laterais escurecidas + gradiente radial nas faces superiores

---

### Chamados

#### Tipos
| Tipo | Uso |
|------|-----|
| **Requisição** | Solicitações de acesso, equipamentos, licenças etc. |
| **Incidente** | Problemas, falhas e interrupções de serviço |

#### Status
| Status | Descrição |
|--------|-----------|
| `Aberto` | Recém-criado, aguardando atendimento |
| `Em análise` | Em tratamento pela equipe de TI |
| `Pendente` | Aguardando ação ou retorno do solicitante |
| `Pendente de Terceiros` | Aguardando fornecedor ou equipe externa |
| `Fechado` | Resolvido |

#### Atribuição automática
Ao criar um chamado, o sistema atribui automaticamente um técnico cadastrado de forma aleatória. A atribuição pode ser alterada pelo técnico ou administrador na tela de detalhe.

#### Prioridade (somente Incidentes)
`Alta` · `Média` · `Baixa` — indicadas por borda colorida na lista e usadas para calcular a meta de SLA.

---

### Detalhe do Chamado (admin / gerência / técnico)

> **Screenshot:** `docs/screenshots/ticket-detail.png`

![Detalhe do Chamado](docs/screenshots/ticket-detail.png)

Acessado pelo botão "Ver detalhes" na lista do histórico ou no drawer de chamados:

- Informações completas: status, tipo, prioridade, solicitante, categoria, técnico atribuído, datas de abertura e atualização
- **Log de procedimentos técnicos:** histórico cronológico de anotações (técnico responsável + data/hora)
- **Formulário de atualização:** alterar status, reatribuir para outro técnico e registrar novo procedimento em uma única ação

---

### Meus Chamados (usuário comum)

> **Screenshot:** `docs/screenshots/my-tickets.png`

![Meus Chamados](docs/screenshots/my-tickets.png)

- Grade de cards com todos os chamados do usuário logado
- Borda colorida por status: azul (aberto), âmbar (em análise / pendente), roxo (pendente de terceiros), verde (fechado)
- Botão "Novo chamado" com nome do usuário preenchido automaticamente e bloqueado
- Botão "Ver detalhes" em cada card para acompanhar o andamento

---

### Alterar Senha (todos os perfis)

Qualquer usuário autenticado pode alterar sua própria senha pelo ícone de cadeado no rodapé da barra lateral:

```
Usuário clica no ícone de cadeado
    │
    ▼
Modal solicita: senha atual, nova senha, confirmação
    │
    ▼
Servidor verifica a senha atual via scryptSync
Salva nova senha com novo hash + salt
    │
    ▼
Modal fecha com confirmação de sucesso
```

> Diferente do reset de senha feito pelo admin, este fluxo **exige a senha atual** e não requer intervenção de administrador.

---

### Seletor de Idioma

A interface suporta **Português (PT)** e **Inglês (EN)**. O botão de alternância fica visível:
- Na **tela de login**, antes da autenticação
- Na **barra superior** do app, após o login

A preferência é salva no `localStorage` e mantida entre sessões.

---

### Gerenciamento de Usuários (admin / gerência)

> **Screenshot:** `docs/screenshots/users.png`

![Gerenciamento de Usuários](docs/screenshots/users.png)

| Ação | Detalhe |
|------|---------|
| **Criar** | Nome, e-mail, usuário, senha e perfil (usuário / técnico / gerência / admin) |
| **Editar** | Nome, e-mail, usuário e perfil (senha não incluída) |
| **Excluir** | Remove permanentemente |
| **Reset de Senha** | Gera senha provisória aleatória e força redefinição no próximo login |

#### Fluxo de Reset de Senha

```
Admin / Gerência clica "Reset de Senha"
    │
    ▼
Servidor gera senha provisória (ex: AbCd-1xY2)
Salva como senha do usuário + marca password_reset = true
    │
    ▼
Modal exibe a senha provisória com botão "Copiar"
Responsável compartilha a senha com o usuário
    │
    ▼
Usuário faz login com a senha provisória
Servidor detecta password_reset = true → requiresPasswordChange: true
    │
    ▼
Modal "Redefinir senha" aparece (não pode ser fechado)
Usuário define nova senha permanente
Servidor salva nova senha + limpa a flag
```

---

## SLA — Nível de Serviço

O sistema calcula automaticamente o status de SLA de cada chamado aberto com base nas metas abaixo, seguindo as práticas ITIL adotadas por grandes empresas (ServiceNow, JIRA Service Management, Zendesk):

| Tipo | Prioridade | Meta de resolução |
|------|-----------|------------------|
| Incidente | Alta (P1) | 4 horas |
| Incidente | Média (P2) | 8 horas |
| Incidente | Baixa (P3) | 24 horas |
| Requisição | Qualquer | 72 horas |

**Regras de contagem:**
- O relógio inicia em `created_at`
- O relógio é **pausado** enquanto o status for `pendente` ou `pendente_terceiros`
- Chamados `fechados` não entram na contagem ativa de SLA
- Chamados entre 80–100% do tempo consumido são marcados como **Em risco**
- Chamados acima de 100% são marcados como **Violados**

---

## Categorias de Chamados

### Requisições

| Categoria | Subcategorias |
|-----------|--------------|
| **Acesso a Software** | ChatGPT, Protheus, Figma Design, Databricks, TailScale, Lovable, Claude AI, Claude Code, AWS, CMS, Shortcut, Paytrack, Amplitude, Gmail |
| Acesso a Sistema/Serviço | — |
| Equipamento de TI | — |
| Licença de Software | — |
| Acesso VPN | — |
| Criação de E-mail | — |
| Permissão de Rede/Pasta | — |
| Outros | — |

### Incidentes

- Sistema/Aplicação Fora do Ar
- Problema com Internet/Rede
- Hardware Defeituoso
- Impressora com Problema
- Computador Lento
- E-mail com Problema
- Segurança/Vírus
- Outros

---

## Arquitetura

### Estrutura de Arquivos

```
chamados-ti/
├── server.js              # Servidor Express — API REST + servir SPA
├── package.json
├── Makefile               # Comandos de dev e deploy
├── .env                   # Variáveis de ambiente (não versionado)
│
├── data/
│   └── chamados.db        # Banco de dados LokiJS (gerado em runtime)
│
├── docs/
│   └── screenshots/       # Capturas de tela para documentação
│
├── public/                # Frontend estático
│   ├── index.html         # Shell da SPA + todos os modais
│   ├── css/
│   │   └── style.css      # Estilos globais
│   └── js/
│       └── app.js         # Lógica do SPA (roteamento, views, API client)
│
└── scripts/
    ├── seed.js            # Popula banco com chamados de exemplo
    ├── deploy.sh          # Script de deploy (staging / produção)
    ├── rollback.sh        # Script de rollback
    ├── health-check.sh    # Verifica saúde da aplicação
    ├── promote.sh         # Promove staging para produção
    ├── status.sh          # Exibe status dos ambientes
    └── provision-vm.sh    # Provisiona a VM (primeira vez)
```

### Frontend — Roteamento

A navegação é gerida pela função `go(view)` sem recarregar a página:

| View | Acesso | Descrição |
|------|--------|-----------|
| `dashboard` | admin, gerência, técnico | Métricas, gráficos, SLA e lista de chamados |
| `mytickets` | usuário | Cards dos próprios chamados |
| `new` | todos | Formulário de novo chamado |
| `history` | admin, gerência, técnico | Histórico com filtros e paginação |
| `ticket` | admin, gerência, técnico | Detalhe do chamado com procedimentos |
| `users` | admin, gerência | Gerenciamento de usuários |

**Regras de redirecionamento automático em `go()`:**
- `usuario` → redireciona `dashboard`, `history` e `users` para `mytickets`
- `tecnico` → redireciona `users` para `dashboard`
- `admin` / `gerencia` → sem restrições

---

## API — Rotas

### Autenticação (públicas)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/auth/login` | Autentica e retorna token |
| `POST` | `/api/auth/logout` | Invalida o token da sessão |
| `GET` | `/api/auth/me` | Retorna dados da sessão atual |
| `POST` | `/api/auth/change-password` | Define nova senha (fluxo de reset forçado pelo admin) |
| `POST` | `/api/auth/change-own-password` | Altera a própria senha (requer senha atual) |

### Chamados (requerem autenticação)

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| `GET` | `/api/tickets` | todos | Lista chamados (filtrado por `created_by` para perfil `usuario`) |
| `GET` | `/api/tickets/:id` | todos | Busca chamado por ID |
| `POST` | `/api/tickets` | todos | Cria novo chamado (atribui técnico automaticamente) |
| `PATCH` | `/api/tickets/:id` | admin, gerência, técnico | Atualiza status, técnico atribuído e/ou registra procedimento |
| `PATCH` | `/api/tickets/:id/status` | admin, gerência, técnico | Atualiza somente o status |
| `DELETE` | `/api/tickets/:id` | admin, gerência, técnico | Exclui chamado |

### Estatísticas e Categorias

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/stats` | Totais gerais, por categoria, por técnico e dados de SLA |
| `GET` | `/api/categories` | Lista de categorias por tipo |
| `GET` | `/api/technicians` | Lista de usuários com perfil técnico |

### Usuários (requerem autenticação)

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| `GET` | `/api/users` | admin, gerência | Lista todos os usuários |
| `POST` | `/api/users` | admin, gerência | Cria novo usuário |
| `PATCH` | `/api/users/:id` | admin, gerência | Edita dados do usuário |
| `DELETE` | `/api/users/:id` | admin, gerência | Exclui usuário |
| `POST` | `/api/users/:id/reset-password` | admin, gerência | Gera senha provisória e força redefinição |

### Parâmetros de filtro — `GET /api/tickets`

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `type` | `requisicao` \| `incidente` | Filtra por tipo |
| `status` | `aberto` \| `em_analise` \| `pendente` \| `pendente_terceiros` \| `fechado` | Filtra por status |
| `assigned_to` | string (UUID) | Filtra por técnico atribuído |
| `user` | string | Filtra por nome do usuário (busca parcial) |
| `q` | string | Busca em categoria, descrição, ID e usuário |
| `page` | number | Página (padrão: 1) |
| `limit` | number | Itens por página (padrão: 50, máximo: 100) |

### Resposta de `GET /api/stats`

```json
{
  "overview":      { "total": 0, "abertos": 0, "em_analise": 0, "pendente": 0, "pendente_terceiros": 0, "fechados": 0, "requisicoes": 0, "incidentes": 0 },
  "byCategory":    { "requisicao": [...], "incidente": [...] },
  "byTechnician":  [ { "name": "Técnico", "total": 0 } ],
  "sla":           { "dentro": 0, "risco": 0, "violado": 0, "pausado": 0, "active": 0, "compliance": 100 }
}
```

---

## Banco de Dados

O LokiJS persiste os dados em um arquivo JSON binário (`.db`). Dois collections são criados automaticamente na primeira execução.

Na inicialização, o servidor executa uma migração automática que renomeia registros com status `em_andamento` (legado) para `em_analise`.

### Collection `tickets`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador no formato `TI0001-AB12` |
| `type` | string | `requisicao` ou `incidente` |
| `category` | string | Categoria do chamado |
| `subcategory` | string | Subcategoria (ex: nome do software) |
| `user_name` | string | Nome do solicitante |
| `description` | string | Descrição detalhada |
| `priority` | string | `baixa`, `media` ou `alta` |
| `status` | string | `aberto`, `em_analise`, `pendente`, `pendente_terceiros` ou `fechado` |
| `created_by` | string | ID do usuário que criou o chamado |
| `assigned_to` | string | ID do técnico atribuído |
| `assigned_to_name` | string | Nome do técnico atribuído |
| `procedures` | array | Lista de procedimentos técnicos registrados |
| `created_at` | number | Timestamp de criação (ms) |
| `updated_at` | number | Timestamp da última atualização (ms) |

#### Estrutura de cada procedimento em `procedures`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `text` | string | Descrição do procedimento |
| `technician_name` | string | Nome do técnico que registrou |
| `created_at` | number | Timestamp do registro (ms) |

### Collection `users`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | UUID v4 |
| `name` | string | Nome completo |
| `username` | string | Login (lowercase, único) |
| `email` | string | E-mail (lowercase, único) |
| `role` | string | `admin`, `gerencia`, `tecnico` ou `usuario` |
| `password` | string | Hash `salt:hash` via `scryptSync` (64 bytes) |
| `password_reset` | boolean | Sinaliza redefinição obrigatória de senha |
| `created_at` | number | Timestamp de criação (ms) |
| `updated_at` | number | Timestamp da última atualização (ms) |

### Populando com dados de exemplo

```bash
node scripts/seed.js
```

Insere 25 chamados de exemplo distribuídos entre os diferentes status. O script aborta automaticamente se já existirem dados no banco.

---

## Segurança

| Mecanismo | Implementação |
|-----------|--------------|
| **Headers HTTP** | Helmet com CSP restritiva (somente origens declaradas) |
| **CORS** | Restrito à `ALLOWED_ORIGIN` configurada |
| **Rate limiting leitura** | 2.000 req / 15 min por IP |
| **Rate limiting escrita** | 200 req / 5 min por IP |
| **Hash de senhas** | `crypto.scryptSync` com salt aleatório de 16 bytes |
| **Tokens de sessão** | `crypto.randomBytes(32)` — 256 bits de entropia |
| **Expiração de sessão** | 8 horas; limpeza automática a cada hora |
| **Validação de entrada** | Sanitização e limites de tamanho em todos os campos |
| **Autorização por rota** | Middleware `requireAuth` + verificação de perfil por endpoint |

---

## Deploy

O projeto inclui scripts de deploy para ambientes de **staging** e **produção** gerenciados via `Makefile`.

### Fluxo recomendado

```bash
# 1. Deploy no staging
make deploy-staging

# 2. Verificar saúde
make health-staging

# 3. Promover para produção (inclui teste automático de staging)
make promote

# Em caso de problema
make rollback-prod
```

### Comandos disponíveis

```
make install            Instala dependências
make dev                Inicia em modo desenvolvimento (hot-reload)
make lint               Verifica sintaxe do servidor e do frontend

make deploy-staging     Deploy no ambiente de staging
make health-staging     Health check no staging
make logs-staging       Logs ao vivo do staging
make rollback-staging   Reverte staging para versão anterior

make promote            Testa staging e promove para produção
make deploy-prod        Deploy direto em produção
make health-prod        Health check em produção
make logs-prod          Logs ao vivo de produção
make rollback-prod      Reverte produção para versão anterior

make status             Exibe status de ambos os ambientes
make release            Lista releases disponíveis
```

### Configuração de deploy

Crie o arquivo `scripts/.config.env` a partir de `scripts/config.example.sh` com as credenciais dos servidores remotos (host, usuário SSH, caminhos de release etc.).

---

## Adicionando Screenshots

Para adicionar as capturas de tela referenciadas neste documento, salve os arquivos nos seguintes caminhos:

| Arquivo | Tela |
|---------|------|
| `docs/screenshots/login.png` | Tela de login com seletor de idioma |
| `docs/screenshots/dashboard.png` | Dashboard completo (métricas + gráficos + SLA) |
| `docs/screenshots/drawer-status.png` | Drawer lateral de chamados filtrados |
| `docs/screenshots/sla-chart.png` | Card de SLA com gráfico doughnut |
| `docs/screenshots/tech-chart.png` | Gráfico 3D de pizza por técnico |
| `docs/screenshots/ticket-detail.png` | Detalhe do chamado com log de procedimentos |
| `docs/screenshots/my-tickets.png` | Visão de "Meus Chamados" do usuário comum |
| `docs/screenshots/users.png` | Painel de gerenciamento de usuários |
