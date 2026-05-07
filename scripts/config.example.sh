# scripts/config.example.sh
# ─────────────────────────────────────────────────────────────
# COPIE este arquivo para scripts/.config.env e edite os valores
# O arquivo .config.env NÃO deve ser commitado no git (.gitignore já exclui)
# ─────────────────────────────────────────────────────────────

# ── Staging ──────────────────────────────────────────────────
STAGING_HOST=192.168.200.11        # IP da VM de staging
STAGING_USER=deploy                # Usuário SSH (com sudo sem senha para o serviço)
STAGING_PORT=22                    # Porta SSH
STAGING_APP_PORT=3001              # Porta do Node.js no staging
STAGING_NGINX_PORT=8080            # Porta HTTP pública do staging

# ── Produção ─────────────────────────────────────────────────
PROD_HOST=192.168.200.10           # IP da VM de produção
PROD_USER=deploy                   # Usuário SSH
PROD_PORT=22                       # Porta SSH
PROD_APP_PORT=3000                 # Porta do Node.js em produção
PROD_NGINX_PORT=80                 # Porta HTTP pública da produção

# ── Deploy ───────────────────────────────────────────────────
RELEASES_TO_KEEP=5                 # Quantas releases antigas manter
HEALTH_CHECK_RETRIES=5             # Tentativas de health check após deploy
HEALTH_CHECK_DELAY=3               # Segundos entre cada tentativa
