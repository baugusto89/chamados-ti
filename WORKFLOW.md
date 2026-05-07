# 🔄 Guia de Workflow — Staging e Produção

## Visão geral da arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                     MÁQUINA DO DESENVOLVEDOR                     │
│                                                                   │
│  código → git commit → git push                                  │
│                                                                   │
│  make deploy-staging   →  rsync + restart  →  VM Staging        │
│  make health-staging   →  testa API        →  VM Staging        │
│  make promote          →  deploy+healthck  →  VM Produção       │
│  make rollback-prod    →  troca symlink    →  VM Produção       │
└─────────────────────────────────────────────────────────────────┘
            │ rsync/SSH                │ rsync/SSH
            ▼                         ▼
┌───────────────────┐      ┌───────────────────┐
│   VM STAGING      │      │   VM PRODUÇÃO     │
│   192.168.200.11    │      │   192.168.200.10   │
│                   │      │                   │
│  Nginx :8080      │      │  Nginx :80        │
│  Node  :3001      │      │  Node  :3000      │
│                   │      │                   │
│  /opt/            │      │  /opt/            │
│  ├─chamados-stg   │      │  ├─chamados-prod  │  ← symlinks
│  │   (symlink)→──┐│      │  │   (symlink)→──┐│
│  ├─releases-stg/ ││      │  ├─releases-prod/ ││
│  │  ├─20240115_14├┘│      │  │  ├─20240115_14├┘│
│  │  └─20240115_15  │      │  │  └─20240115_15  │  ← release ativa
│  └─data-staging/  │      │  └─data-prod/     │  ← banco persiste
│    chamados.db    │      │    chamados.db    │    entre releases
└───────────────────┘      └───────────────────┘
```

---

## Conceito chave: Releases versionadas

Cada deploy cria uma pasta com timestamp em `/opt/releases-<env>/`:

```
/opt/releases-prod/
  20240115_140000/    ← release antiga (mantida para rollback)
  20240115_150000/    ← release ativa (symlink aponta aqui)
  20240116_090000/    ← release mais nova após próximo deploy
```

O diretório `/opt/chamados-prod` é um **symlink** para a release ativa. Para fazer rollback, basta trocar o symlink — é instantâneo.

O banco de dados fica em `/opt/data-prod/` — **fora das releases**, então persiste entre deploys.

---

## Setup inicial (fazer uma única vez)

### 1. Preparar suas chaves SSH

```bash
# Gerar chave SSH (se ainda não tiver)
ssh-keygen -t ed25519 -C "deploy-chamados-ti"

# Verificar
cat ~/.ssh/id_ed25519.pub
```

### 2. Configurar os IPs das VMs

```bash
cd chamados-ti/
cp scripts/config.example.sh scripts/.config.env
nano scripts/.config.env    # editar IPs, portas e usuários
```

### 3. Provisionar cada VM (fazer uma vez por VM)

```bash
# Provisionamento da VM de staging
# Pré-requisito: acesso SSH root na VM
bash scripts/provision-vm.sh staging

# Provisionamento da VM de produção
bash scripts/provision-vm.sh production
```

O script `provision-vm.sh` configura automaticamente:
- Node.js 20 LTS + Nginx + UFW
- Usuário `deploy` com sua chave SSH
- Usuário `chamados` para rodar o serviço
- Serviço systemd com reinício automático
- Estrutura de releases e banco de dados
- Backup diário agendado

### 4. Primeiro deploy

```bash
make deploy-staging
make health-staging
make promote          # promove para produção
```

---

## Workflow diário

### Rotina normal de desenvolvimento

```
1. Desenvolver localmente
   └─ make dev          (servidor com hot-reload)

2. Validar o código
   └─ make lint         (verifica sintaxe)

3. Enviar para staging
   └─ make deploy-staging

4. Testar no staging
   └─ make health-staging
   └─ Abrir http://192.168.200.11:8080 e testar manualmente

5. Aprovar e ir para produção
   └─ make promote
        ├─ Roda health-check em staging
        ├─ Pede confirmação (digitar 'PRODUÇÃO')
        ├─ Deploy em produção com rollback automático
        └─ Roda health-check em produção
```

### Verificar status dos ambientes

```bash
make status
```

Saída exemplo:
```
╔══════════════════════════════════════════════════════╗
║        Central de Chamados TI — Status Geral         ║
║        15/01/2024 15:43:22                           ║
╚══════════════════════════════════════════════════════╝

  ┌─ STAGING ──────────────────────────────────────┐
  │                                                 │
  │  Host:        http://192.168.200.11:8080          │
  │  Serviço:  🟢 active (desde 2024-01-15)        │
  │  API:      ✓  HTTP 200                         │
  │  Nginx:    ✓  active                           │
  │                                                 │
  │  Release:     20240115_143022                   │
  │  Histórico:   3 releases disponíveis           │
  │                                                 │
  │  Chamados:    Total: 12  |  Abertos: 4         │
  │  Banco:       48K                              │
  │  Memória:     42MB                             │
  │  Disco:       18% utilizado                    │
  └─────────────────────────────────────────────────┘

  ┌─ PRODUÇÃO ─────────────────────────────────────┐
  ...
