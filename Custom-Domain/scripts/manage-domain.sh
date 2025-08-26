#!/bin/bash

# Custom Domain Management Script
# Replaces AWS Lambda functionality with server-based Certbot + Nginx setup

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.sh"
LOG_FILE="$SCRIPT_DIR/domain-manager.log"
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"
CERTBOT_PATH="/usr/bin/certbot"
NGINX_PATH="/usr/sbin/nginx"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
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

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check dependencies
check_dependencies() {
    log "Checking dependencies..."
    
    if ! command -v "$CERTBOT_PATH" &> /dev/null; then
        error "Certbot not found. Please install it first: apt-get install certbot python3-certbot-nginx"
        exit 1
    fi
    
    if ! command -v "$NGINX_PATH" &> /dev/null; then
        error "Nginx not found. Please install it first: apt-get install nginx"
        exit 1
    fi
    
    if ! command -v dig &> /dev/null; then
        error "dig command not found. Please install bind9-utils: apt-get install bind9-utils"
        exit 1
    fi
    
    success "All dependencies are available"
}

# Load configuration
load_config() {
    if [[ -f "$CONFIG_FILE" ]]; then
        log "Loading configuration from $CONFIG_FILE"
        source "$CONFIG_FILE"
    else
        warning "Configuration file not found, using defaults"
        # Default configuration
        BACKEND_APP_PORT=3000
        BACKEND_APP_HOST="127.0.0.1"
        EMAIL="admin@example.com"
        STAGING="false"
        FORCE_RENEWAL="false"
    fi
}

