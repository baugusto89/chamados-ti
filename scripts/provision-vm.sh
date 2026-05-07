#!/usr/bin/env bash
# =============================================================================
#  scripts/provision-vm.sh <staging|production>
#
#  Prepara uma VM Debian limpa para receber deploys.
#  Execute UMA VEZ por VM, com acesso root.
#
#  Pré-requisito na VM:
#    - Debian 11 ou 12 com acesso SSH root
#    - IP fixo já configurado (use deploy-debian/setup.sh se necessário)
#
#  O que faz:
#    ✓ Instala Node.js 20 LTS e Nginx
#    ✓ Cria usuário 'deploy' com acesso SSH por chave
#    ✓ Cria usuário 'chamados' para executar o serviço
#    ✓ Configura sudo sem senha apenas para os comandos necessários
#    ✓ Cria estrutura de diretórios e serviço systemd
#    ✓ Configura Nginx
#    ✓ Configura UFW
#    ✓ Instala script de backup com cron
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.config.env"
[[ -f "$CONFIG_FILE" ]] || { echo "❌ $CONFIG_FILE não encontrado."; exit 1; }
source "$CONFIG_FILE"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'
info()    { echo -e "${CYAN}[provision]${NC} $*"; }
success() { echo -e "${GREEN}[provision]${NC} ✅ $*"; }
error()   { echo -e "${RED}[provision]${NC} ❌ $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${CYAN}── $* ──${NC}"; }

ENV="${1:-}"
case "$ENV" in
  staging)
    SSH_HOST="$STAGING_HOST"; SSH_USER="root"; SSH_PORT="${STAGING_PORT:-22}"
    APP_PORT="$STAGING_APP_PORT"; NGINX_PORT="$STAGING_NGINX_PORT"
    SERVICE_NAME="chamados-staging"; INSTALL_DIR="/opt/chamados-staging"
    RELEASES_DIR="/opt/releases-staging"; DATA_DIR="/opt/data-staging"
    ;;
  production)
    SSH_HOST="$PROD_HOST"; SSH_USER="root"; SSH_PORT="${PROD_PORT:-22}"
    APP_PORT="$PROD_APP_PORT"; NGINX_PORT="$PROD_NGINX_PORT"
    SERVICE_NAME="chamados-prod"; INSTALL_DIR="/opt/chamados-prod"
    RELEASES_DIR="/opt/releases-prod"; DATA_DIR="/opt/data-prod"
    ;;
  *) echo "Uso: $0 <staging|production>"; exit 1 ;;
esac

SSH_OPTS="-p $SSH_PORT -o StrictHostKeyChecking=no -o ConnectTimeout=15"
remote() { ssh $SSH_OPTS "$SSH_USER@$SSH_HOST" "$@"; }

# Chave pública para o usuário deploy
LOCAL_PUBKEY=""
for key in ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub ~/.ssh/id_ecdsa.pub; do
  [[ -f "$key" ]] && LOCAL_PUBKEY=$(cat "$key") && break
done
[[ -z "$LOCAL_PUBKEY" ]] && error "Nenhuma chave SSH pública encontrada em ~/.ssh/. Crie uma com: ssh-keygen -t ed25519"

echo ""
echo -e "${BOLD}${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  Provisionamento de VM — $(printf '%-30s' "$ENV")║${NC}"
echo -e "${BOLD}${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Host:     ${BOLD}$SSH_HOST:$SSH_PORT${NC}"
echo -e "  Serviço:  ${BOLD}$SERVICE_NAME${NC} (porta $APP_PORT)"
echo -e "  Nginx:    ${BOLD}porta $NGINX_PORT${NC}"
echo ""
read -rp "$(echo -e "${YELLOW}Iniciar provisionamento? [s/N]:${NC} ")" C
[[ ! "$C" =~ ^[sS]$ ]] && exit 0

