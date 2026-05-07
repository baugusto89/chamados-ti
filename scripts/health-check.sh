#!/usr/bin/env bash
# =============================================================================
#  scripts/health-check.sh <staging|production>
#
#  Testa o ambiente de forma abrangente:
#    ✓ Serviço systemd ativo
#    ✓ API responde (HTTP 200)
#    ✓ Endpoint de estatísticas retorna JSON válido
#    ✓ Criação de chamado (POST /api/tickets)
#    ✓ Listagem de chamados (GET /api/tickets)
#    ✓ Verificação de duplicata funciona
#    ✓ Tempo de resposta aceitável (< 2s)
#    ✓ Nginx proxy funcionando
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/.config.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

PASS=0; FAIL=0; WARN=0

check_pass() { echo -e "  ${GREEN}✓${NC}  $*"; ((PASS++)); }
check_fail() { echo -e "  ${RED}✗${NC}  $*"; ((FAIL++)); }
check_warn() { echo -e "  ${YELLOW}△${NC}  $*"; ((WARN++)); }
section()    { echo -e "\n${BOLD}${CYAN}$*${NC}"; }

ENV="${1:-}"
case "$ENV" in
  staging)
    SSH_HOST="$STAGING_HOST"; SSH_USER="$STAGING_USER"; SSH_PORT="${STAGING_PORT:-22}"
    APP_PORT="$STAGING_APP_PORT"; NGINX_PORT="$STAGING_NGINX_PORT"
    SERVICE_NAME="chamados-staging"; INSTALL_DIR="/opt/chamados-staging"
    ;;
  production)
    SSH_HOST="$PROD_HOST"; SSH_USER="$PROD_USER"; SSH_PORT="${PROD_PORT:-22}"
    APP_PORT="$PROD_APP_PORT"; NGINX_PORT="$PROD_NGINX_PORT"
    SERVICE_NAME="chamados-prod"; INSTALL_DIR="/opt/chamados-prod"
    ;;
  *) echo "Uso: $0 <staging|production>"; exit 1 ;;
esac

