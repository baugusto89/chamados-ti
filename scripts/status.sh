#!/usr/bin/env bash
# =============================================================================
#  scripts/status.sh — Painel de status de ambos os ambientes
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.config.env"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; NC='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=6 -o BatchMode=yes"

collect_env_info() {
  local env="$1" host="$2" user="$3" port="$4"
  local app_port="$5" nginx_port="$6" service="$7" install_dir="$8"
  local ssh="-p $port $SSH_OPTS"

  printf "\n"
  printf "${BOLD}${CYAN}  ┌─ %-46s─┐${NC}\n" "$(echo "$env" | tr '[:lower:]' '[:upper:]') ──────────────────────────"
  printf "${BOLD}${CYAN}  │${NC}  %-52s${BOLD}${CYAN}│${NC}\n" ""
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} %-38s${BOLD}${CYAN}│${NC}\n" "Host:" "http://$host:$nginx_port"

  # Testar SSH
  if ! ssh $ssh "$user@$host" "echo ok" &>/dev/null; then
    printf "${BOLD}${CYAN}  │${NC}  ${RED}%-52s${NC}${BOLD}${CYAN}│${NC}\n" "⚡ Host inacessível via SSH"
    printf "${BOLD}${CYAN}  └──────────────────────────────────────────────────┘${NC}\n"
    return
  fi

  # Coletar info remota em um único SSH
  INFO=$(ssh $ssh "$user@$host" bash <<REMOTE 2>/dev/null
    SVC_ACTIVE=\$(systemctl is-active "$service" 2>/dev/null || echo "inativo")
    SVC_SINCE=\$(systemctl show "$service" --property=ActiveEnterTimestamp --value 2>/dev/null | cut -d' ' -f1-2)
    RELEASE=\$(readlink -f "$install_dir" 2>/dev/null | xargs basename 2>/dev/null || echo "nenhuma")
    RELEASES_COUNT=\$(ls "$install_dir/../releases-${env%%-*}" 2>/dev/null | wc -l || echo 0)
    HTTP=\$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$app_port/api/stats" 2>/dev/null || echo "000")
    STATS=\$(curl -s -m 3 "http://127.0.0.1:$app_port/api/stats" 2>/dev/null || echo '{}')
    TOTAL=\$(echo "\$STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['overview']['total'])" 2>/dev/null || echo "?")
    ABERTOS=\$(echo "\$STATS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['overview']['abertos'])" 2>/dev/null || echo "?")
    DISK=\$(df -h "$install_dir" 2>/dev/null | tail -1 | awk '{print \$5}' || echo "?")
    DB_SIZE=\$(du -sh "/opt/data-$env/chamados.db" 2>/dev/null | cut -f1 || echo "N/A")
    MEM=\$(ps -o rss= -p \$(pgrep -f "node server" | head -1) 2>/dev/null | awk '{printf "%.0fMB", \$1/1024}' || echo "N/A")
    NGINX=\$(systemctl is-active nginx 2>/dev/null || echo "inativo")
    echo "SVC_ACTIVE=\$SVC_ACTIVE|SVC_SINCE=\$SVC_SINCE|RELEASE=\$RELEASE|RELEASES_COUNT=\$RELEASES_COUNT|HTTP=\$HTTP|TOTAL=\$TOTAL|ABERTOS=\$ABERTOS|DISK=\$DISK|DB_SIZE=\$DB_SIZE|MEM=\$MEM|NGINX=\$NGINX"
REMOTE
  )

  # Parsear info
  declare -A D
  while IFS='=' read -r k v; do D["$k"]="$v"; done < <(echo "$INFO" | tr '|' '\n')

  # Ícone de status do serviço
  SVC_ICON="🔴"; SVC_COLOR="$RED"
  [[ "${D[SVC_ACTIVE]}" == "active" ]] && SVC_ICON="🟢" && SVC_COLOR="$GREEN"
  [[ "${D[SVC_ACTIVE]}" == "activating" ]] && SVC_ICON="🟡" && SVC_COLOR="$YELLOW"

  HTTP_ICON="✗"; HTTP_COLOR="$RED"
  [[ "${D[HTTP]}" == "200" ]] && HTTP_ICON="✓" && HTTP_COLOR="$GREEN"

  NGINX_ICON="✗"; NGINX_COLOR="$RED"
  [[ "${D[NGINX]}" == "active" ]] && NGINX_ICON="✓" && NGINX_COLOR="$GREEN"

  # Exibir
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} ${SVC_COLOR}%s %-35s${NC}${BOLD}${CYAN}│${NC}\n" "Serviço:" "$SVC_ICON" "${D[SVC_ACTIVE]} (desde ${D[SVC_SINCE]:-?})"
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} ${HTTP_COLOR}%s${NC} %-37s${BOLD}${CYAN}│${NC}\n" "API:" "$HTTP_ICON" "HTTP ${D[HTTP]}"
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} ${NGINX_COLOR}%s${NC} %-37s${BOLD}${CYAN}│${NC}\n" "Nginx:" "$NGINX_ICON" "${D[NGINX]}"
  printf "${BOLD}${CYAN}  │${NC}  %-52s${BOLD}${CYAN}│${NC}\n" ""
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} %-38s${BOLD}${CYAN}│${NC}\n" "Release:" "${D[RELEASE]}"
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} %-38s${BOLD}${CYAN}│${NC}\n" "Histórico:" "${D[RELEASES_COUNT]} releases disponíveis"
  printf "${BOLD}${CYAN}  │${NC}  %-52s${BOLD}${CYAN}│${NC}\n" ""
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} %-38s${BOLD}${CYAN}│${NC}\n" "Chamados:" "Total: ${D[TOTAL]}  |  Abertos: ${D[ABERTOS]}"
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} %-38s${BOLD}${CYAN}│${NC}\n" "Banco:" "${D[DB_SIZE]}"
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} %-38s${BOLD}${CYAN}│${NC}\n" "Memória Node:" "${D[MEM]}"
  printf "${BOLD}${CYAN}  │${NC}  ${BOLD}%-12s${NC} %-38s${BOLD}${CYAN}│${NC}\n" "Disco:" "${D[DISK]} utilizado"
  printf "${BOLD}${CYAN}  └──────────────────────────────────────────────────┘${NC}\n"
}

# ── Cabeçalho ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║        Central de Chamados TI — Status Geral         ║${NC}"
echo -e "${BOLD}${CYAN}║        $(date '+%d/%m/%Y %H:%M:%S')$(printf '%*s' 28 '')║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"

collect_env_info "staging"    "$STAGING_HOST" "$STAGING_USER" \
  "${STAGING_PORT:-22}" "$STAGING_APP_PORT" "$STAGING_NGINX_PORT" \
  "chamados-staging" "/opt/chamados-staging"

collect_env_info "prod"  "$PROD_HOST"    "$PROD_USER" \
  "${PROD_PORT:-22}"    "$PROD_APP_PORT"    "$PROD_NGINX_PORT" \
  "chamados-prod"    "/opt/chamados-prod"

echo ""
echo -e "  ${DIM}Comandos rápidos:${NC}"
echo -e "  ${DIM}  make deploy-staging   make promote   make rollback-prod${NC}"
echo ""
