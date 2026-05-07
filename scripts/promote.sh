#!/usr/bin/env bash
# =============================================================================
#  scripts/promote.sh
#
#  Fluxo completo de promoção: staging → produção
#    1. Executa health check no staging
#    2. Exibe release atual de staging
#    3. Pede confirmação do operador
#    4. Faz deploy em produção com os mesmos arquivos
#    5. Executa health check em produção
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.config.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
info()    { echo -e "${CYAN}[promote]${NC} $*"; }
success() { echo -e "${GREEN}[promote]${NC} ✅ $*"; }
warn()    { echo -e "${YELLOW}[promote]${NC} ⚠️  $*"; }
error()   { echo -e "${RED}[promote]${NC} ❌ $*" >&2; exit 1; }

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"
staging_cmd() { ssh $SSH_OPTS -p "${STAGING_PORT:-22}" "$STAGING_USER@$STAGING_HOST" "$@" 2>/dev/null; }

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║        Promoção: Staging → Produção                  ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Health check no staging ───────────────────────────────────────────────
echo -e "${BOLD}Passo 1/4 — Verificando saúde do staging...${NC}\n"
if ! bash "$SCRIPT_DIR/health-check.sh" staging; then
  echo ""
  error "Health check do staging falhou. Corrija os problemas antes de promover para produção."
fi

# ── 2. Informações da release de staging ────────────────────────────────────
echo -e "\n${BOLD}Passo 2/4 — Release de staging:${NC}"
STAGING_RELEASE=$(staging_cmd "readlink -f /opt/chamados-staging | xargs basename" || echo "desconhecida")
STAGING_STATS=$(staging_cmd "curl -s http://127.0.0.1:$STAGING_APP_PORT/api/stats" 2>/dev/null || echo "{}")
STAGING_TOTAL=$(echo "$STAGING_STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['overview']['total'])" 2>/dev/null || echo "?")

echo ""
echo -e "  Staging release:   ${BOLD}$STAGING_RELEASE${NC}"
echo -e "  Chamados no banco: ${BOLD}$STAGING_TOTAL${NC} (banco de staging — dados de teste)"
echo ""

# Release atual em produção
SSH_PROD="-p ${PROD_PORT:-22} -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"
PROD_RELEASE=$(ssh $SSH_PROD "$PROD_USER@$PROD_HOST" "readlink -f /opt/chamados-prod | xargs basename" 2>/dev/null || echo "nenhuma")
echo -e "  Produção atual:    ${BOLD}$PROD_RELEASE${NC}"
echo ""

# ── 3. Confirmação manual ────────────────────────────────────────────────────
echo -e "${BOLD}Passo 3/4 — Confirmação:${NC}"
echo ""
echo -e "  ${YELLOW}Você está prestes a enviar o código de STAGING para PRODUÇÃO.${NC}"
echo -e "  Os dados de produção (banco de dados) NÃO serão afetados."
echo ""
read -rp "$(echo -e "  ${BOLD}Digite 'PRODUÇÃO' para confirmar o deploy:${NC} ")" CONFIRM

if [[ "$CONFIRM" != "PRODUÇÃO" && "$CONFIRM" != "PRODUCAO" ]]; then
  info "Promoção cancelada."
  exit 0
fi

# ── 4. Deploy em produção ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Passo 4/4 — Executando deploy em produção...${NC}"
echo ""
bash "$SCRIPT_DIR/deploy.sh" production

# ── 5. Health check em produção ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}Verificando saúde da produção após deploy...${NC}\n"
if bash "$SCRIPT_DIR/health-check.sh" production; then
  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║  🚀  Promoção concluída com sucesso!                 ║${NC}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Acesse produção: ${BOLD}http://$PROD_HOST:$PROD_NGINX_PORT${NC}"
else
  warn "Health check de produção falhou. O rollback automático já foi executado pelo deploy.sh."
  echo -e "  Execute manualmente: ${BOLD}make rollback-prod${NC}"
  exit 1
fi
echo ""
