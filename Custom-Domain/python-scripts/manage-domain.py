#!/usr/bin/env python3
import argparse
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Optional: dnspython for DNS verify in "check"
try:
    import dns.resolver
except Exception:
    dns = None

# Optional: cryptography to read cert expiry in "check"
try:
    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
except Exception:
    x509 = None

import config

SCRIPT_DIR = Path(__file__).resolve().parent
LOG_FILE = Path(config.LOG_FILE)

ANSI = {
    "RED": "\033[0;31m",
    "GREEN": "\033[0;32m",
    "YELLOW": "\033[1;33m",
    "BLUE": "\033[0;34m",
    "NC": "\033[0m",
}

def _ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def log(msg, color="BLUE"):
    line = f'{ANSI.get(color,"")}[{_ts()}]{ANSI["NC"]} {msg}'
    print(line)
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a") as f:
            f.write(f"[{_ts()}] {msg}\n")
    except Exception:
        pass

def success(msg): log(f"[SUCCESS] {msg}", "GREEN")
def warning(msg): log(f"[WARNING] {msg}", "YELLOW")
def error(msg):   log(f"[ERROR] {msg}", "RED")

def require_root():
    if os.geteuid() != 0:
        error("This script must be run as root (use sudo)")
        sys.exit(1)

def which_or_die(path, hint):
    if shutil.which(path) is None and not Path(path).exists():
        error(f"{path} not found. {hint}")
        sys.exit(1)

def check_dependencies():
    log("Checking dependencies...")
    which_or_die(config.CERTBOT_PATH, "Install: apt-get install certbot python3-certbot-nginx")
    which_or_die("/usr/sbin/nginx", "Install: apt-get install nginx")
    if shutil.which("dig") is None:
        warning("dig not found. DNS checks will use dnspython only (recommended). Install bind9-utils for parity.")
    success("All dependencies are available (or reasonable fallbacks present)")

def load_env_overrides():
    # Allow environment variables to override config (parity with Bash)
    for name in [
        "BACKEND_APP_PORT","BACKEND_APP_HOST","EMAIL","STAGING","FORCE_RENEWAL"
    ]:
        if name in os.environ:
            val = os.environ[name]
            if val.lower() in {"true","false"}:
                setattr(config, name, val.lower()=="true")
            else:
                # int where appropriate
                if name == "BACKEND_APP_PORT":
                    try: val = int(val)
                    except: pass
                setattr(config, name, val)

DOMAIN_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*$")

def validate_domain(domain: str) -> bool:
    if not DOMAIN_RE.match(domain):
        error(f"Invalid domain format: {domain}")
        return False
    return True

