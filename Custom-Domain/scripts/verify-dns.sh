#!/bin/bash

# DNS Verification Script
# Replaces the verify-dns Lambda function functionality

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.sh"
LOG_FILE="$SCRIPT_DIR/dns-verify.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Load configuration
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
else
    # Default values
    DNS_SERVERS=("8.8.8.8" "8.8.4.4" "1.1.1.1" "1.0.0.1")
    DNS_TIMEOUT=30
    DNS_RETRIES=3
fi

# Logging functions
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check dependencies
check_dependencies() {
    if ! command -v dig &> /dev/null; then
        error "dig command not found. Please install bind9-utils: apt-get install bind9-utils"
        exit 1
    fi
    
    if ! command -v curl &> /dev/null; then
        error "curl command not found. Please install curl: apt-get install curl"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        error "jq command not found. Please install jq: apt-get install jq"
        exit 1
    fi
}

# Extract base domain
extract_base_domain() {
    local domain="$1"
    local parts=(${domain//./ })
    if [[ ${#parts[@]} -gt 2 ]]; then
        echo "${parts[-2]}.${parts[-1]}"
    else
        echo "$domain"
    fi
}

# Resolve DNS records
resolve_dns() {
    local domain="$1"
    local record_type="$2"
    local dns_server="$3"
    
    case "$record_type" in
        "NS")
            dig +short @"$dns_server" "$domain" NS 2>/dev/null | grep -v '^;'
            ;;
        "A")
            dig +short @"$dns_server" "$domain" A 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
            ;;
        "CNAME")
            dig +short @"$dns_server" "$domain" CNAME 2>/dev/null | grep -v '^;'
            ;;
        *)
            error "Unsupported record type: $record_type"
            return 1
            ;;
    esac
}

# Identify DNS provider
identify_dns_provider() {
    local domain="$1"
    local base_domain
    base_domain=$(extract_base_domain "$domain")
    
    log "Identifying DNS provider for base domain: $base_domain"
    
    # Try multiple DNS servers for NS resolution
    for dns_server in "${DNS_SERVERS[@]}"; do
        local ns_records
        ns_records=$(resolve_dns "$base_domain" "NS" "$dns_server")
        
        if [[ -n "$ns_records" ]]; then
            for ns in $ns_records; do
                local ns_lower
                ns_lower=$(echo "$ns" | tr '[:upper:]' '[:lower:]')
                
                case "$ns_lower" in
                    *"awsdns"*)
                        echo "Route 53"
                        return 0
                        ;;
                    *"cloudflare"*)
                        echo "Cloudflare"
                        return 0
                        ;;
                    *"godaddy"*)
                        echo "GoDaddy"
                        return 0
                        ;;
                    *"dns.google"*)
                        echo "Google Cloud DNS"
                        return 0
                        ;;
                    *"dnsmadeeasy"*)
                        echo "DNS Made Easy"
                        return 0
                        ;;
                    *"registrar-servers"*)
                        echo "Namecheap"
                        return 0
                        ;;
                    *"networksolutions"*)
                        echo "Network Solutions"
                        return 0
                        ;;
                    *"azure-dns"*)
                        echo "Microsoft Azure DNS"
                        return 0
                        ;;
                    *"ns.digitalocean"*)
                        echo "DigitalOcean"
                        return 0
                        ;;
                    *"ns1"*)
                        echo "NS1"
                        return 0
                        ;;
                    *"ultradns"*)
                        echo "UltraDNS"
                        return 0
                        ;;
                    *"yahoo"*)
                        echo "Yahoo Small Business"
                        return 0
                        ;;
                    *"akamai"*)
                        echo "Akamai"
                        return 0
                        ;;
                    *"rackspace"*)
                        echo "Rackspace Cloud DNS"
                        return 0
                        ;;
                    *"oraclecloud"*)
                        echo "Oracle Cloud DNS"
                        return 0
                        ;;
                esac
            done
            break
        fi
    done
    
    echo "Unknown provider"
}

# Get Cloudflare IP ranges
get_cloudflare_ips() {
    log "Fetching Cloudflare IP ranges..."
    
    local response
    response=$(curl -s -H "Cache-Control: no-cache" "https://api.cloudflare.com/client/v4/ips" 2>/dev/null)
    
    if [[ $? -eq 0 ]]; then
        local ipv4_cidrs
        local ipv6_cidrs
        
        ipv4_cidrs=$(echo "$response" | jq -r '.result.ipv4_cidrs[]?' 2>/dev/null)
        ipv6_cidrs=$(echo "$response" | jq -r '.result.ipv6_cidrs[]?' 2>/dev/null)
        
        if [[ -n "$ipv4_cidrs" ]]; then
            echo "$ipv4_cidrs"
        fi
    else
        warning "Failed to fetch Cloudflare IP ranges, using fallback"
        # Fallback Cloudflare IPs
        echo "173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
    fi
}

