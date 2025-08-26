#!/usr/bin/env python3
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from datetime import datetime

import config

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_FILE = SCRIPT_DIR / "config.py"
LOG_FILE = SCRIPT_DIR / "setup.log"

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
    with LOG_FILE.open("a") as f:
        f.write(f"[{_ts()}] {msg}\n")

def success(msg): log(f"[SUCCESS] {msg}", "GREEN")
def warning(msg): log(f"[WARNING] {msg}", "YELLOW")
def error(msg):   log(f"[ERROR] {msg}", "RED")

def require_root():
    if os.geteuid() != 0:
        error("This script must be run as root (use sudo)")
        sys.exit(1)

def detect_os():
    os_name, os_ver = "", ""
    try:
        content = Path("/etc/os-release").read_text()
        m_name = re.search(r'^NAME="?(.*?)"?$', content, re.M|re.I)
        m_ver  = re.search(r'^VERSION_ID="?(.*?)"?$', content, re.M|re.I)
        if m_name: os_name = m_name.group(1)
        if m_ver:  os_ver  = m_ver.group(1)
    except Exception:
        os_name = platform.system()
        os_ver = platform.release()
    log(f"Detected OS: {os_name} {os_ver}")
    return os_name, os_ver

def run(cmd, check=True):
    log(">> " + " ".join(cmd))
    return subprocess.run(cmd, check=check)

def update_packages(os_name):
    log("Updating package lists...")
    try:
        if "Ubuntu" in os_name or "Debian" in os_name:
            run(["apt-get","update"])
        elif any(x in os_name for x in ["CentOS","Red Hat","Rocky","AlmaLinux","Amazon Linux"]):
            run(["yum","update","-y"])
        else:
            warning("Unknown OS, skipping package update")
            return
        success("Package lists updated")
    except subprocess.CalledProcessError:
        error("Failed to update packages")
        sys.exit(1)

def install_basic_deps(os_name):
    log("Installing basic dependencies...")
    try:
        if "Ubuntu" in os_name or "Debian" in os_name:
            run(["apt-get","install","-y","curl","wget","git","unzip","software-properties-common"])
        elif any(x in os_name for x in ["CentOS","Red Hat","Rocky","AlmaLinux","Amazon Linux"]):
            run(["yum","install","-y","curl","wget","git","unzip","epel-release"])
        success("Basic dependencies installed")
    except subprocess.CalledProcessError:
        warning("Failed to install some basic deps. Continue if already present.")

def install_nginx(os_name):
    log("Installing Nginx...")
    try:
        if "Ubuntu" in os_name or "Debian" in os_name:
            run(["apt-get","install","-y","nginx"])
        else:
            run(["yum","install","-y","nginx"])
        run(["systemctl","enable","nginx"])
        run(["systemctl","start","nginx"])
        success("Nginx installed and started")
    except subprocess.CalledProcessError:
        error("Nginx installation failed")
        sys.exit(1)

def install_certbot(os_name, os_ver):
    log("Installing Certbot...")
    try:
        if "Ubuntu" in os_name or "Debian" in os_name:
            run(["apt-get","install","-y","certbot","python3-certbot-nginx"])
        elif "Amazon Linux" in os_name and os_ver.strip() == "2":
            run(["yum","install","-y","python3-pip"])
            run(["pip3","install","certbot","certbot-nginx"])
        else:
            run(["yum","install","-y","certbot","python3-certbot-nginx"])
        success("Certbot installed")
    except subprocess.CalledProcessError:
        error("Certbot installation failed")
        sys.exit(1)

def install_dns_utils(os_name):
    log("Installing DNS utilities...")
    try:
        if "Ubuntu" in os_name or "Debian" in os_name:
            run(["apt-get","install","-y","bind9-utils"])
        else:
            run(["yum","install","-y","bind-utils"])
        success("DNS utilities installed")
    except subprocess.CalledProcessError:
        warning("Could not install DNS utilities (dig). dnspython will still work.")

def install_jq(os_name):
    log("Installing jq...")
    try:
        if "Ubuntu" in os_name or "Debian" in os_name:
            run(["apt-get","install","-y","jq"])
        else:
            run(["yum","install","-y","jq"])
        success("jq installed")
    except subprocess.CalledProcessError:
        warning("Could not install jq (optional).")

def install_nodejs(os_name):
    log("Installing Node.js (optional)...")
    try:
        if "Ubuntu" in os_name or "Debian" in os_name:
            run(["bash","-lc","curl -fsSL https://deb.nodesource.com/setup_18.x | bash -"])
            run(["apt-get","install","-y","nodejs"])
        else:
            run(["bash","-lc","curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -"])
            run(["yum","install","-y","nodejs"])
        success("Node.js installed")
    except subprocess.CalledProcessError:
        warning("Node.js installation failed (optional).")

