# Custom-Domain (Python)

This project automates HTTPS for a domain on an Ubuntu server using **Nginx** + **Certbot** and Python helpers (**dnspython**, **cryptography**, **nginxparser**). You’ll manage domains with `manage_domain.py` and verify DNS with `verify_dns.py` inside a Python **virtual environment (venv)**.

> Paths below use your current layout:
> `/home/azureuser/Custom-Domain/python-scripts`

---

## 0) Prerequisites

- Ubuntu 22.04/24.04 server with `sudo` access
- Ports **80** and **443** reachable from the internet
- One of:

  - A real domain you control (recommended), **or**
  - A free dynamic DNS name (e.g. **DuckDNS**) pointing at your server

Get your server’s public IP:

```bash
curl -4 ifconfig.me
```

---

## 1) Install system packages (one-time)

```bash
sudo apt-get update
sudo apt-get install -y \
  python3 python3-venv python3-pip \
  nginx certbot python3-certbot-nginx \
  ufw curl dnsutils
```

Enable firewall and open required ports:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw --force enable
sudo ufw status
```

Make sure Nginx is running:

```bash
sudo systemctl enable --now nginx
sudo systemctl status nginx
```

---

## 2) Create & use a Python virtual environment (venv)

```bash
cd /home/azureuser/Custom-Domain/python-scripts
python3 -m venv venv
source venv/bin/activate

# inside venv
pip install --upgrade pip
pip install dnspython cryptography nginxparser
```

> Re-activate the venv in any new shell with:
>
> ```bash
> source /home/azureuser/Custom-Domain/python-scripts/venv/bin/activate
> ```

---

## 3) Configure staging vs production (Let’s Encrypt)

Open `config.py` and choose the ACME environment:

```python
# config.py
STAGING = True   # use staging for safe testing (untrusted certs)
# STAGING = False  # switch to production for trusted certs when ready
```

Optionally set a default email in `config.py` for certificate registration.

---

## 4) One-time setup (server bootstrap)

Run the installer to wire up Nginx includes, UFW, cron, logrotate, etc.:

```bash
# use the venv’s Python under sudo
sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python setup.py
```

What this does:

- Verifies OS & dependencies
- Ensures Nginx includes are set and reloads Nginx
- Configures firewall (UFW) for 80/443
- Creates a **systemd** service (`domain-manager.service`) and enables it
- Adds a **cron job** for daily certificate renewal
- Sets up **log rotation** and a **backup directory**

### Make the service use your venv (recommended)

If the generated systemd unit points at `/usr/bin/python3`, edit it to use your venv Python:

```bash
sudo systemctl edit --full domain-manager.service
```

Change the `ExecStart=` line to:

```
ExecStart=/home/azureuser/Custom-Domain/python-scripts/venv/bin/python /home/azureuser/Custom-Domain/python-scripts/manage_domain.py list
```

(Using `list` is harmless; the service isn’t strictly required because Certbot handles renewals via cron, but keeping a unit is convenient for consistency/logging.)

Reload systemd:

```bash
sudo systemctl daemon-reload
sudo systemctl restart domain-manager.service
sudo systemctl status domain-manager.service
```

---

## 5) Point your domain to this server

### Option A: Real domain

Create/Update DNS **A** records at your DNS provider:

```
yourdomain.com      A   <YOUR_SERVER_IP>
www.yourdomain.com  A   <YOUR_SERVER_IP>
```

### Option B: DuckDNS (free)

Update your DuckDNS name to your server IP:

```bash
# replace TOKEN and SUBDOMAIN
curl "https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip=<YOUR_SERVER_IP>"
```

Verify DNS:

```bash
dig +short yourdomain.com
```

It should return your server IP.

---

## 6) Verify DNS with the helper script

```bash
# inside venv
source /home/azureuser/Custom-Domain/python-scripts/venv/bin/activate
python verify_dns.py yourdomain.com <YOUR_SERVER_IP>
```

You should see a `SUCCESS` message and JSON `{ "message": "matched" }`.

---

## 7) Request a certificate & auto-configure Nginx

Run `request` with **sudo** (uses venv’s Python):

```bash
sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python \
  manage_domain.py request yourdomain.com you@example.com
