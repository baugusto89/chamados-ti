#!/usr/bin/env bash
# =============================================================================
#  scripts/deploy.sh <staging|production>
#
#  Fluxo de deploy com releases versionadas:
#    1. Cria pasta /opt/releases-<env>/<timestamp>/
#    2. Copia arquivos via rsync
#    3. Instala dependências npm
#    4. Escreve .env do ambiente
#    5. Atualiza symlink /opt/chamados-<env> → nova release
#    6. Reinicia serviço systemd
#    7. Executa health check
#    8. Rollback automático se health check falhar
#    9. Remove releases antigas (mantém RELEASES_TO_KEEP)
# =============================================================================
set -euo pipefail

# ── Carregar configuração ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.config.env"
[[ -f "$CONFIG_FILE" ]] || { echo "❌ Arquivo $CONFIG_FILE não encontrado. Copie config.example.sh."; exit 1; }
# shellcheck source=scripts/.config.env
source "$CONFIG_FILE"

# ── Cores e helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} ✅ $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} ⚠️  $*"; }
error()   { echo -e "${RED}[deploy]${NC} ❌ $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}── $* ──${NC}"; }

# ── Validar argumento ─────────────────────────────────────────────────────────
ENV="${1:-}"
case "$ENV" in
  staging)
    SSH_HOST="$STAGING_HOST"
    SSH_USER="$STAGING_USER"
    SSH_PORT="${STAGING_PORT:-22}"
    APP_PORT="$STAGING_APP_PORT"
    NGINX_PORT="$STAGING_NGINX_PORT"
    SERVICE_NAME="chamados-staging"
    INSTALL_DIR="/opt/chamados-staging"
    RELEASES_DIR="/opt/releases-staging"
    ENV_FILE="envs/.env.staging"
    ;;
  production)
    SSH_HOST="$PROD_HOST"
    SSH_USER="$PROD_USER"
    SSH_PORT="${PROD_PORT:-22}"
    APP_PORT="$PROD_APP_PORT"
    NGINX_PORT="$PROD_NGINX_PORT"
    SERVICE_NAME="chamados-prod"
    INSTALL_DIR="/opt/chamados-prod"
    RELEASES_DIR="/opt/releases-prod"
    ENV_FILE="envs/.env.production"
    ;;
  *)
    error "Uso: $0 <staging|production>"
    ;;
esac

PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RELEASE_DIR="$RELEASES_DIR/$TIMESTAMP"

[[ -f "$PROJECT_ROOT/$ENV_FILE" ]] || error "Arquivo $ENV_FILE não encontrado."

# ── SSH helper ────────────────────────────────────────────────────────────────
SSH_OPTS="-p $SSH_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"
remote() { ssh $SSH_OPTS "$SSH_USER@$SSH_HOST" "$@"; }
remote_sudo() { ssh $SSH_OPTS "$SSH_USER@$SSH_HOST" "sudo $*"; }

# ─── Início do deploy ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  Deploy → $(printf '%-38s' "$ENV ($TIMESTAMP)")║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar conectividade SSH
step "Verificando conexão com $SSH_HOST"
remote "echo ok" >/dev/null 2>&1 || error "Não foi possível conectar ao host $SSH_HOST via SSH."
success "Conectado a $SSH_HOST"

# ── 1. Criar diretório da release ─────────────────────────────────────────────
step "Criando release $TIMESTAMP"
remote "mkdir -p $RELEASE_DIR/data-link $RELEASES_DIR"
info "Diretório: $RELEASE_DIR"

# ── 2. Copiar arquivos via rsync ──────────────────────────────────────────────
step "Sincronizando arquivos"
rsync -az --delete \
  -e "ssh $SSH_OPTS" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='data' \
  --exclude='backups' \
  --exclude='.env*' \
  --exclude='envs/' \
  --exclude='scripts/' \
  --exclude='*.zip' \
  --exclude='*.md' \
  --exclude='.github' \
  "$PROJECT_ROOT/" \
  "$SSH_USER@$SSH_HOST:$RELEASE_DIR/"
success "Arquivos sincronizados"

