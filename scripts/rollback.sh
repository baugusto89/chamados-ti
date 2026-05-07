#!/usr/bin/env bash
# =============================================================================
#  scripts/rollback.sh <staging|production>
#
#  Reverte para a release imediatamente anterior à atual.
#  Lista as últimas releases e permite escolher qual restaurar.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.config.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
info()    { echo -e "${CYAN}[rollback]${NC} $*"; }
success() { echo -e "${GREEN}[rollback]${NC} ✅ $*"; }
warn()    { echo -e "${YELLOW}[rollback]${NC} ⚠️  $*"; }
error()   { echo -e "${RED}[rollback]${NC} ❌ $*" >&2; exit 1; }

ENV="${1:-}"
case "$ENV" in
  staging)
    SSH_HOST="$STAGING_HOST"; SSH_USER="$STAGING_USER"; SSH_PORT="${STAGING_PORT:-22}"
    APP_PORT="$STAGING_APP_PORT"; SERVICE_NAME="chamados-staging"
    INSTALL_DIR="/opt/chamados-staging"; RELEASES_DIR="/opt/releases-staging"
    ;;
  production)
    SSH_HOST="$PROD_HOST"; SSH_USER="$PROD_USER"; SSH_PORT="${PROD_PORT:-22}"
    APP_PORT="$PROD_APP_PORT"; SERVICE_NAME="chamados-prod"
    INSTALL_DIR="/opt/chamados-prod"; RELEASES_DIR="/opt/releases-prod"
    ;;
  *) error "Uso: $0 <staging|production>" ;;
esac

SSH_OPTS="-p $SSH_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"
remote()      { ssh $SSH_OPTS "$SSH_USER@$SSH_HOST" "$@"; }
remote_sudo() { ssh $SSH_OPTS "$SSH_USER@$SSH_HOST" "sudo $*"; }

echo ""
echo -e "${BOLD}${YELLOW}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${YELLOW}║  Rollback → $ENV$(printf '%*s' $((38 - ${#ENV})) '')║${NC}"
echo -e "${BOLD}${YELLOW}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Listar releases disponíveis
RELEASES=$(remote "ls -1t $RELEASES_DIR 2>/dev/null" || error "Nenhuma release encontrada em $RELEASES_DIR")
CURRENT=$(remote "readlink -f $INSTALL_DIR 2>/dev/null | xargs basename 2>/dev/null || echo 'nenhuma'")

if [[ -z "$RELEASES" ]]; then
  error "Nenhuma release disponível para rollback."
fi

echo -e "  ${BOLD}Release atual:${NC} $CURRENT"
echo ""
echo -e "  ${BOLD}Releases disponíveis:${NC}"

mapfile -t RELEASE_ARRAY <<< "$RELEASES"
i=1
for r in "${RELEASE_ARRAY[@]}"; do
  MARKER=""
  [[ "$r" == "$CURRENT" ]] && MARKER=" ${YELLOW}← atual${NC}"
  echo -e "    ${CYAN}[$i]${NC} $r${MARKER}"
  ((i++))
done

echo ""
read -rp "$(echo -e "  ${YELLOW}Escolha a release para restaurar [2 = anterior]:${NC} ")" CHOICE
CHOICE=${CHOICE:-2}

if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || [[ "$CHOICE" -lt 1 ]] || [[ "$CHOICE" -gt "${#RELEASE_ARRAY[@]}" ]]; then
  error "Escolha inválida."
fi

TARGET_RELEASE="${RELEASE_ARRAY[$((CHOICE - 1))]}"

[[ "$TARGET_RELEASE" == "$CURRENT" ]] && { warn "Escolheu a release atual. Nada a fazer."; exit 0; }

echo ""
warn "Você está prestes a reverter ${BOLD}$ENV${NC} para:"
echo -e "  ${BOLD}$TARGET_RELEASE${NC}"
echo ""
read -rp "$(echo -e "  ${RED}Confirmar rollback? [s/N]:${NC} ")" CONFIRM
[[ ! "$CONFIRM" =~ ^[sS]$ ]] && { info "Rollback cancelado."; exit 0; }

# Executar rollback
info "Atualizando symlink..."
remote_sudo "ln -sfn $RELEASES_DIR/$TARGET_RELEASE $INSTALL_DIR"

info "Reiniciando serviço..."
remote_sudo "systemctl restart $SERVICE_NAME"
sleep 3

# Verificar se voltou a funcionar
HTTP_CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$APP_PORT/api/stats 2>/dev/null" || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo ""
  success "Rollback concluído! Ambiente rodando com: ${BOLD}$TARGET_RELEASE${NC}"
else
  error "Rollback aplicado, mas o serviço não responde (HTTP $HTTP_CODE). Verifique os logs: journalctl -u $SERVICE_NAME"
fi
echo ""