```

This will:

- Obtain a Let’s Encrypt certificate (staging or production based on `config.py`)
- Write an Nginx server block for the domain
- Enable the site and reload Nginx

Check your site in a browser:

```
https://yourdomain.com
```

> If `STAGING=True`, the cert is **untrusted** (expected for testing). Switch to production when ready (next section).

---

## 8) Switch to production certs (trusted)

1. Edit `config.py`:

   ```python
   STAGING = False
   ```

2. Re-request the certificate:

   ```bash
   sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python \
     manage_domain.py request yourdomain.com you@example.com
   ```

---

## 9) Day‑to‑day commands

List configured domains:

```bash
sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python manage_domain.py list
```

Check a domain’s DNS & Nginx wiring:

```bash
sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python manage_domain.py check yourdomain.com
```

Renew all certs (Certbot also runs via cron):

```bash
sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python manage_domain.py renew
```

Delete a domain (removes Nginx site & cert):

```bash
sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python manage_domain.py delete yourdomain.com
```

Standalone DNS check any time:

```bash
# inside venv
python verify_dns.py yourdomain.com <EXPECTED_IP>
```

---

## 10) Troubleshooting

**PEP 668: “externally‑managed environment”** when using pip3

- Always install Python packages **inside the venv** (as above).
- Avoid `pip3 --break-system-packages` unless you absolutely know what you’re doing.

**Let’s Encrypt errors**

- `unauthorized` / `Invalid response` → DNS points to the wrong server (fix A record).
- `connection ... timeout` → firewall/ISP blocking port 80, or wrong A record.
- `DNS problem: SERVFAIL` → transient DNS issue; verify with:

  ```bash
  dig A yourdomain.com @8.8.8.8
  dig AAAA yourdomain.com @8.8.8.8
  ```

- Nginx plugin issues → try standalone validation:

  ```bash
  sudo systemctl stop nginx
  sudo certbot certonly --standalone -d yourdomain.com --staging
  sudo systemctl start nginx
  ```

**Ports 80/443 not open**

```bash
sudo ufw allow 80
sudo ufw allow 443
sudo ufw reload
sudo ss -tlnp | grep -E ':80|:443'
```

**Check Nginx config**

```bash
sudo nginx -t
sudo systemctl reload nginx
journalctl -u nginx -e
```

---

## 11) Optional: keep DuckDNS updated automatically

Create a small updater script:

```bash
sudo tee /usr/local/bin/duckdns-update.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SUBDOMAIN="testpython604"      # <-- change
TOKEN="YOUR_TOKEN_HERE"        # <-- change
IP=$(curl -4 -s ifconfig.me)
curl -s "https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${TOKEN}&ip=${IP}" | tee -a /var/log/duckdns-update.log
EOF
sudo chmod +x /usr/local/bin/duckdns-update.sh
```

Run every 5 minutes via cron:

```bash
sudo tee /etc/cron.d/duckdns-update > /dev/null <<'EOF'
*/5 * * * * root /usr/local/bin/duckdns-update.sh
EOF
sudo systemctl restart cron
```

---

## 12) Cleanup / uninstall (per domain)

```bash
# remove cert
sudo certbot delete --cert-name yourdomain.com

# remove nginx site
sudo rm -f /etc/nginx/sites-enabled/yourdomain.com
sudo rm -f /etc/nginx/sites-available/yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

Remove the venv (optional):

```bash
rm -rf /home/azureuser/Custom-Domain/python-scripts/venv
```

Disable service (optional):

```bash
sudo systemctl disable --now domain-manager.service
```

---

## 13) Quality-of-life tips

**Alias for sudo + venv python**

```bash
echo 'alias sudovenv="sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python"' >> ~/.bashrc
source ~/.bashrc
# usage:
sudovenv manage_domain.py list
```

**Auto-activate venv when entering the folder**
Add to `~/.bashrc`:

```bash
cd() { builtin cd "$@" && [ -f venv/bin/activate ] && source venv/bin/activate || true; }
```

---

## 14) Quick test flow (DuckDNS + staging)

```bash
# 1) DNS → your server IP
curl "https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip=$(curl -4 -s ifconfig.me)"

# 2) Verify
source /home/azureuser/Custom-Domain/python-scripts/venv/bin/activate
python verify_dns.py SUBDOMAIN.duckdns.org $(curl -4 -s ifconfig.me)

# 3) Request cert (staging)
sudo /home/azureuser/Custom-Domain/python-scripts/venv/bin/python \
  manage_domain.py request SUBDOMAIN.duckdns.org you@example.com

# 4) Visit in browser (expect staging warning)
https://SUBDOMAIN.duckdns.org
```

When ready, set `STAGING = False` in `config.py` and re-run the `request` command for a trusted cert.

---

**You’re all set.** This README covers end‑to‑end provisioning, venv usage, DNS verification, certificate issuance (staging/production), and common troubleshooting. Adjust paths if your username or project path differs.