# Validate domain format
validate_domain() {
    local domain="$1"
    if [[ ! "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
        error "Invalid domain format: $domain"
        return 1
    fi
    return 0
}

# Check if domain is already configured
check_domain_exists() {
    local domain="$1"
    if [[ -f "$NGINX_SITES_ENABLED/$domain" ]] || [[ -f "$NGINX_SITES_AVAILABLE/$domain" ]]; then
        return 0
    fi
    return 1
}

# Request SSL certificate using Certbot
request_certificate() {
    local domain="$1"
    local email="$2"
    
    log "Requesting SSL certificate for domain: $domain"
    
    local certbot_args=(
        "$CERTBOT_PATH"
        "certonly"
        "--nginx"
        "--non-interactive"
        "--agree-tos"
        "--email" "$email"
        "--domains" "$domain"
    )
    
    if [[ "$STAGING" == "true" ]]; then
        certbot_args+=("--staging")
        log "Using Let's Encrypt staging environment"
    fi
    
    if [[ "$FORCE_RENEWAL" == "true" ]]; then
        certbot_args+=("--force-renewal")
        log "Forcing certificate renewal"
    fi
    
    if "${certbot_args[@]}"; then
        success "SSL certificate obtained successfully for $domain"
        return 0
    else
        error "Failed to obtain SSL certificate for $domain"
        return 1
    fi
}

# Create Nginx configuration
create_nginx_config() {
    local domain="$1"
    local config_file="$NGINX_SITES_AVAILABLE/$domain"
    
    log "Creating Nginx configuration for $domain"
    
    cat > "$config_file" << EOF
# Custom domain configuration for $domain
server {
    listen 80;
    server_name $domain www.$domain;
    
    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $domain www.$domain;
    
    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    
    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Proxy to backend application
    location / {
        proxy_pass http://$BACKEND_APP_HOST:$BACKEND_APP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF
    
    success "Nginx configuration created: $config_file"
}

# Enable Nginx site
enable_nginx_site() {
    local domain="$1"
    local source="$NGINX_SITES_AVAILABLE/$domain"
    local target="$NGINX_SITES_ENABLED/$domain"
    
    if [[ ! -f "$source" ]]; then
        error "Nginx configuration file not found: $source"
        return 1
    fi
    
    if [[ -L "$target" ]]; then
        log "Site already enabled: $domain"
        return 0
    fi
    
    ln -sf "$source" "$target"
    success "Nginx site enabled: $domain"
}

# Test Nginx configuration
test_nginx_config() {
    log "Testing Nginx configuration..."
    if "$NGINX_PATH" -t; then
        success "Nginx configuration is valid"
        return 0
    else
        error "Nginx configuration is invalid"
        return 1
    fi
}

# Reload Nginx
reload_nginx() {
    log "Reloading Nginx..."
    if systemctl reload nginx; then
        success "Nginx reloaded successfully"
        return 0
    else
        error "Failed to reload Nginx"
        return 1
    fi
}

# Verify domain DNS resolution
verify_dns() {
    local domain="$1"
    local expected_ips=("${@:2}")
    
    log "Verifying DNS resolution for $domain"
    
    # Get resolved IPs
    local resolved_ips
    resolved_ips=$(dig +short "$domain" A | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | sort)
    
    if [[ -z "$resolved_ips" ]]; then
        error "No A records found for $domain"
        return 1
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
        success "DNS verification successful for $domain"
        return 0
    else
        warning "DNS verification failed: $domain points to $resolved_ips, expected: ${expected_ips[*]}"
        return 1
    fi
}

# Main domain management function
manage_domain() {
    local action="$1"
    local domain="$2"
    local email="$3"
    
    case "$action" in
        "request")
            log "Processing certificate request for domain: $domain"
            
            if ! validate_domain "$domain"; then
                exit 1
            fi
            
            if check_domain_exists "$domain"; then
                warning "Domain $domain is already configured"
                exit 0
            fi
            
            if request_certificate "$domain" "$email"; then
                create_nginx_config "$domain"
                enable_nginx_site "$domain"
                
                if test_nginx_config; then
                    reload_nginx
                    success "Domain $domain configured successfully"
                else
                    error "Failed to configure Nginx for $domain"
                    exit 1
                fi
            else
                error "Failed to request certificate for $domain"
                exit 1
            fi
            ;;
            
        "check")
            log "Checking domain configuration: $domain"
            
            if ! check_domain_exists "$domain"; then
                error "Domain $domain is not configured"
                exit 1
            fi
            
            # Check certificate status
            if [[ -d "/etc/letsencrypt/live/$domain" ]]; then
                success "SSL certificate exists for $domain"
                
                # Check certificate expiration
                local cert_file="/etc/letsencrypt/live/$domain/cert.pem"
                if [[ -f "$cert_file" ]]; then
                    local expiry_date
                    expiry_date=$(openssl x509 -enddate -noout -in "$cert_file" | cut -d= -f2)
                    log "Certificate expires on: $expiry_date"
                fi
            else
                error "SSL certificate not found for $domain"
                exit 1
            fi
            
            # Check Nginx configuration
            if test_nginx_config; then
                success "Nginx configuration is valid"
            else
                error "Nginx configuration is invalid"
                exit 1
            fi
            
            # Verify DNS if expected IPs are provided
            if [[ $# -gt 2 ]]; then
                local expected_ips=("${@:3}")
                verify_dns "$domain" "${expected_ips[@]}"
            fi
            ;;
            
        "delete")
            log "Deleting domain configuration: $domain"
            
            local deletion_success=true
            
            # Check if domain exists
            if ! check_domain_exists "$domain"; then
                warning "Domain $domain is not configured"
                exit 0
            fi
            
            # Remove Nginx configuration
            if [[ -L "$NGINX_SITES_ENABLED/$domain" ]]; then
                if rm -f "$NGINX_SITES_ENABLED/$domain"; then
                    success "Nginx site disabled: $domain"
                else
                    error "Failed to disable Nginx site: $domain"
                    deletion_success=false
                fi
            else
                log "Nginx site not enabled for: $domain"
            fi
            
            if [[ -f "$NGINX_SITES_AVAILABLE/$domain" ]]; then
                if rm -f "$NGINX_SITES_AVAILABLE/$domain"; then
                    success "Nginx configuration removed: $domain"
                else
                    error "Failed to remove Nginx configuration: $domain"
                    deletion_success=false
                fi
            else
                log "Nginx configuration not found for: $domain"
            fi
            
            # Revoke and delete certificate
            if [[ -d "/etc/letsencrypt/live/$domain" ]]; then
                log "Revoking SSL certificate for $domain"
                if "$CERTBOT_PATH" revoke --cert-path "/etc/letsencrypt/live/$domain/cert.pem" --non-interactive 2>/dev/null; then
                    success "SSL certificate revoked for $domain"
                else
                    warning "Failed to revoke certificate for $domain (may already be revoked)"
                fi
                
                log "Deleting certificate files for $domain"
                if "$CERTBOT_PATH" delete --cert-name "$domain" --non-interactive 2>/dev/null; then
                    success "Certificate files deleted for $domain"
                else
                    warning "Failed to delete certificate files for $domain (may already be deleted)"
                fi
            else
                log "SSL certificate not found for: $domain"
            fi
            
            # Reload Nginx
            if test_nginx_config; then
                if reload_nginx; then
                    if [[ "$deletion_success" == true ]]; then
                        success "Domain $domain deleted successfully"
                    else
                        warning "Domain $domain partially deleted (some operations failed)"
                    fi
                else
                    error "Failed to reload Nginx after deleting $domain"
                    exit 1
                fi
            else
                error "Nginx configuration is invalid after deleting $domain"
                exit 1
            fi
            ;;
            
        "renew")
            log "Renewing certificates..."
            if "$CERTBOT_PATH" renew --quiet; then
                success "All certificates renewed successfully"
                reload_nginx
            else
                error "Certificate renewal failed"
                exit 1
            fi
            ;;
            
        "list")
            log "Listing configured domains:"
            for config in "$NGINX_SITES_AVAILABLE"/*; do
                if [[ -f "$config" ]]; then
                    local domain_name
                    domain_name=$(basename "$config")
                    echo "  - $domain_name"
                fi
            done
            ;;
            
        *)
            error "Invalid action: $action"
            show_usage
            exit 1
            ;;
    esac
}

# Show usage information
show_usage() {
    cat << EOF
Usage: $0 <action> [options]

Actions:
    request <domain> <email>     Request SSL certificate and configure domain
    check <domain> [expected_ips] Check domain configuration and DNS
    delete <domain>              Delete domain configuration and certificate
    renew                        Renew all certificates
    list                         List all configured domains

Examples:
    $0 request example.com admin@example.com
    $0 check example.com 192.168.1.1 192.168.1.2
    $0 delete example.com
    $0 renew
    $0 list

Environment Variables:
    BACKEND_APP_PORT            Backend application port (default: 3000)
    BACKEND_APP_HOST           Backend application host (default: 127.0.0.1)
    EMAIL                      Default email for certificates
    STAGING                    Use Let's Encrypt staging (true/false)
    FORCE_RENEWAL              Force certificate renewal (true/false)

EOF
}

# Main execution
main() {
    # Check if running as root
    check_root
    
    # Load configuration
    load_config
    
    # Check dependencies
    check_dependencies
    
    # Parse arguments
    if [[ $# -lt 1 ]]; then
        show_usage
        exit 1
    fi
    
    local action="$1"
    shift
    
    case "$action" in
        "request"|"check"|"delete")
            if [[ $# -lt 1 ]]; then
                error "Domain name required for action: $action"
                show_usage
                exit 1
            fi
            local domain="$1"
            shift
            local email="${1:-$EMAIL}"
            shift
            manage_domain "$action" "$domain" "$email" "$@"
            ;;
        "renew"|"list")
            manage_domain "$action"
            ;;
        *)
            error "Invalid action: $action"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
