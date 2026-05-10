# Deploying Potluck

This is the step-by-step guide for putting Potluck on a Linux server you control. It targets a typical home-server / small-VPS setup:

- Debian or Ubuntu (commands assume `apt`; adapt for other distros)
- A real domain name on Cloudflare (any plan, free is fine)
- Cloudflare Tunnel for public HTTPS — no port forwarding, no router config, no static IP needed
- `systemd` for process management
- SQLite (one file) + local disk for image uploads — backed up with a one-line cron
- Family-only via the `POTLUCK_ALLOWED_EMAILS` allowlist

If you want public open registration on a normal VPS with port-forwarded HTTPS via Caddy or nginx, the shape is the same — just swap the Cloudflare Tunnel section for a reverse-proxy config.

---

## Architecture

```
Internet
   │  https://potluck.example.com
   ▼
Cloudflare edge (TLS termination, DDoS shield, free)
   │
   ▼
Cloudflared tunnel (outbound-only connection from your server)
   │
   ▼
Next.js app (next start), bound to 127.0.0.1:3000
   │
   ▼
/var/lib/potluck/
   ├── potluck.db      ← SQLite database, the entire app state minus images
   └── uploads/         ← user-uploaded recipe photos
```

Everything that matters for backups lives in `/var/lib/potluck/`. The rest of the install is reproducible from git.

---

## 0. What you'll need before you start