# ── 3. Copiar arquivo .env do ambiente ────────────────────────────────────────
step "Configurando variáveis de ambiente"
# Injeta variáveis dinâmicas no .env
{
  cat "$PROJECT_ROOT/$ENV_FILE"
  echo ""
  echo "PORT=$APP_PORT"
  echo "DB_PATH=/opt/data-$ENV/chamados.db"
  echo "NODE_ENV=$([ "$ENV" = production ] && echo production || echo staging)"
  echo "RELEASE=$TIMESTAMP"
} | ssh $SSH_OPTS "$SSH_USER@$SSH_HOST" "cat > $RELEASE_DIR/.env && chmod 640 $RELEASE_DIR/.env"
success ".env configurado"

# ── 4. Garantir diretório de dados compartilhado (persiste entre releases) ────
remote_sudo "mkdir -p /opt/data-$ENV && chown ${SERVICE_NAME%%-*}:${SERVICE_NAME%%-*} /opt/data-$ENV 2>/dev/null || true"

# ── 5. Instalar dependências npm ──────────────────────────────────────────────
step "Instalando dependências npm"
remote "cd $RELEASE_DIR && npm install --omit=dev --ignore-scripts --quiet 2>/dev/null"
success "npm install concluído"

# ── 6. Guardar release anterior para possível rollback ────────────────────────
PREVIOUS_RELEASE=$(remote "readlink -f $INSTALL_DIR 2>/dev/null || echo ''")
info "Release anterior: ${PREVIOUS_RELEASE:-nenhuma}"

# ── 7. Atualizar symlink (operação atômica) ───────────────────────────────────
step "Ativando nova release"
remote_sudo "ln -sfn $RELEASE_DIR $INSTALL_DIR"
success "Symlink atualizado: $INSTALL_DIR → $RELEASE_DIR"

# ── 8. Reiniciar serviço ──────────────────────────────────────────────────────
step "Reiniciando serviço $SERVICE_NAME"
remote_sudo "systemctl restart $SERVICE_NAME"
sleep 2

if ! remote "systemctl is-active --quiet $SERVICE_NAME 2>/dev/null"; then
  warn "Serviço não iniciou. Executando rollback automático..."
  [[ -n "$PREVIOUS_RELEASE" ]] && {
    remote_sudo "ln -sfn $PREVIOUS_RELEASE $INSTALL_DIR"
    remote_sudo "systemctl restart $SERVICE_NAME"
    error "Deploy falhou. Revertido para: $PREVIOUS_RELEASE"
  }
fi
success "Serviço reiniciado"

# ── 9. Health check ───────────────────────────────────────────────────────────
step "Executando health check"
HEALTH_OK=false
for i in $(seq 1 "${HEALTH_CHECK_RETRIES:-5}"); do
  sleep "${HEALTH_CHECK_DELAY:-3}"
  HTTP_CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/api/stats 2>/dev/null" || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    HEALTH_OK=true
    success "Health check OK (tentativa $i/$((HEALTH_CHECK_RETRIES)))"
    break
  fi
  warn "Tentativa $i: HTTP $HTTP_CODE — aguardando..."
done

if [[ "$HEALTH_OK" != "true" ]]; then
  warn "Health check falhou. Executando rollback automático..."
  [[ -n "$PREVIOUS_RELEASE" ]] && {
    remote_sudo "ln -sfn $PREVIOUS_RELEASE $INSTALL_DIR"
    remote_sudo "systemctl restart $SERVICE_NAME"
  }
  error "Deploy abortado. Revertido para versão anterior."
fi

# ── 10. Remover releases antigas ─────────────────────────────────────────────
step "Limpando releases antigas"
KEEP="${RELEASES_TO_KEEP:-5}"
DELETED=$(remote "ls -1t $RELEASES_DIR | tail -n +$((KEEP + 1)) | while read d; do rm -rf \"$RELEASES_DIR/\$d\" && echo \$d; done | wc -l")
[[ "$DELETED" -gt 0 ]] && info "$DELETED release(s) antiga(s) removida(s)" || info "Nenhuma release antiga para remover"

# ── Resumo ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✅  Deploy concluído com sucesso!               ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Ambiente:   ${BOLD}$ENV${NC}"
echo -e "  Release:    ${BOLD}$TIMESTAMP${NC}"
echo -e "  Endereço:   ${BOLD}http://$SSH_HOST:$NGINX_PORT${NC}"
echo -e "  Logs:       ssh $SSH_USER@$SSH_HOST 'journalctl -u $SERVICE_NAME -f'"
echo ""
