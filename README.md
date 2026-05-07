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
| Gráficos | Chart.js 4 (CDN) |
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

O sistema possui três perfis de usuário com permissões distintas:

### Administrador (`admin`)
- Acesso completo a todas as funcionalidades
- Visualiza e gerencia **todos** os chamados
- Gerencia usuários: criar, editar, excluir e resetar senhas
- Acessa o dashboard com métricas e gráficos
- Altera o status de qualquer chamado
- Promove ou rebaixa perfis de outros usuários

### Técnico (`tecnico`)
- Visualiza e gerencia **todos** os chamados
- Acessa o dashboard, histórico, requisições e incidentes
- Altera o status dos chamados
- **Não** acessa o menu de gerenciamento de usuários

### Usuário Comum (`usuario`)
- Visualiza **somente seus próprios chamados** em formato de cards
- Abre novos chamados (nome preenchido automaticamente)
- Filtra seus chamados por Requisições ou Incidentes
- **Não** altera status de chamados
- **Não** acessa o histórico geral nem o painel de usuários

---

## Funcionalidades

### Autenticação

- Login com usuário e senha
- Sessão por token aleatório (32 bytes hex) com TTL de **8 horas**
- Token armazenado no `localStorage` e enviado como `Authorization: Bearer <token>`
- Sessões expiradas são limpas automaticamente a cada hora no servidor
- Logout invalida o token imediatamente no servidor

### Dashboard (admin / técnico)

- Contadores: total de chamados, abertos, em andamento, fechados, requisições e incidentes
- Gráficos de barras por categoria (Requisições e Incidentes), via Chart.js
- Lista dos 5 chamados mais recentes
- Contadores na barra lateral atualizados em tempo real

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
| `Em andamento` | Em tratamento pela equipe de TI |
| `Fechado` | Resolvido |

#### Prioridade (somente Incidentes)
`Alta` · `Média` · `Baixa` — indicadas por borda colorida na lista

#### Detecção de duplicatas
Ao preencher um novo chamado, o sistema verifica em tempo real se o usuário já possui chamados abertos para a mesma **categoria + subcategoria**, exibindo um aviso antes do envio.

### Meus Chamados (usuário comum)

- Grade de cards com todos os chamados do usuário
- Borda colorida por status: azul (aberto), âmbar (em andamento), verde (fechado)
- Botão de "Novo chamado" com nome do usuário preenchido automaticamente e bloqueado
- Filtros por Requisições e Incidentes no menu lateral

### Gerenciamento de Usuários (somente admin)

| Ação | Detalhe |
|------|---------|
| **Criar** | Nome, e-mail, usuário, senha e perfil |
| **Editar** | Nome, e-mail, usuário e perfil (senha não incluída) |
| **Excluir** | Remove permanentemente |
| **Reset de Senha** | Gera senha provisória aleatória e força redefinição no próximo login |

#### Fluxo de Reset de Senha

```
Admin clica "Reset de Senha"
    │
    ▼
Servidor gera senha provisória (ex: AbCd-1xY2)
Salva como senha do usuário + marca password_reset = true
    │
    ▼
Modal exibe a senha provisória com botão "Copiar"
Admin compartilha a senha com o usuário
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
| `dashboard` | admin, técnico | Métricas e gráficos |
| `mytickets` | usuário | Cards dos próprios chamados |
| `new` | todos | Formulário de novo chamado |
| `history` | admin, técnico | Histórico com filtros e paginação |
| `users` | admin | Gerenciamento de usuários |

Regras aplicadas automaticamente em `go()`:
- `usuario` → redireciona `dashboard`, `history` e `users` para `mytickets`
- `tecnico` → redireciona `users` para `dashboard`

---

## API — Rotas

### Autenticação (públicas)

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/auth/login` | Autentica e retorna token |
| `POST` | `/api/auth/logout` | Invalida o token da sessão |
| `GET` | `/api/auth/me` | Retorna dados da sessão atual |
| `POST` | `/api/auth/change-password` | Define nova senha (fluxo de reset) |

### Chamados (requerem autenticação)

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| `GET` | `/api/tickets` | todos | Lista chamados (filtrado por `created_by` para perfil `usuario`) |
| `GET` | `/api/tickets/:id` | todos | Busca chamado por ID |
| `POST` | `/api/tickets` | todos | Cria novo chamado |
| `PATCH` | `/api/tickets/:id/status` | admin, técnico | Atualiza status |
| `DELETE` | `/api/tickets/:id` | admin, técnico | Exclui chamado |
| `GET` | `/api/check-duplicate` | todos | Verifica duplicata por usuário + categoria |

### Estatísticas e Categorias

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/stats` | Totais gerais e por categoria |
| `GET` | `/api/categories` | Lista de categorias por tipo |

### Usuários (requerem autenticação)

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| `GET` | `/api/users` | admin | Lista todos os usuários |
| `POST` | `/api/users` | admin | Cria novo usuário |
| `PATCH` | `/api/users/:id` | admin | Edita dados do usuário |
| `DELETE` | `/api/users/:id` | admin | Exclui usuário |
| `POST` | `/api/users/:id/reset-password` | admin | Gera senha provisória e força redefinição |

### Parâmetros de filtro — `GET /api/tickets`

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `type` | `requisicao` \| `incidente` | Filtra por tipo |
| `status` | `aberto` \| `em_andamento` \| `fechado` | Filtra por status |
| `user` | string | Filtra por nome do usuário (busca parcial) |
| `q` | string | Busca em categoria, descrição, ID e usuário |
| `page` | number | Página (padrão: 1) |
| `limit` | number | Itens por página (padrão: 50, máximo: 100) |

---

## Banco de Dados

O LokiJS persiste os dados em um arquivo JSON binário (`.db`). Dois collections são criados automaticamente na primeira execução:

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
| `status` | string | `aberto`, `em_andamento` ou `fechado` |
| `created_by` | string | ID do usuário que criou o chamado |
| `created_at` | number | Timestamp de criação (ms) |
| `updated_at` | number | Timestamp da última atualização (ms) |

### Collection `users`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | UUID v4 |
| `name` | string | Nome completo |
| `username` | string | Login (lowercase, único) |
| `email` | string | E-mail (lowercase, único) |
| `role` | string | `admin`, `tecnico` ou `usuario` |
| `password` | string | Hash `salt:hash` via `scryptSync` (64 bytes) |
| `password_reset` | boolean | Sinaliza redefinição obrigatória de senha |
| `created_at` | number | Timestamp de criação (ms) |
| `updated_at` | number | Timestamp da última atualização (ms) |

### Populando com dados de exemplo

```bash
node scripts/seed.js
```

Insere 25 chamados de exemplo distribuídos entre abertos, em andamento e fechados. O script aborta automaticamente se já existirem dados no banco.

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