```

---

## Comandos de referência

| Comando | O que faz |
|---------|-----------|
| `make dev` | Servidor local com hot-reload |
| `make lint` | Verifica sintaxe antes de subir |
| `make deploy-staging` | Deploy no staging (com rollback automático) |
| `make health-staging` | Testes completos no staging |
| `make logs-staging` | Logs ao vivo do staging |
| `make promote` | Testa staging → promove para produção |
| `make deploy-prod` | Deploy direto em produção (emergência) |
| `make rollback-prod` | Reverte produção para versão anterior |
| `make health-prod` | Testes completos em produção |
| `make logs-prod` | Logs ao vivo da produção |
| `make status` | Painel geral dos dois ambientes |
| `make release` | Lista todas as releases disponíveis |

---

## Rollback

### Rollback interativo (escolha a versão)

```bash
make rollback-prod
```

Você verá as releases disponíveis e escolhe qual restaurar:

```
Release atual: 20240115_150000

Releases disponíveis:
  [1] 20240115_150000  ← atual
  [2] 20240115_143022
  [3] 20240114_090000

Escolha a release para restaurar [2 = anterior]: 2
Confirmar rollback? [s/N]: s
✅ Rollback concluído! Rodando: 20240115_143022
```

### Rollback de emergência via SSH (sem `make`)

```bash
# Listar releases
ssh deploy@192.168.200.10 "ls -lt /opt/releases-prod"

# Trocar para release anterior
ssh deploy@192.168.200.10 "sudo ln -sfn /opt/releases-prod/20240115_143022 /opt/chamados-prod && sudo systemctl restart chamados-prod"

# Verificar
ssh deploy@192.168.200.10 "curl -s http://127.0.0.1:3000/api/stats"
```

---

## Com GitHub Actions (opcional)

Se quiser CI/CD totalmente automático via GitHub:

### Estrutura de branches

```
main      →  produção    (deploy automático ao fazer merge)
develop   →  staging     (deploy automático ao fazer push)
feature/* →  sem deploy  (apenas desenvolvimento)
```

### Fluxo com branches

```bash
# Trabalhar em uma feature
git checkout develop
git checkout -b feature/nova-categoria

# ... desenvolver ...

git add .
git commit -m "feat: adiciona categoria Hardware"
git push origin feature/nova-categoria

# Merge na develop → deploy automático em staging
git checkout develop
git merge feature/nova-categoria
git push origin develop
# → GitHub Actions faz deploy em staging + health check

# Aprovar para produção → merge na main
git checkout main
git merge develop
git push origin main
# → GitHub Actions faz deploy em produção + health check + rollback automático se falhar
```

### Configurar secrets no GitHub

Em **Settings → Secrets and variables → Actions**:

| Secret | Valor |
|--------|-------|
| `STAGING_HOST` | 192.168.200.11 |
| `STAGING_USER` | deploy |
| `STAGING_SSH_KEY` | conteúdo de `~/.ssh/id_ed25519` (chave **privada**) |
| `STAGING_PORT` | 22 |
| `STAGING_APP_PORT` | 3001 |
| `STAGING_NGINX_PORT` | 8080 |
| `PROD_HOST` | 192.168.200.10 |
| `PROD_USER` | deploy |
| `PROD_SSH_KEY` | conteúdo de `~/.ssh/id_ed25519` (chave **privada**) |
| `PROD_PORT` | 22 |
| `PROD_APP_PORT` | 3000 |
| `PROD_NGINX_PORT` | 80 |

### Configurar environments no GitHub

Em **Settings → Environments**, crie:
- `staging` — sem proteção
- `production` — com **Required reviewers** (aprovação manual antes de ir para prod)

---

## Estrutura de diretórios nas VMs

```
/opt/
├── chamados-staging → releases-staging/20240115_150000   (symlink)
├── chamados-prod    → releases-prod/20240115_150000      (symlink)
│
├── releases-staging/
│   ├── 20240114_090000/    ← release antiga
│   └── 20240115_150000/    ← release ativa
│       ├── server.js
│       ├── package.json
│       ├── node_modules/
│       ├── .env            ← gerado no deploy
│       └── public/
│
├── releases-prod/
│   └── 20240115_150000/    ← igual ao staging
│
├── data-staging/
│   └── chamados.db         ← banco do staging (persiste entre releases)
│
├── data-prod/
│   └── chamados.db         ← banco de produção (persiste entre releases)
│
└── backups-prod/
    ├── chamados_2024-01-14_03-00-00.db
    └── chamados_2024-01-15_03-00-00.db
```

---

## Boas práticas

- ✅ **Sempre** testar no staging antes de ir para produção
- ✅ Usar `make promote` em vez de `make deploy-prod` diretamente
- ✅ Verificar `make status` antes e depois de qualquer deploy
- ✅ Manter ao menos 3 releases antigas para rollback rápido
- ✅ Monitorar `make logs-prod` nos primeiros minutos após um deploy
- ✅ Os bancos de staging e produção são **separados** — teste livremente no staging
- ❌ Nunca commitar arquivos `.env` ou `scripts/.config.env` no git
- ❌ Nunca fazer deploy em produção sem passar pelo health check