# ── 1. Pacotes base + Node.js ──────────────────────────────────────────────────
step "1. Instalando Node.js 20 e Nginx"
remote bash <<REMOTE
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl wget gnupg2 ufw nginx rsync python3 bc 2>/dev/null

  # Node.js 20 LTS via NodeSource
  if ! command -v node &>/dev/null || [[ \$(node -e "process.exit(process.version.startsWith('v20')?0:1)" 2>/dev/null; echo \$?) -ne 0 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs 2>/dev/null
  fi
  echo "Node: \$(node --version)  npm: \$(npm --version)"
REMOTE
success "Node.js e Nginx instalados"

# ── 2. Usuários ────────────────────────────────────────────────────────────────
step "2. Criando usuários"
remote bash <<REMOTE
  # Usuário 'deploy' — recebe deploys via rsync/ssh, pode reiniciar serviço
  if ! id deploy &>/dev/null; then
    useradd --create-home --shell /bin/bash deploy
    echo "Usuário 'deploy' criado"
  fi

  # Configurar chave SSH para deploy
  mkdir -p /home/deploy/.ssh
  echo '$LOCAL_PUBKEY' >> /home/deploy/.ssh/authorized_keys
  sort -u /home/deploy/.ssh/authorized_keys -o /home/deploy/.ssh/authorized_keys
  chmod 700 /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys
  chown -R deploy:deploy /home/deploy/.ssh

  # Usuário 'chamados' — executa o serviço Node.js, sem shell
  if ! id chamados &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin chamados
    echo "Usuário 'chamados' criado"
  fi
REMOTE

# Configurar sudo para deploy (apenas o necessário)
remote bash <<REMOTE
  cat > /etc/sudoers.d/deploy-chamados <<'SUDO'
# Permite ao usuário 'deploy' reiniciar/iniciar apenas o serviço da aplicação
deploy ALL=(root) NOPASSWD: /bin/systemctl start $SERVICE_NAME
deploy ALL=(root) NOPASSWD: /bin/systemctl stop $SERVICE_NAME
deploy ALL=(root) NOPASSWD: /bin/systemctl restart $SERVICE_NAME
deploy ALL=(root) NOPASSWD: /bin/systemctl reload $SERVICE_NAME
deploy ALL=(root) NOPASSWD: /bin/ln -sfn /opt/releases-* /opt/chamados-*
deploy ALL=(root) NOPASSWD: /bin/chown -R chamados\:chamados /opt/*
deploy ALL=(root) NOPASSWD: /bin/mkdir -p /opt/data-*
SUDO
  chmod 440 /etc/sudoers.d/deploy-chamados
  visudo -cf /etc/sudoers.d/deploy-chamados && echo "sudoers OK"
REMOTE
success "Usuários e permissões configurados"

# ── 3. Estrutura de diretórios ─────────────────────────────────────────────────
step "3. Criando estrutura de diretórios"
remote bash <<REMOTE
  mkdir -p "$RELEASES_DIR" "$DATA_DIR" "$INSTALL_DIR" /opt/backups-$ENV
  chown deploy:deploy "$RELEASES_DIR"
  chown chamados:chamados "$DATA_DIR"
  chmod 750 "$DATA_DIR"
  echo "Diretórios criados"
REMOTE
success "Estrutura criada"

# ── 4. Serviço systemd ────────────────────────────────────────────────────────
step "4. Configurando serviço systemd"
remote bash <<REMOTE
  cat > /etc/systemd/system/$SERVICE_NAME.service <<'SERVICE'
[Unit]
Description=Central de Chamados TI ($ENV)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chamados
Group=chamados
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server.js
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=10
StartLimitBurst=5
StartLimitIntervalSec=60
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME
EnvironmentFile=$INSTALL_DIR/.env
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes
ReadWritePaths=$DATA_DIR
PrivateDevices=yes
LimitNOFILE=65536
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable $SERVICE_NAME
  echo "Serviço $SERVICE_NAME configurado e habilitado no boot"
REMOTE
success "Serviço systemd configurado"

# ── 5. Nginx ──────────────────────────────────────────────────────────────────
step "5. Configurando Nginx"
remote bash <<REMOTE
  rm -f /etc/nginx/sites-enabled/default

  cat > /etc/nginx/sites-available/$SERVICE_NAME <<'NGINX'
server {
    listen $NGINX_PORT;
    server_name $SSH_HOST _;

    access_log /var/log/nginx/$SERVICE_NAME.access.log;
    error_log  /var/log/nginx/$SERVICE_NAME.error.log warn;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Environment "$ENV" always;

    client_max_body_size 1m;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        proxy_pass         http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }

    location ~ /\.(env|git|db)$ { deny all; return 404; }
}
NGINX

  ln -sf /etc/nginx/sites-available/$SERVICE_NAME /etc/nginx/sites-enabled/
  nginx -t && systemctl reload nginx
  echo "Nginx configurado"
REMOTE
success "Nginx configurado"

# ── 6. Firewall ───────────────────────────────────────────────────────────────
step "6. Configurando UFW"
remote bash <<REMOTE
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp comment 'SSH'
  ufw allow $NGINX_PORT/tcp comment 'HTTP $SERVICE_NAME'
  ufw --force enable >/dev/null
  echo "Firewall ativo: SSH(22) e HTTP($NGINX_PORT) abertas"
REMOTE
success "Firewall configurado"

# ── 7. Script de backup ───────────────────────────────────────────────────────
step "7. Configurando backup automático"
remote bash <<REMOTE
  cat > /opt/backup-$ENV.sh <<'BACKUP'
#!/usr/bin/env bash
DB="$DATA_DIR/chamados.db"
DEST="/opt/backups-$ENV"
DATE=\$(date +"%Y-%m-%d_%H-%M-%S")
mkdir -p "\$DEST"
[[ -f "\$DB" ]] && cp "\$DB" "\$DEST/chamados_\$DATE.db"
find "\$DEST" -name "chamados_*.db" -mtime +30 -delete
echo "[\$(date)] Backup: \$DEST/chamados_\$DATE.db"
BACKUP
  chmod +x /opt/backup-$ENV.sh
  # Cron: backup diário às 3h
  (crontab -l 2>/dev/null; echo "0 3 * * * /opt/backup-$ENV.sh >> /var/log/backup-$ENV.log 2>&1") | sort -u | crontab -
  echo "Backup agendado para 03:00 diariamente"
REMOTE
success "Backup configurado"

# ── Resumo ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║  ✅  VM de $ENV provisionada com sucesso!$(printf '%*s' $((18 - ${#ENV})) '')║${NC}"
echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Próximo passo:${NC} faça o primeiro deploy com:"
echo -e "  ${CYAN}make deploy-$ENV${NC}"
echo ""
echo -e "  ${BOLD}Acesso SSH para deploys:${NC}"
echo -e "  ${CYAN}ssh deploy@$SSH_HOST${NC}"
echo ""
