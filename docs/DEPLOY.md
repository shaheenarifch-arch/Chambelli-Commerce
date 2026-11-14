# Deploying Chambelli on the Google Cloud VM

Chambelli runs on the same Google Cloud VM as Bhaddru (agent.getservices.ai), in Docker,
behind the VM's existing Caddy web server. Nothing else on the VM is changed.

| What                | Where                                                   |
| ------------------- | ------------------------------------------------------- |
| Admin dashboard     | `https://chambelli.getservices.ai` (login: `shaheen`)   |
| Public API + widget | `https://chambelli.getservices.ai/v1/...`, `/widget.js` |
| Health check        | `https://chambelli.getservices.ai/health`               |
| Code                | `/opt/chambelli`                                        |
| Secrets             | `/etc/chambelli/env` (root only)                        |
| Caddy site          | `/etc/caddy/conf.d/chambelli.caddy`                     |

Containers: `postgres`, `redis`, `api` (127.0.0.1:8095), `admin` (127.0.0.1:3005) and
`worker` (CJ sync every six hours). Bhaddru keeps port 8080.

## 1. DNS (once)

Add an **A record** for `chambelli` pointing to the VM's external IP, in the DNS for
getservices.ai (the same place `agent` and `live` are set up). Find the IP in the
[Google Cloud console → VM instances](https://console.cloud.google.com/compute/instances).

## 2. Install or update

Open the VM's SSH window (Google Cloud console → VM instances → **SSH**) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/shaheenarifch-arch/Chambelli-Commerce/main/deploy/vm-install.sh | sudo bash
```

The first run installs Docker if needed, creates `/etc/chambelli/env` with fresh secrets,
builds the image (a few minutes), starts everything and prints the dashboard password.
Run the same command again any time to update to the latest `main`.

## 3. Add keys

Edit the secrets file, then re-run the install command:

```bash
sudo nano /etc/chambelli/env
```

- `CJ_ACCESS_TOKEN`: from CJ ([API docs](https://developers.cjdropshipping.com/en/api/start/authentication.html)).
  Until automatic refresh is added, a new token is needed when the old one expires.
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`: sandbox app keys from
  [PayPal Developer → Apps & Credentials](https://developer.paypal.com/dashboard/applications/sandbox).

## Useful commands

```bash
cd /opt/chambelli
sudo docker compose --env-file /etc/chambelli/env -f docker-compose.prod.yml ps
sudo docker compose --env-file /etc/chambelli/env -f docker-compose.prod.yml logs -f api
sudo docker compose --env-file /etc/chambelli/env -f docker-compose.prod.yml exec api pnpm db:seed   # sample data, optional
```

## Notes

- The database schema is synced with `prisma db push` when the API starts. It refuses
  changes that would drop data, so a risky schema change stops the API instead of losing rows.
- Read [Before taking real orders](../README.md#before-taking-real-orders) before going live.