def nginx_test() -> bool:
    res = subprocess.run(["/usr/sbin/nginx","-t"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log(res.stdout.strip())
    return res.returncode == 0

def nginx_reload() -> bool:
    log("Reloading Nginx...")
    res = subprocess.run(["systemctl","reload","nginx"])
    if res.returncode == 0:
        success("Nginx reloaded successfully")
        return True
    error("Failed to reload Nginx")
    return False

def certificate_path(domain: str) -> Path:
    return Path("/etc/letsencrypt/live")/domain/"cert.pem"

def read_cert_expiry(cert_file: Path) -> str:
    if not cert_file.exists():
        return "not found"
    if x509 is None:
        # fallback via openssl
        try:
            out = subprocess.check_output(["openssl","x509","-enddate","-noout","-in",str(cert_file)], text=True)
            return out.strip().split("=",1)[-1]
        except Exception:
            return "unknown"
    try:
        data = cert_file.read_bytes()
        cert = x509.load_pem_x509_certificate(data, default_backend())
        return cert.not_valid_after.strftime("%Y-%m-%d %H:%M:%S %Z")
    except Exception:
        return "unknown"

def request_certificate(domain: str, email: str) -> bool:
    log(f"Requesting SSL certificate for domain: {domain}")
    args = [
        config.CERTBOT_PATH, "certonly", "--nginx",
        "--non-interactive", "--agree-tos",
        "--email", email,
        "--domains", domain
    ]
    if config.STAGING:
        args.append("--staging")
        log("Using Let's Encrypt staging environment")
    if config.FORCE_RENEWAL:
        args.append("--force-renewal")
        log("Forcing certificate renewal")
    res = subprocess.run(args)
    if res.returncode == 0:
        success(f"SSL certificate obtained successfully for {domain}")
        return True
    error(f"Failed to obtain SSL certificate for {domain}")
    return False

def _nginx_server_block(domain: str) -> str:
    # Build the nginx config from Python, keeping your original hardening/settings.
    headers = [
        'add_header X-Frame-Options DENY;',
        'add_header X-Content-Type-Options nosniff;',
        'add_header X-XSS-Protection "1; mode=block";',
        'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
    ]
    websocket = f"""
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    """ if config.WEBSOCKET_ENABLED else ""

    rate = ""
    if config.RATE_LIMIT_ENABLED:
        # A simple optional rate limit zone at server{} level (advanced setups may prefer http{} scope)
        rate = f"""
    limit_req_zone $binary_remote_addr zone={config.RATE_LIMIT_ZONE}:10m rate={config.RATE_LIMIT_RATE};
    """

    return f"""# Custom domain configuration for {domain}
server {{
    listen 80;
    server_name {domain} www.{domain};

    return 301 https://$server_name$request_uri;
}}

server {{
    listen 443 ssl http2;
    server_name {domain} www.{domain};
{rate}
    ssl_certificate /etc/letsencrypt/live/{domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/{domain}/privkey.pem;

    ssl_protocols {config.SSL_PROTOCOLS};
    ssl_ciphers {config.SSL_CIPHERS};
    ssl_prefer_server_ciphers off;
    ssl_session_cache {config.SSL_SESSION_CACHE};
    ssl_session_timeout {config.SSL_SESSION_TIMEOUT};

    {headers[0]}
    {headers[1]}
    {headers[2]}
    {headers[3]}

    location / {{
        proxy_pass http://{config.BACKEND_APP_HOST}:{config.BACKEND_APP_PORT};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        {websocket}
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }}

    location {config.HEALTH_CHECK_PATH} {{
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }}
}}
"""

def create_nginx_config(domain: str) -> Path:
    target = Path(config.NGINX_SITES_AVAILABLE)/domain
    log(f"Creating Nginx configuration for {domain}: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    content = _nginx_server_block(domain)
    target.write_text(content)
    success(f"Nginx configuration created: {target}")
    return target

def enable_nginx_site(domain: str):
    src = Path(config.NGINX_SITES_AVAILABLE)/domain
    dst = Path(config.NGINX_SITES_ENABLED)/domain
    if not src.exists():
        error(f"Nginx configuration file not found: {src}")
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.is_symlink() or dst.exists():
        log(f"Site already enabled: {domain}")
        return True
    dst.symlink_to(src)
    success(f"Nginx site enabled: {domain}")
    return True

def check_domain_exists(domain: str) -> bool:
    return (Path(config.NGINX_SITES_AVAILABLE)/domain).exists() or (Path(config.NGINX_SITES_ENABLED)/domain).exists()

def verify_dns(domain: str, expected_ips):
    """
    Pythonic DNS verification using dnspython (preferred).
    Falls back to 'dig' if dnspython isn't installed.
    """
    resolved = set()
    if dns is not None:
        resolver = dns.resolver.Resolver()
        resolver.timeout = config.DNS_TIMEOUT
        resolver.lifetime = config.DNS_TIMEOUT
        # try multiple DNS servers if provided
        if config.DNS_SERVERS:
            resolver.nameservers = config.DNS_SERVERS
        try:
            answers = resolver.resolve(domain, "A")
            for r in answers:
                resolved.add(r.to_text())
        except Exception:
            pass
    if not resolved:
        # fallback to dig
        try:
            out = subprocess.check_output(["dig","+short",domain,"A"], text=True)
            for line in out.splitlines():
                line=line.strip()
                if re.match(r"^\d+\.\d+\.\d+\.\d+$", line):
                    resolved.add(line)
        except Exception:
            pass
    if not resolved:
        error(f"No A records found for {domain}")
        return False
    log(f"Resolved IPs: {' '.join(sorted(resolved))}")
    if not expected_ips:
        # if no expectations, just return True (parity with "check" behavior without IPs)
        return True
    return any(ip in resolved for ip in expected_ips)

def list_domains():
    base = Path(config.NGINX_SITES_AVAILABLE)
    if not base.exists():
        print("  (none)")
        return
    for p in sorted(base.iterdir()):
        if p.is_file():
            print(f"  - {p.name}")

def delete_domain(domain: str):
    ok = True
    en = Path(config.NGINX_SITES_ENABLED)/domain
    av = Path(config.NGINX_SITES_AVAILABLE)/domain

    if en.is_symlink() or en.exists():
        try:
            en.unlink()
            success(f"Nginx site disabled: {domain}")
        except Exception as e:
            ok = False
            error(f"Failed to disable Nginx site: {domain} ({e})")
    else:
        log(f"Nginx site not enabled for: {domain}")

    if av.exists():
        try:
            av.unlink()
            success(f"Nginx configuration removed: {domain}")
        except Exception as e:
            ok = False
            error(f"Failed to remove Nginx configuration: {domain} ({e})")
    else:
        log(f"Nginx configuration not found for: {domain}")

    # Revoke & delete cert via certbot (safe if already gone)
    live_dir = Path("/etc/letsencrypt/live")/domain
    if live_dir.exists():
        log(f"Revoking SSL certificate for {domain}")
        subprocess.run([config.CERTBOT_PATH, "revoke", "--cert-path", str(live_dir/"cert.pem"), "--non-interactive"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log(f"Deleting certificate files for {domain}")
        subprocess.run([config.CERTBOT_PATH, "delete", "--cert-name", domain, "--non-interactive"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        log(f"SSL certificate not found for: {domain}")

    if nginx_test():
        if nginx_reload():
            if ok:
                success(f"Domain {domain} deleted successfully")
            else:
                warning(f"Domain {domain} partially deleted (some operations failed)")
        else:
            error(f"Failed to reload Nginx after deleting {domain}")
            sys.exit(1)
    else:
        error("Nginx configuration is invalid after deleting {domain}")
        sys.exit(1)

def main():
    require_root()
    load_env_overrides()
    check_dependencies()

    parser = argparse.ArgumentParser(
        description="Custom Domain Manager (Pythonic)",
        epilog="""
Examples:
  manage_domain.py request example.com admin@example.com
  manage_domain.py check example.com 203.0.113.10 203.0.113.20
  manage_domain.py delete example.com
  manage_domain.py renew
  manage_domain.py list
        """,
        formatter_class=argparse.RawTextHelpFormatter
    )
    sub = parser.add_subparsers(dest="action", required=True)

    p_req = sub.add_parser("request", help="Request SSL certificate and configure domain")
    p_req.add_argument("domain")
    p_req.add_argument("email", nargs="?", default=config.EMAIL)

    p_check = sub.add_parser("check", help="Check domain configuration and DNS")
    p_check.add_argument("domain")
    p_check.add_argument("expected_ips", nargs="*")

    p_del = sub.add_parser("delete", help="Delete domain configuration and certificate")
    p_del.add_argument("domain")

    sub.add_parser("renew", help="Renew all certificates")
    sub.add_parser("list", help="List configured domains")

    args = parser.parse_args()

    if args.action in {"request","check","delete"}:
        domain = args.domain
        if not validate_domain(domain):
            sys.exit(1)

    if args.action == "request":
        if check_domain_exists(args.domain):
            warning(f"Domain {args.domain} is already configured")
            sys.exit(0)
        if request_certificate(args.domain, args.email):
            create_nginx_config(args.domain)
            enable_nginx_site(args.domain)
            if nginx_test():
                nginx_reload()
                success(f"Domain {args.domain} configured successfully")
            else:
                error(f"Failed to configure Nginx for {args.domain}")
                sys.exit(1)
        else:
            sys.exit(1)

    elif args.action == "check":
        if not check_domain_exists(args.domain):
            error(f"Domain {args.domain} is not configured")
            sys.exit(1)

        live_dir = Path("/etc/letsencrypt/live")/args.domain
        if live_dir.exists():
            success(f"SSL certificate exists for {args.domain}")
            exp = read_cert_expiry(live_dir/"cert.pem")
            log(f"Certificate expires on: {exp}")
        else:
            error(f"SSL certificate not found for {args.domain}")
            sys.exit(1)

        if nginx_test():
            success("Nginx configuration is valid")
        else:
            error("Nginx configuration is invalid")
            sys.exit(1)

        if args.expected_ips:
            if verify_dns(args.domain, set(args.expected_ips)):
                success(f"DNS verification successful for {args.domain}")
            else:
                warning(f"DNS verification failed for {args.domain}")
                sys.exit(1)

    elif args.action == "delete":
        delete_domain(args.domain)

    elif args.action == "renew":
        log("Renewing certificates...")
        res = subprocess.run([config.CERTBOT_PATH, "renew", "--quiet"])
        if res.returncode == 0:
            success("All certificates renewed successfully")
            nginx_reload()
        else:
            error("Certificate renewal failed")
            sys.exit(1)

    elif args.action == "list":
        log("Listing configured domains:")
        list_domains()

if __name__ == "__main__":
    main()