- SSH access to the server with `sudo`
- A domain name on Cloudflare (or willing to move one there — it's free and takes ~10 min)
- A Google Cloud project with an OAuth 2.0 Client ID (you already have one for local dev — you'll just add a new redirect URI)
- An `OPENAI_API_KEY` with billing enabled
- The list of email addresses that should be allowed to sign in

Decide your subdomain now — e.g. `potluck.example.com`. Everything below uses that as the placeholder; substitute your real one.

---

## 1. Server prep (one-time)

SSH in as your sudo user.

### 1.1 System packages

```bash
sudo apt update
sudo apt install -y curl git build-essential sqlite3 ca-certificates
```

`build-essential` is needed because `better-sqlite3` and `sharp` compile native modules during install. On Raspberry Pi / ARM you may also need `libvips-dev` for sharp; `apt install -y libvips-dev` is fine.

### 1.2 Node.js 20 LTS via nodesource

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should be v20.x
```

### 1.3 pnpm

```bash
sudo npm install -g pnpm
pnpm --version
```

### 1.4 A dedicated `potluck` user (no shell, no login)

Running the app as a dedicated unprivileged user is the easiest way to keep blast radius small.

```bash
sudo useradd --system --create-home --home-dir /opt/potluck --shell /usr/sbin/nologin potluck
```

### 1.5 The data directory

Lives outside the code checkout so deploys can't accidentally wipe it.

```bash
sudo mkdir -p /var/lib/potluck/uploads
sudo chown -R potluck:potluck /var/lib/potluck
sudo chmod 750 /var/lib/potluck
```

---

## 2. Install the app

### 2.1 Clone the repo into `/opt/potluck/app`

```bash
sudo -u potluck mkdir -p /opt/potluck/app
sudo -u potluck git clone https://github.com/<your-user>/potluck.git /opt/potluck/app
cd /opt/potluck/app
```

### 2.2 Install dependencies and build

```bash
sudo -u potluck pnpm install --frozen-lockfile
sudo -u potluck pnpm build
```

The build will take 1-3 minutes. If `better-sqlite3` or `sharp` fail to compile, install the missing system package they complain about and re-run.

---

## 3. Configure `.env.local`

This file holds all the secrets. It lives inside the git checkout but is gitignored.

```bash
sudo -u potluck cp /opt/potluck/app/.env.example /opt/potluck/app/.env.local
sudo -u potluck chmod 600 /opt/potluck/app/.env.local
sudo -u potluck nano /opt/potluck/app/.env.local
```

Fill in the values:

```bash
# Required: Auth.js secret. Generate a NEW one for production — do not reuse local.
AUTH_SECRET="<output of: openssl rand -base64 32>"

# Required: tells Auth.js what the public URL is (so OAuth callbacks work).
AUTH_TRUST_HOST="true"
AUTH_URL="https://potluck.example.com"

# Required: Google OAuth credentials (same client as local dev is fine, just add the prod redirect URI in step 6).
AUTH_GOOGLE_ID="..."
AUTH_GOOGLE_SECRET="..."

# Required: OpenAI key for AI extraction.
OPENAI_API_KEY="sk-..."

# Optional but recommended on a shared server: cap per-user monthly AI spend.
POTLUCK_USER_MONTHLY_USD_CAP="2.00"

# Recommended for private deployments: only these emails can sign in.
POTLUCK_ALLOWED_EMAILS="me@gmail.com,wife@gmail.com,brother@gmail.com"

# Required: keep the database + uploads outside the git checkout.
POTLUCK_DATA_DIR="/var/lib/potluck"
```

Notes on each:

- **`AUTH_SECRET`**: a random 32-byte secret. Generate with `openssl rand -base64 32`. **Do not reuse** your local-dev value — that just leaked it onto a server.
- **`AUTH_URL`**: the full public URL of the app, including `https://`. Auth.js uses it to construct OAuth redirect URIs.
- **`POTLUCK_ALLOWED_EMAILS`**: comma-separated list, case-insensitive. When set, anyone NOT on the list who tries to sign in gets bounced to `/signin?error=AccessDenied` with a friendly "you're not on the guest list" message. Leave it unset to allow open registration.
- **`POTLUCK_DATA_DIR`**: must point at the directory you created in step 1.5. The DB file lives at `<dir>/potluck.db` and uploads at `<dir>/uploads/`.

---

## 4. Run migrations

This creates the SQLite schema in `/var/lib/potluck/potluck.db`.

```bash
cd /opt/potluck/app
sudo -u potluck pnpm db:migrate
```

You should see something like `✓ Applied N migration(s)`. After this:

```bash
ls -la /var/lib/potluck/
# you should see potluck.db and an empty uploads/
```

---

## 5. systemd service for the app

Create `/etc/systemd/system/potluck.service`:

```bash
sudo tee /etc/systemd/system/potluck.service > /dev/null <<'EOF'
[Unit]
Description=Potluck recipe app
Documentation=https://github.com/<your-user>/potluck
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=potluck
Group=potluck
WorkingDirectory=/opt/potluck/app
EnvironmentFile=/opt/potluck/app/.env.local
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/pnpm start
Restart=on-failure
RestartSec=5

# Hardening — tighten the sandbox the app runs in.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/potluck
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
EOF
```

Important details:

- **`HOSTNAME=127.0.0.1`** binds Next.js to localhost only. Outside traffic only reaches the app via Cloudflare Tunnel — it can't be hit directly even if a port forward leaks.
- **`ReadWritePaths=/var/lib/potluck`**: the only directory the service can write to. Source code is read-only at runtime.
- **`EnvironmentFile`** picks up everything in `.env.local` automatically.

Start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now potluck
sudo systemctl status potluck     # should be active (running)
```

Smoke-test the local bind:

```bash
curl -I http://127.0.0.1:3000/        # should return 200 or a redirect
```

To watch logs:

```bash
sudo journalctl -u potluck -f
```

---

## 6. Cloudflare Tunnel

This gives you `https://potluck.example.com` without forwarding any ports.

### 6.1 Make sure your domain's DNS is on Cloudflare

In the Cloudflare dashboard, your domain should show "Active" with Cloudflare nameservers. If not, follow Cloudflare's "Add a site" flow first.

### 6.2 Install cloudflared

```bash
curl -L https://pkg.cloudflare.com/install.sh | sudo bash
sudo apt install -y cloudflared
cloudflared --version
```

### 6.3 Authenticate, create the tunnel, and route DNS

```bash
sudo cloudflared tunnel login
# Opens a browser. Pick the domain you want (example.com) and authorize.
# It writes a cert to /root/.cloudflared/cert.pem.

sudo cloudflared tunnel create potluck
# Note the tunnel UUID it prints — you'll need it.

sudo cloudflared tunnel route dns potluck potluck.example.com
# Adds a CNAME record automatically.
```

### 6.4 Configure the tunnel

Create `/etc/cloudflared/config.yml`:

```bash
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml > /dev/null <<EOF
tunnel: potluck
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: potluck.example.com
    service: http://localhost:3000
  - service: http_status:404
EOF
```

Replace `<TUNNEL-UUID>` with the UUID from `cloudflared tunnel create`. The credentials file was written there automatically.

### 6.5 Install as a service

```bash
sudo cloudflared service install
sudo systemctl status cloudflared
```

Test it from your laptop:

```bash
curl -I https://potluck.example.com/
# Should return a 200 or a redirect from the Next.js app. The hop you're
# seeing: laptop → Cloudflare edge → cloudflared on the server → next start.
```

---

## 7. Google OAuth — add the production redirect URI

Without this step sign-in will fail with `redirect_uri_mismatch`.

1. Go to https://console.cloud.google.com/apis/credentials
2. Open your OAuth 2.0 Client ID (the one whose `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` you put in `.env.local`)
3. Under **Authorized redirect URIs**, add:
   ```
   https://potluck.example.com/api/auth/callback/google
   ```
4. Save. Changes propagate within a minute or two.

Keep your existing `http://localhost:3000/api/auth/callback/google` entry too — that's still used for local dev.

---

## 8. First sign-in + smoke test

1. Open `https://potluck.example.com` from your laptop.
2. Click **Continue with Google**, sign in with an email that's on `POTLUCK_ALLOWED_EMAILS`.
3. You should land on `/feed`.
4. Try to sign in with an email that's NOT on the list (e.g. ask a friend to try) — they should be bounced back to `/signin?error=AccessDenied` with the "guest list" message.
5. Add a recipe by URL or photo to confirm AI extraction works end-to-end.
6. From your phone (on cellular, not your home wifi, to test the full path), open the URL and confirm it loads.

---

## 9. Updates / redeployment

When you want to ship new code:

```bash
cd /opt/potluck/app
sudo -u potluck git pull
sudo -u potluck pnpm install --frozen-lockfile
sudo -u potluck pnpm build
sudo -u potluck pnpm db:migrate          # safe to run even if nothing to migrate
sudo systemctl restart potluck
sudo systemctl status potluck
sudo journalctl -u potluck -n 50
```

If `pnpm build` fails, the previous build is still on disk and the running service is fine — just don't restart until you've fixed it.

For convenience, drop this into `/opt/potluck/update.sh`:

```bash
sudo tee /opt/potluck/update.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/potluck/app
sudo -u potluck git pull
sudo -u potluck pnpm install --frozen-lockfile
sudo -u potluck pnpm build
sudo -u potluck pnpm db:migrate
sudo systemctl restart potluck
sudo journalctl -u potluck -n 30 --no-pager
EOF
sudo chmod +x /opt/potluck/update.sh
```

Then `sudo /opt/potluck/update.sh` is the whole deploy.

---

## 10. Backups

Everything you need to restore the app is in `/var/lib/potluck/` — the SQLite file plus the `uploads/` directory. Total size grows ~slowly, mostly from images.

### 10.1 Local nightly snapshots (zero setup)

```bash
sudo mkdir -p /var/backups/potluck
sudo tee /etc/cron.daily/potluck-backup > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ts=$(date +%Y%m%d-%H%M%S)
out=/var/backups/potluck/potluck-$ts.tar.gz

# sqlite3 .backup is safe to run while the app is up — uses an online
# backup API, so we won't catch the DB mid-write.
tmp=$(mktemp -d)
sqlite3 /var/lib/potluck/potluck.db ".backup '$tmp/potluck.db'"
tar -czf "$out" -C "$tmp" potluck.db -C /var/lib/potluck uploads
rm -rf "$tmp"

# Keep last 14 days
find /var/backups/potluck -name 'potluck-*.tar.gz' -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/potluck-backup
```

Test it once: `sudo /etc/cron.daily/potluck-backup && ls -la /var/backups/potluck`.

### 10.2 Off-machine backups (recommended)

Local backups don't help if the disk dies. Easiest no-fuss option is `rclone` to a personal Google Drive / Dropbox / Backblaze B2:

```bash
sudo apt install -y rclone
sudo rclone config        # one-time interactive setup (call the remote "backup")
```

Then add this line at the bottom of `/etc/cron.daily/potluck-backup`:

```bash
rclone copy /var/backups/potluck backup:potluck-backups --max-age 2d
```

### 10.3 Restoring from a backup

```bash
sudo systemctl stop potluck
sudo rm -rf /var/lib/potluck.bak
sudo mv /var/lib/potluck /var/lib/potluck.bak
sudo mkdir -p /var/lib/potluck/uploads
sudo tar -xzf /var/backups/potluck/potluck-YYYYMMDD-HHMMSS.tar.gz -C /var/lib/potluck
sudo chown -R potluck:potluck /var/lib/potluck
sudo systemctl start potluck
```

---

## 11. Troubleshooting

### `redirect_uri_mismatch` from Google after sign-in

`AUTH_URL` and the URI you added in Google Cloud must match exactly, including the `https://`, the subdomain, and the trailing `/api/auth/callback/google`. No trailing slash on `AUTH_URL`.

### "We couldn't reach the server" / 502 from Cloudflare

Either the app isn't running or cloudflared can't reach it. Check:

```bash
sudo systemctl status potluck
sudo systemctl status cloudflared
curl -I http://127.0.0.1:3000/
```

If `curl` works but cloudflared doesn't, double-check `service: http://localhost:3000` in `/etc/cloudflared/config.yml`.

### Sign-in succeeds but I see "guest list" message

Your email isn't in `POTLUCK_ALLOWED_EMAILS`, or you typo'd it. Edit `.env.local`, then `sudo systemctl restart potluck`. (Auth.js reads this at process start.)

### `better-sqlite3` or `sharp` fail to install

Almost always missing system tools. `sudo apt install -y build-essential python3 libvips-dev` and re-run `pnpm install`.

### Database file is locked / read-only

Almost always permissions. The `potluck` user must own `/var/lib/potluck` and everything inside it:

```bash
sudo chown -R potluck:potluck /var/lib/potluck
```

### How do I see the most recent AI extractions and their costs?

```bash
sudo -u potluck sqlite3 /var/lib/potluck/potluck.db \
  "select datetime(createdAt) as t, model, totalTokens, costUsd from aiUsage order by createdAt desc limit 20;"
```

### How do I add or remove an allowed email without redeploying?

Edit `/opt/potluck/app/.env.local`, then `sudo systemctl restart potluck`. Restart is ~2 seconds; sessions are preserved (DB session strategy).

### How do I rotate `AUTH_SECRET`?

Generate a new one, edit `.env.local`, restart. **All existing sessions are invalidated** and users will need to sign in again — that's the whole point.

---

## 12. Optional hardening

### Limit who can SSH

If this server is a fresh box, lock SSH down:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 22/tcp
sudo ufw default deny incoming
sudo ufw enable
```

You don't need to open 80/443 — Cloudflare Tunnel is outbound-only.

### Cloudflare Access in front of the app

For an extra layer (e.g. require Google SSO at the Cloudflare edge before traffic even hits your server), enable Cloudflare Zero Trust → Access → Self-hosted application on `potluck.example.com`. Pair this with `POTLUCK_ALLOWED_EMAILS` for belt-and-braces auth.

### Read the AI cost ledger as a dashboard

Every user sees their MTD spend on their profile (`/u/<handle>`). Combined with `POTLUCK_USER_MONTHLY_USD_CAP`, this gives you both visibility and a hard ceiling.