SSH_OPTS="-p $SSH_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"
remote() { ssh $SSH_OPTS "$SSH_USER@$SSH_HOST" "$@" 2>/dev/null; }
api()    { remote "curl -s -m 5 $*"; }
api_code() { remote "curl -s -o /dev/null -w '%{http_code}' -m 5 $*"; }
api_time() { remote "curl -s -o /dev/null -w '%{time_total}' -m 10 $*"; }

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  Health Check → $ENV$(printf '%*s' $((33 - ${#ENV})) '')║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Host:     ${BOLD}$SSH_HOST${NC}"
echo -e "  Serviço:  ${BOLD}$SERVICE_NAME${NC}"
echo -e "  API:      ${BOLD}http://$SSH_HOST:$NGINX_PORT${NC}"

BASE="http://127.0.0.1:$APP_PORT"

# ── 1. Conectividade SSH ─────────────────────────────────────────────────────
section "1. Conectividade"
if remote "echo ok" &>/dev/null; then
  check_pass "SSH conectado a $SSH_HOST"
else
  check_fail "SSH falhou para $SSH_HOST — testes abortados"
  exit 1
fi

# ── 2. Serviço systemd ───────────────────────────────────────────────────────
section "2. Serviço systemd"
if remote "systemctl is-active --quiet $SERVICE_NAME"; then
  check_pass "Serviço $SERVICE_NAME está ativo"
else
  check_fail "Serviço $SERVICE_NAME NÃO está ativo"
fi

# Release atual
CURRENT_RELEASE=$(remote "readlink -f $INSTALL_DIR 2>/dev/null | xargs basename" || echo "desconhecida")
check_pass "Release ativa: $CURRENT_RELEASE"

# Uptime do processo
UPTIME=$(remote "systemctl show $SERVICE_NAME --property=ActiveEnterTimestamp --value 2>/dev/null" || echo "?")
[[ -n "$UPTIME" && "$UPTIME" != "?" ]] && check_pass "Serviço ativo desde: $UPTIME"

# ── 3. API (porta direta Node.js) ────────────────────────────────────────────
section "3. API — Node.js (porta $APP_PORT)"

HTTP_CODE=$(api_code "$BASE/api/stats")
if [[ "$HTTP_CODE" == "200" ]]; then
  check_pass "GET /api/stats → HTTP 200"
else
  check_fail "GET /api/stats → HTTP $HTTP_CODE (esperado 200)"
fi

# JSON válido
STATS_JSON=$(api "$BASE/api/stats")
if echo "$STATS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'overview' in d" 2>/dev/null; then
  TOTAL=$(echo "$STATS_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['overview']['total'])" 2>/dev/null)
  check_pass "Resposta JSON válida — total de chamados: $TOTAL"
else
  check_fail "Resposta JSON inválida ou estrutura inesperada"
fi

# Criar chamado de teste
TEST_ID=""
CREATE_CODE=$(api_code -X POST "$BASE/api/tickets" \
  -H "Content-Type: application/json" \
  -d '{"type":"incidente","category":"Computador Lento","user_name":"health-check-bot","description":"Teste automatizado de health check","priority":"baixa"}')
if [[ "$CREATE_CODE" == "201" ]]; then
  check_pass "POST /api/tickets → HTTP 201 (criação OK)"
  TEST_ID=$(api -X POST "$BASE/api/tickets" \
    -H "Content-Type: application/json" \
    -d '{"type":"incidente","category":"Outros","user_name":"health-check-bot","description":"Teste 2","priority":"baixa"}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
else
  check_fail "POST /api/tickets → HTTP $CREATE_CODE (esperado 201)"
fi

# Listagem
LIST_CODE=$(api_code "$BASE/api/tickets")
[[ "$LIST_CODE" == "200" ]] && check_pass "GET /api/tickets → HTTP 200" || check_fail "GET /api/tickets → HTTP $LIST_CODE"

# Duplicata
DUP_CODE=$(api_code "$BASE/api/check-duplicate?user=health-check-bot&type=incidente&category=Computador%20Lento")
[[ "$DUP_CODE" == "200" ]] && check_pass "GET /api/check-duplicate → HTTP 200" || check_fail "GET /api/check-duplicate → HTTP $DUP_CODE"

# Validação de input (deve rejeitar com 400)
BAD_CODE=$(api_code -X POST "$BASE/api/tickets" \
  -H "Content-Type: application/json" \
  -d '{"type":"tipo_invalido","user_name":"x","description":"x"}')
[[ "$BAD_CODE" == "400" ]] && check_pass "Validação de input funciona (400 para dados inválidos)" || check_warn "Validação pode estar permissiva (HTTP $BAD_CODE para dados inválidos)"

# Limpar chamado de teste
if [[ -n "$TEST_ID" ]]; then
  DEL_CODE=$(api_code -X DELETE "$BASE/api/tickets/$TEST_ID")
  [[ "$DEL_CODE" == "200" ]] && check_pass "DELETE /api/tickets/:id → HTTP 200 (limpeza OK)" || check_warn "Não foi possível limpar chamado de teste ($TEST_ID)"
fi

# ── 4. Tempo de resposta ─────────────────────────────────────────────────────
section "4. Performance"
RESP_TIME=$(api_time "$BASE/api/stats" | awk '{printf "%.3f", $1}')
RESP_MS=$(echo "$RESP_TIME * 1000" | bc 2>/dev/null | awk '{printf "%.0f", $1}' || echo "?")
if (( $(echo "$RESP_TIME < 1.0" | bc -l 2>/dev/null || echo 0) )); then
  check_pass "Tempo de resposta: ${RESP_MS}ms (< 1000ms)"
elif (( $(echo "$RESP_TIME < 2.0" | bc -l 2>/dev/null || echo 0) )); then
  check_warn "Tempo de resposta: ${RESP_MS}ms (aceitável, mas lento)"
else
  check_fail "Tempo de resposta: ${RESP_MS}ms (> 2000ms — verificar carga)"
fi

# ── 5. Nginx (proxy) ─────────────────────────────────────────────────────────
section "5. Nginx (proxy reverso)"
if remote "systemctl is-active --quiet nginx"; then
  check_pass "Nginx está ativo"
  NGINX_CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:$NGINX_PORT/api/stats 2>/dev/null" || echo "000")
  if [[ "$NGINX_CODE" == "200" ]]; then
    check_pass "Proxy Nginx → Node.js funcionando (HTTP $NGINX_CODE)"
  else
    check_fail "Proxy Nginx falhou (HTTP $NGINX_CODE na porta $NGINX_PORT)"
  fi
else
  check_fail "Nginx não está ativo"
fi

# ── 6. Espaço em disco ───────────────────────────────────────────────────────
section "6. Recursos do servidor"
DISK_USE=$(remote "df -h $INSTALL_DIR 2>/dev/null | tail -1 | awk '{print \$5}' | tr -d '%'" || echo "0")
if [[ "$DISK_USE" -lt 80 ]]; then
  check_pass "Uso de disco: ${DISK_USE}% (saudável)"
elif [[ "$DISK_USE" -lt 90 ]]; then
  check_warn "Uso de disco: ${DISK_USE}% (atenção)"
else
  check_fail "Uso de disco: ${DISK_USE}% (crítico!)"
fi

DB_SIZE=$(remote "du -sh /opt/data-$ENV/chamados.db 2>/dev/null | cut -f1" || echo "N/A")
check_pass "Tamanho do banco de dados: $DB_SIZE"

# ── Relatório final ───────────────────────────────────────────────────────────
TOTAL_CHECKS=$((PASS + FAIL + WARN))
echo ""
echo "─────────────────────────────────────────────"
echo -e "  ${GREEN}✓ Passou:${NC}   $PASS / $TOTAL_CHECKS"
[[ $WARN -gt 0 ]] && echo -e "  ${YELLOW}△ Avisos:${NC}   $WARN"
[[ $FAIL -gt 0 ]] && echo -e "  ${RED}✗ Falhou:${NC}   $FAIL"
echo "─────────────────────────────────────────────"

if [[ $FAIL -gt 0 ]]; then
  echo -e "\n  ${RED}${BOLD}RESULTADO: REPROVADO${NC} — Corrija as falhas antes de promover para produção.\n"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "\n  ${YELLOW}${BOLD}RESULTADO: APROVADO COM AVISOS${NC} — Verifique os pontos de atenção.\n"
  exit 0
else
  echo -e "\n  ${GREEN}${BOLD}RESULTADO: APROVADO${NC} — Ambiente saudável.\n"
  exit 0
fi
