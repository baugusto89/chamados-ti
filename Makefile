# =============================================================================
#  Makefile — Central de Chamados TI
#  Uso: make <comando>
#  Exemplo: make deploy-staging
# =============================================================================

# Carregar configuração local (criar a partir de scripts/config.example.sh)
-include scripts/.config.env
export

.PHONY: help install dev lint \
        deploy-staging deploy-prod \
        rollback-staging rollback-prod \
        health-staging health-prod \
        logs-staging logs-prod \
        status promote release

# ── Cores ────────────────────────────────────────────────────────────
CYAN  := \033[0;36m
GREEN := \033[0;32m
YELLOW:= \033[1;33m
NC    := \033[0m
BOLD  := \033[1m

help: ## Exibe este menu de ajuda
	@echo ""
	@echo "$(BOLD)$(CYAN)Central de Chamados TI — Comandos de Deploy$(NC)"
	@echo ""
	@echo "$(BOLD)Desenvolvimento local:$(NC)"
	@grep -E '^(install|dev|lint):.*##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*##"}{printf "  $(CYAN)%-22s$(NC) %s\n",$$1,$$2}'
	@echo ""
	@echo "$(BOLD)Staging:$(NC)"
	@grep -E '^(deploy-staging|rollback-staging|health-staging|logs-staging):.*##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*##"}{printf "  $(CYAN)%-22s$(NC) %s\n",$$1,$$2}'
	@echo ""
	@echo "$(BOLD)Produção:$(NC)"
	@grep -E '^(promote|deploy-prod|rollback-prod|health-prod|logs-prod):.*##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*##"}{printf "  $(CYAN)%-22s$(NC) %s\n",$$1,$$2}'
	@echo ""
	@echo "$(BOLD)Utilitários:$(NC)"
	@grep -E '^(status|release):.*##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*##"}{printf "  $(CYAN)%-22s$(NC) %s\n",$$1,$$2}'
	@echo ""

# ── Desenvolvimento local ─────────────────────────────────────────────
install: ## Instala dependências locais
	npm install

dev: ## Inicia servidor em modo desenvolvimento (com hot-reload)
	NODE_ENV=development \
	PORT=3000 \
	DB_PATH=./data/dev-chamados.db \
	npx nodemon server.js

lint: ## Verifica sintaxe do código
	node --check server.js && \
	node --check public/js/app.js && \
	echo "✅ Sintaxe OK"

# ── Staging ───────────────────────────────────────────────────────────
deploy-staging: lint ## Faz deploy no ambiente de staging
	@bash scripts/deploy.sh staging

rollback-staging: ## Reverte staging para a versão anterior
	@bash scripts/rollback.sh staging

health-staging: ## Executa health check no staging
	@bash scripts/health-check.sh staging

logs-staging: ## Exibe logs ao vivo do staging
	@ssh $(STAGING_USER)@$(STAGING_HOST) "journalctl -u chamados-staging -f --no-pager"

# ── Promoção Staging → Produção ───────────────────────────────────────
promote: ## Testa staging e promove para produção (fluxo completo)
	@bash scripts/promote.sh

# ── Produção ──────────────────────────────────────────────────────────
deploy-prod: lint ## Deploy direto em produção (use 'promote' no fluxo normal)
	@bash scripts/deploy.sh production

rollback-prod: ## Reverte produção para a versão anterior
	@bash scripts/rollback.sh production

health-prod: ## Executa health check em produção
	@bash scripts/health-check.sh production

logs-prod: ## Exibe logs ao vivo da produção
	@ssh $(PROD_USER)@$(PROD_HOST) "journalctl -u chamados-prod -f --no-pager"

# ── Utilitários ───────────────────────────────────────────────────────
status: ## Exibe status de ambos os ambientes
	@bash scripts/status.sh

release: ## Lista releases disponíveis em ambos os ambientes
	@echo "\n$(BOLD)Releases — Staging:$(NC)"
	@ssh $(STAGING_USER)@$(STAGING_HOST) "ls -lt /opt/releases-staging/ 2>/dev/null | tail -n +2 | head -10" || echo "  sem releases"
	@echo "\n$(BOLD)Releases — Produção:$(NC)"
	@ssh $(PROD_USER)@$(PROD_HOST)   "ls -lt /opt/releases-prod/ 2>/dev/null | tail -n +2 | head -10" || echo "  sem releases"
	@echo ""