# Check if IP is in Cloudflare range
is_ip_in_cloudflare_range() {
    local ip="$1"
    local cloudflare_cidrs="$2"
    
    for cidr in $cloudflare_cidrs; do
        if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            # Simple CIDR check (basic implementation)
            local cidr_parts=(${cidr//\// })
            local cidr_ip="${cidr_parts[0]}"
            local cidr_mask="${cidr_parts[1]}"
            
            if [[ "$ip" == "$cidr_ip" ]]; then
                return 0
            fi
        fi
    done
    
    return 1
}

# Check if domain is using Cloudflare proxy
check_cloudflare_proxy() {
    local domain="$1"
    local cloudflare_cidrs="$2"
    
    log "Checking if $domain is using Cloudflare proxy..."
    
    for dns_server in "${DNS_SERVERS[@]}"; do
        local a_records
        a_records=$(resolve_dns "$domain" "A" "$dns_server")
        
        if [[ -n "$a_records" ]]; then
            for ip in $a_records; do
                if is_ip_in_cloudflare_range "$ip" "$cloudflare_cidrs"; then
                    log "Domain $domain has IP $ip in Cloudflare range"
                    return 0
                fi
            done
        fi
    done
    
    return 1
}

# Verify domain A records
verify_domain_a_records() {
    local domain="$1"
    local expected_ips=("${@:2}")
    local max_retries=${DNS_RETRIES:-3}
    
    log "Verifying A records for domain: $domain"
    log "Expected IPs: ${expected_ips[*]}"
    
    if [[ ${#expected_ips[@]} -eq 0 ]]; then
        error "No expected IPs provided for verification"
        return 1
    fi
    
    # Try multiple DNS servers and retries
    for ((retry=0; retry<max_retries; retry++)); do
        if [[ $retry -gt 0 ]]; then
            local delay=$((2 ** retry))
            log "Retry $retry with $delay second delay"
            sleep "$delay"
        fi
        
        # Try different DNS servers on each retry
        local dns_server
        dns_server="${DNS_SERVERS[$((retry % ${#DNS_SERVERS[@]}))]}"
        
        log "Trying DNS server: $dns_server"
        
        local resolved_ips
        resolved_ips=$(resolve_dns "$domain" "A" "$dns_server")
        
        if [[ -z "$resolved_ips" ]]; then
            # Check for CNAME records
            local cname_record
            cname_record=$(resolve_dns "$domain" "CNAME" "$dns_server")
            
            if [[ -n "$cname_record" ]]; then
                log "Domain has CNAME record: $cname_record"
                
                # If this is the last retry, return the CNAME info
                if [[ $retry -eq $((max_retries - 1)) ]]; then
                    warning "Domain has CNAME record pointing to $cname_record instead of A records"
                    return 1
                fi
                continue
            fi
            
            if [[ $retry -eq $((max_retries - 1)) ]]; then
                error "No A or CNAME records found for $domain"
                return 1
            fi
            continue
        fi
        
        log "Resolved IPs: $resolved_ips"
        
        # Check if any resolved IP matches expected IPs
        local found_match=false
        for ip in $resolved_ips; do
            for expected_ip in "${expected_ips[@]}"; do
                if [[ "$ip" == "$expected_ip" ]]; then
                    found_match=true
                    break 2
                fi
            done
        done
        
        if [[ "$found_match" == true ]]; then
            success "DNS verification successful: $domain points to expected IPs"
            return 0
        fi
        
        if [[ $retry -eq $((max_retries - 1)) ]]; then
            warning "DNS verification failed: $domain points to $resolved_ips, expected: ${expected_ips[*]}"
            return 1
        fi
    done
    
    return 1
}

# Main verification function
verify_domain() {
    local domain="$1"
    local expected_ips=("${@:2}")
    
    if [[ -z "$domain" ]]; then
        error "Domain name is required"
        show_usage
        exit 1
    fi
    
    log "Starting DNS verification for domain: $domain"
    
    # Check dependencies
    check_dependencies
    
    # Identify DNS provider
    local provider
    provider=$(identify_dns_provider "$domain")
    log "DNS provider identified: $provider"
    
    # Get Cloudflare IP ranges
    local cloudflare_cidrs
    cloudflare_cidrs=$(get_cloudflare_ips)
    
    # Special handling for Cloudflare
    if [[ "$provider" == "Cloudflare" ]]; then
        log "Processing Cloudflare domain: $domain"
        
        if check_cloudflare_proxy "$domain" "$cloudflare_cidrs"; then
            warning "Domain $domain is using Cloudflare proxy"
            echo "{\"message\": \"Please disable the proxy in Cloudflare to match SSL certificate\", \"dnsProvider\": \"$provider\", \"cloudflare_proxy\": \"enabled\"}"
            exit 0
        else
            log "Cloudflare proxy is disabled for $domain, checking A records..."
            
            if verify_domain_a_records "$domain" "${expected_ips[@]}"; then
                success "Domain $domain is properly configured"
                echo "{\"message\": \"matched\", \"dnsProvider\": \"$provider\", \"cloudflare_proxy\": \"disabled\"}"
                exit 0
            else
                warning "Domain $domain is not pointing to expected IPs"
                echo "{\"message\": \"not matched\", \"dnsProvider\": \"$provider\", \"cloudflare_proxy\": \"disabled\"}"
                exit 1
            fi
        fi
    fi
    
    # Standard verification for other providers
    if verify_domain_a_records "$domain" "${expected_ips[@]}"; then
        success "Domain $domain verification successful"
        echo "{\"message\": \"matched\", \"dnsProvider\": \"$provider\"}"
        exit 0
    else
        warning "Domain $domain verification failed"
        echo "{\"message\": \"not matched\", \"dnsProvider\": \"$provider\"}"
        exit 1
    fi
}

# Show usage information
show_usage() {
    cat << EOF
Usage: $0 <domain> [expected_ip1] [expected_ip2] ...

Description:
    Verify DNS configuration for a domain and check if it points to expected IP addresses.

Arguments:
    domain          Domain name to verify (e.g., example.com)
    expected_ip*    Expected IP addresses (optional)

Examples:
    $0 example.com
    $0 example.com 192.168.1.1 192.168.1.2
    $0 subdomain.example.com 10.0.0.1

Output:
    JSON response with verification status and DNS provider information.

Exit Codes:
    0 - Verification successful
    1 - Verification failed or error occurred

EOF
}

# Main execution
if [[ $# -lt 1 ]]; then
    show_usage
    exit 1
fi

# Parse arguments
domain="$1"
shift
expected_ips=("$@")

# Run verification
verify_domain "$domain" "${expected_ips[@]}"
