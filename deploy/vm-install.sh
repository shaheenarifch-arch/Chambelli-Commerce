#!/bin/bash
# Install or update Chambelli on the Google Cloud VM that runs Bhaddru (agent.getservices.ai).
# Run as root, from the VM's SSH window:
#   curl -fsSL https://raw.githubusercontent.com/shaheenarifch-arch/Chambelli-Commerce/main/deploy/vm-install.sh | sudo bash
# Re-run safe: the first run creates secrets; later runs pull the latest code and restart.
# Touches only /opt/chambelli, /etc/chambelli and /etc/caddy/conf.d/chambelli.caddy.
set -euo pipefail
umask 022

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0" >&2; exit 1; }

DOMAIN="${CHAMBELLI_DOMAIN:-chambelli.getservices.ai}"
REPO="${CHAMBELLI_REPO:-https://github.com/shaheenarifch-arch/Chambelli-Commerce.git}"
BRANCH="${CHAMBELLI_BRANCH:-main}"
APP_DIR=/opt/chambelli
ENV_DIR=/etc/chambelli
ENV_FILE=$ENV_DIR/env
SNIP=/etc/caddy/conf.d/chambelli.caddy

echo "=== Chambelli install $(date -Is) : $DOMAIN ==="

# 1. Docker (skipped when already installed)
if ! command -v docker >/dev/null 2>&1; then
	echo "==> Installing Docker"
	apt-get update -y >/dev/null
	apt-get install -y docker.io docker-compose-v2 git >/dev/null 2>&1 || apt-get install -y docker.io docker-compose-plugin git >/dev/null
	systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin missing; install docker-compose-v2" >&2; exit 1; }

# 2. Code
if [ -d "$APP_DIR/.git" ]; then
	echo "==> Updating code"
	git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
	echo "==> Cloning code"
	git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi

# 3. Secrets (created once; edit $ENV_FILE later to add CJ and PayPal keys)
install -d -m 0750 "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
	echo "==> Creating $ENV_FILE"
	ADMIN_PASS=$(openssl rand -base64 18 | tr -d '/+=')
	cat > "$ENV_FILE" <<EOF
# Chambelli secrets. Restart after editing: sudo bash $APP_DIR/deploy/vm-install.sh
POSTGRES_PASSWORD=$(openssl rand -hex 24)
ADMIN_API_KEY=$(openssl rand -hex 32)
# Dashboard login (user: shaheen) for https://$DOMAIN
ADMIN_DASHBOARD_PASSWORD=$ADMIN_PASS
CORS_ORIGINS=
RATE_LIMIT_PER_MINUTE=300

# CJ Dropshipping: paste a current access token (see docs/DEPLOY.md)
CJ_API_BASE_URL=https://developers.cjdropshipping.com/api2.0/v1
CJ_ACCESS_TOKEN=
CJ_SYNC_MAX_PAGES=50

# PayPal sandbox until launch (https://developer.paypal.com/dashboard/applications/sandbox)
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_WEBHOOK_ID=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
POSTHOG_KEY=
POSTHOG_HOST=
RAMBO_URL=
RAMBO_API_KEY=
EOF
	chmod 0640 "$ENV_FILE"
fi
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
grep -q '^PUBLIC_API_BASE_URL=' "$ENV_FILE" || echo "PUBLIC_API_BASE_URL=https://$DOMAIN" >> "$ENV_FILE"

# 4. Build and start (schema is synced by the api container on start)
echo "==> Building and starting containers (first build takes a few minutes)"
cd "$APP_DIR"
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d --build

# 5. HTTPS via the VM's existing Caddy. Public: API routes and the widget.
#    Everything else (the admin dashboard) needs the dashboard login.
HASH=$(caddy hash-password --plaintext "$ADMIN_DASHBOARD_PASSWORD")
install -d -m 0755 /etc/caddy/conf.d
cat > "$SNIP" <<EOF
$DOMAIN {
	encode gzip
	@api path /v1/* /widget.js /health /health/*
	handle @api {
		reverse_proxy 127.0.0.1:8095
	}
	handle {
		basic_auth {
			shaheen $HASH
		}
		reverse_proxy 127.0.0.1:3005
	}
}
EOF
chmod 0644 "$SNIP"
systemctl reload caddy || systemctl restart caddy

# 6. Health check
echo "==> Waiting for the API"
for i in $(seq 1 60); do
	if curl -fsS http://127.0.0.1:8095/health >/dev/null 2>&1; then
		echo "API is up."
		break
	fi
	sleep 5
done
curl -fsS http://127.0.0.1:8095/health >/dev/null 2>&1 || { echo "API did not start. Logs: docker compose -f $APP_DIR/docker-compose.prod.yml logs api" >&2; exit 1; }

cat <<EOF

Done.
  Dashboard: https://$DOMAIN   (user: shaheen, password: $ADMIN_DASHBOARD_PASSWORD)
  API health: https://$DOMAIN/health
  Secrets file: $ENV_FILE  (add CJ_ACCESS_TOKEN and PayPal keys, then re-run this script)
Make sure DNS has an A record: ${DOMAIN%%.*} -> this VM's external IP.
EOF
