#!/usr/bin/env python3
import argparse
import ipaddress
import json
import sys
import urllib.request
from pathlib import Path
from datetime import datetime

import config

# dnspython
import dns.resolver

LOG_FILE = Path(__file__).resolve().parent / "dns-verify.log"

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

def extract_base_domain(domain: str) -> str:
    parts = domain.strip(".").split(".")
    if len(parts) > 2:
        return ".".join(parts[-2:])
    return domain

def resolve_records(domain: str, rtype: str, nameserver=None):
    resolver = dns.resolver.Resolver()
    resolver.timeout = config.DNS_TIMEOUT
    resolver.lifetime = config.DNS_TIMEOUT
    if config.DNS_SERVERS:
        resolver.nameservers = config.DNS_SERVERS
    try:
        answers = resolver.resolve(domain, rtype)
        return [r.to_text().rstrip(".") for r in answers]
    except Exception:
        return []

def identify_dns_provider(domain: str) -> str:
    base = extract_base_domain(domain)
    log(f"Identifying DNS provider for base domain: {base}")
    ns_records = []
    # try across our configured servers by reconfiguring resolver
    for _ in range(max(1, len(config.DNS_SERVERS))):
        ns_records = resolve_records(base, "NS")
        if ns_records:
            break
    for ns in [n.lower() for n in ns_records]:
        if "awsdns" in ns: return "Route 53"
        if "cloudflare" in ns: return "Cloudflare"
        if "godaddy" in ns: return "GoDaddy"
        if "dns.google" in ns: return "Google Cloud DNS"
        if "dnsmadeeasy" in ns: return "DNS Made Easy"
        if "registrar-servers" in ns: return "Namecheap"
        if "networksolutions" in ns: return "Network Solutions"
        if "azure-dns" in ns: return "Microsoft Azure DNS"
        if "ns.digitalocean" in ns: return "DigitalOcean"
        if "ns1" in ns: return "NS1"
        if "ultradns" in ns: return "UltraDNS"
        if "yahoo" in ns: return "Yahoo Small Business"
        if "akamai" in ns: return "Akamai"
        if "rackspace" in ns: return "Rackspace Cloud DNS"
        if "oraclecloud" in ns: return "Oracle Cloud DNS"
    return "Unknown provider"

def fetch_cloudflare_cidrs():
    log("Fetching Cloudflare IP ranges...")
    try:
        with urllib.request.urlopen("https://api.cloudflare.com/client/v4/ips", timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
            v4 = data.get("result",{}).get("ipv4_cidrs",[]) or []
            v6 = data.get("result",{}).get("ipv6_cidrs",[]) or []
            return v4, v6
    except Exception:
        warning("Failed to fetch Cloudflare IP ranges, using a minimal fallback")
        return ([
            "173.245.48.0/20","103.21.244.0/22","103.22.200.0/22","103.31.4.0/22",
            "141.101.64.0/18","108.162.192.0/18","190.93.240.0/20","188.114.96.0/20",
            "197.234.240.0/22","198.41.128.0/17","162.158.0.0/15","104.16.0.0/13",
            "104.24.0.0/14","172.64.0.0/13","131.0.72.0/22"
        ], [])

def ip_in_any_cidr(ip: str, cidrs):
    ip_obj = ipaddress.ip_address(ip)
    for c in cidrs:
        try:
            if ip_obj in ipaddress.ip_network(c):
                return True
        except Exception:
            pass
    return False

def check_cloudflare_proxy(domain: str, cf4, cf6):
    log(f"Checking Cloudflare proxy for {domain}...")
    a_records = resolve_records(domain, "A")
    if not a_records:
        return False
    for ip in a_records:
        if ip_in_any_cidr(ip, cf4):
            log(f"{domain} resolves to {ip} which is in Cloudflare range")
            return True
    return False

def verify_domain_a_records(domain: str, expected_ips):
    log(f"Verifying A records for domain: {domain}")
    if not expected_ips:
        error("No expected IPs provided for verification")
        return False

    retries = max(1, int(config.DNS_RETRIES))
    for attempt in range(retries):
        if attempt:
            delay = 2 ** attempt
            log(f"Retry {attempt} with {delay}s delay")
            try:
                import time; time.sleep(delay)
            except Exception:
                pass

        resolved = resolve_records(domain, "A")
        if not resolved:
            cname = resolve_records(domain, "CNAME")
            if cname:
                log(f"Domain has CNAME record: {', '.join(cname)}")
                if attempt == retries-1:
                    warning("CNAME present, but no A records resolved")
                    return False
            elif attempt == retries-1:
                error(f"No A or CNAME records found for {domain}")
                return False
            continue

        log(f"Resolved IPs: {' '.join(resolved)}")
        if any(ip in resolved for ip in expected_ips):
            success("DNS verification successful: domain points to expected IPs")
            return True

        if attempt == retries-1:
            warning(f"DNS verification failed: {domain} points to {resolved}, expected: {expected_ips}")
            return False
    return False

def main():
    parser = argparse.ArgumentParser(
        description="DNS Verification (Pythonic)",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("domain")
    parser.add_argument("expected_ips", nargs="*")
    args = parser.parse_args()

    domain = args.domain.strip()
    expected_ips = args.expected_ips

    log(f"Starting DNS verification for domain: {domain}")
    provider = identify_dns_provider(domain)
    log(f"DNS provider identified: {provider}")

    cf4, cf6 = fetch_cloudflare_cidrs()
    if provider == "Cloudflare":
        if check_cloudflare_proxy(domain, cf4, cf6):
            warning(f"Domain {domain} is using Cloudflare proxy")
            print(json.dumps({
                "message": "Please disable the proxy in Cloudflare to match SSL certificate",
                "dnsProvider": provider,
                "cloudflare_proxy": "enabled"
            }))
            sys.exit(0)
        else:
            log("Cloudflare proxy is disabled; checking A records...")
            matched = verify_domain_a_records(domain, expected_ips)
            print(json.dumps({
                "message": "matched" if matched else "not matched",
                "dnsProvider": provider,
                "cloudflare_proxy": "disabled"
            }))
            sys.exit(0 if matched else 1)

    matched = verify_domain_a_records(domain, expected_ips)
    print(json.dumps({
        "message": "matched" if matched else "not matched",
        "dnsProvider": provider
    }))
    sys.exit(0 if matched else 1)

if __name__ == "__main__":
    main()