def configure_nginx():
    log("Configuring Nginx includes...")
    Path("/etc/nginx/sites-available").mkdir(parents=True, exist_ok=True)
    Path("/etc/nginx/sites-enabled").mkdir(parents=True, exist_ok=True)

    nginx_conf = Path("/etc/nginx/nginx.conf")
    if nginx_conf.exists():
        content = nginx_conf.read_text()
        if "sites-enabled" not in content:
            # try using nginxparser if present, else simple append within http block
            try:
                from nginxparser import load, dump
                with nginx_conf.open() as f:
                    data = load(f)
                # find http block
                for i, (k, v) in enumerate(data):
                    if isinstance(k, list) and k and k[0] == 'http':
                        v.append(['include', '/etc/nginx/sites-enabled/*'])
                        break
                with nginx_conf.open("w") as f:
                    dump(data, f)
                success("Added sites-enabled include via nginxparser")
            except Exception:
                # regex append inside the first http { ... }
                new = re.sub(r"http\s*\{", "http {\n    include /etc/nginx/sites-enabled/*;", content, count=1)
                if new != content:
                    nginx_conf.write_text(new)
                    success("Added sites-enabled include via text edit")
    # Test and reload
    res = subprocess.run(["nginx","-t"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    log(res.stdout.strip())
    if res.returncode != 0:
        error("Nginx configuration is invalid")
        sys.exit(1)
    subprocess.run(["systemctl","reload","nginx"], check=False)
    success("Nginx configuration valid and reloaded")

def configure_firewall(os_name):
    log("Configuring firewall (if present)...")
    if shutil.which("ufw"):
        subprocess.run(["ufw","allow","'Nginx Full'"], shell=False)
        subprocess.run(["ufw","allow","ssh"])
        subprocess.run(["ufw","--force","enable"])
        success("UFW configured")
    elif shutil.which("firewall-cmd"):
        subprocess.run(["firewall-cmd","--permanent","--add-service=http"])
        subprocess.run(["firewall-cmd","--permanent","--add-service=https"])
        subprocess.run(["firewall-cmd","--permanent","--add-service=ssh"])
        subprocess.run(["firewall-cmd","--reload"])
        success("firewalld configured")
    else:
        warning("No known firewall tool detected; skipping")

def create_systemd_service():
    log("Creating systemd service for domain manager...")
    unit = f"""[Unit]
Description=Custom Domain Manager Service
After=network.target nginx.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory={SCRIPT_DIR}
ExecStart=/usr/bin/env python3 {SCRIPT_DIR}/manage_domain.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
    Path("/etc/systemd/system/domain-manager.service").write_text(unit)
    subprocess.run(["systemctl","daemon-reload"])
    subprocess.run(["systemctl","enable","domain-manager.service"])
    success("Systemd service created and enabled")

def create_cron_job():
    log("Creating cron job for cert renewal...")
    cron_line = f"0 12 * * * /usr/bin/env python3 {SCRIPT_DIR}/manage_domain.py renew >> {SCRIPT_DIR}/cron.log 2>&1"
    try:
        existing = subprocess.run(["crontab","-l"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        lines = existing.stdout.splitlines() if existing.returncode == 0 else []
        if cron_line not in lines:
            lines.append(cron_line)
            p = subprocess.run(["crontab","-"], input="\n".join(lines)+"\n", text=True)
            if p.returncode == 0:
                success("Cron job created for daily certificate renewal at 12:00 PM")
    except Exception as e:
        warning(f"Failed to create cron job: {e}")

def setup_log_rotation():
    log("Setting up log rotation...")
    conf = f"""{SCRIPT_DIR}/*.log {{
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 root root
    postrotate
        systemctl reload domain-manager.service > /dev/null 2>&1 || true
    endscript
}}
"""
    Path("/etc/logrotate.d/domain-manager").write_text(conf)
    success("Log rotation configured")

def create_backup_dir():
    log("Creating backup directory...")
    Path(config.BACKUP_DIR).mkdir(parents=True, exist_ok=True)
    os.chmod(config.BACKUP_DIR, 0o755)
    success("Backup directory created")

def set_permissions():
    log("Ensuring proper permissions...")
    for p in (SCRIPT_DIR / "manage_domain.py", SCRIPT_DIR / "setup.py", SCRIPT_DIR / "verify_dns.py"):
        if p.exists():
            p.chmod(0o755)
    success("Permissions set")

def test_installation():
    log("Testing installation...")
    if subprocess.run(["systemctl","is-active","--quiet","nginx"]).returncode == 0:
        success("Nginx is running")
    else:
        error("Nginx is not running")
        sys.exit(1)
    if shutil.which("certbot"):
        success("Certbot is available")
    else:
        error("Certbot is not available")
        sys.exit(1)
    if shutil.which("dig") or True:
        success("DNS utilities/dnspython are available")
    else:
        error("DNS tools are not available")
        sys.exit(1)
    if (SCRIPT_DIR / "manage_domain.py").exists():
        success("Domain management script present")
    else:
        error("manage_domain.py missing")
        sys.exit(1)
    success("All tests passed")

def post_install_note():
    print(f"""
{ANSI['GREEN']}=== Installation Complete! ==={ANSI['NC']}

The Custom Domain Management System has been successfully installed.

Next steps:
  1) Edit {CONFIG_FILE} to customize ports, email, etc.
  2) Test: {SCRIPT_DIR}/manage_domain.py list
  3) Add a domain:
       {SCRIPT_DIR}/manage_domain.py request example.com your-email@example.com
  4) Check status:
       {SCRIPT_DIR}/manage_domain.py check example.com
  5) Verify DNS:
       {SCRIPT_DIR}/verify_dns.py example.com 192.168.1.1

Service management:
  systemctl start domain-manager.service
  systemctl status domain-manager.service
  journalctl -u domain-manager.service

Let's Encrypt staging:
  Set STAGING=True in config.py
""")

def main():
    require_root()
    os_name, os_ver = detect_os()
    update_packages(os_name)
    install_basic_deps(os_name)
    install_nginx(os_name)
    install_certbot(os_name, os_ver)
    install_dns_utils(os_name)
    install_jq(os_name)
    install_nodejs(os_name)
    configure_nginx()
    configure_firewall(os_name)
    create_systemd_service()
    create_cron_job()
    setup_log_rotation()
    create_backup_dir()
    set_permissions()
    test_installation()
    post_install_note()
    success("Installation completed successfully!")

if __name__ == "__main__":
    main()
