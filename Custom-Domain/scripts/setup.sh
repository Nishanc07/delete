#!/bin/bash

# Setup Script for Custom Domain Management System
# Installs all necessary dependencies and configures the environment

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.sh"
LOG_FILE="$SCRIPT_DIR/setup.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Detect operating system
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS="$NAME"
        VER="$VERSION_ID"
    elif type lsb_release >/dev/null 2>&1; then
        OS=$(lsb_release -si)
        VER=$(lsb_release -sr)
    elif [[ -f /etc/lsb-release ]]; then
        . /etc/lsb-release
        OS="$DISTRIB_ID"
        VER="$DISTRIB_RELEASE"
    elif [[ -f /etc/debian_version ]]; then
        OS=Debian
        VER=$(cat /etc/debian_version)
    elif [[ -f /etc/SuSE-release ]]; then
        OS=openSUSE
    elif [[ -f /etc/redhat-release ]]; then
        OS=RedHat
    else
        OS=$(uname -s)
        VER=$(uname -r)
    fi
    
    log "Detected OS: $OS $VER"
}

# Update package lists
update_packages() {
    log "Updating package lists..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            apt-get update
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            yum update -y
            ;;
        *"Amazon Linux"*)
            yum update -y
            ;;
        *)
            warning "Unknown OS, skipping package update"
            return 1
            ;;
    esac
    
    success "Package lists updated"
}

# Install basic dependencies
install_basic_deps() {
    log "Installing basic dependencies..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            apt-get install -y curl wget git unzip software-properties-common
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            yum install -y curl wget git unzip epel-release
            ;;
        *"Amazon Linux"*)
            yum install -y curl wget git unzip
            ;;
        *)
            warning "Unknown OS, please install basic dependencies manually"
            return 1
            ;;
    esac
    
    success "Basic dependencies installed"
}

# Install Nginx
install_nginx() {
    log "Installing Nginx..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            apt-get install -y nginx
            systemctl enable nginx
            systemctl start nginx
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            yum install -y nginx
            systemctl enable nginx
            systemctl start nginx
            ;;
        *"Amazon Linux"*)
            yum install -y nginx
            systemctl enable nginx
            systemctl start nginx
            ;;
        *)
            error "Unknown OS, cannot install Nginx automatically"
            return 1
            ;;
    esac
    
    success "Nginx installed and started"
}

# Install Certbot
install_certbot() {
    log "Installing Certbot..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            apt-get install -y certbot python3-certbot-nginx
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            yum install -y certbot python3-certbot-nginx
            ;;
        *"Amazon Linux"*)
            # Amazon Linux 2
            if [[ "$VER" == "2" ]]; then
                yum install -y python3-pip
                pip3 install certbot certbot-nginx
            else
                # Amazon Linux 2023
                yum install -y certbot python3-certbot-nginx
            fi
            ;;
        *)
            error "Unknown OS, cannot install Certbot automatically"
            return 1
            ;;
    esac
    
    success "Certbot installed"
}

# Install DNS utilities
install_dns_utils() {
    log "Installing DNS utilities..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            apt-get install -y bind9-utils
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            yum install -y bind-utils
            ;;
        *"Amazon Linux"*)
            yum install -y bind-utils
            ;;
        *)
            warning "Unknown OS, please install DNS utilities manually"
            return 1
            ;;
    esac
    
    success "DNS utilities installed"
}

# Install JSON processor
install_jq() {
    log "Installing jq (JSON processor)..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            apt-get install -y jq
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            yum install -y jq
            ;;
        *"Amazon Linux"*)
            yum install -y jq
            ;;
        *)
            warning "Unknown OS, please install jq manually"
            return 1
            ;;
    esac
    
    success "jq installed"
}

# Install Node.js (for potential API backend)
install_nodejs() {
    log "Installing Node.js..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
            apt-get install -y nodejs
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
            yum install -y nodejs
            ;;
        *"Amazon Linux"*)
            curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
            yum install -y nodejs
            ;;
        *)
            warning "Unknown OS, please install Node.js manually"
            return 1
            ;;
    esac
    
    success "Node.js installed"
}

# Configure Nginx
configure_nginx() {
    log "Configuring Nginx..."
    
    # Create custom domain directory
    mkdir -p /etc/nginx/sites-available
    mkdir -p /etc/nginx/sites-enabled
    
    # Backup original nginx.conf
    if [[ -f /etc/nginx/nginx.conf ]]; then
        cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup
        log "Original nginx.conf backed up"
    fi
    
    # Add sites-enabled include to nginx.conf if not present
    if ! grep -q "sites-enabled" /etc/nginx/nginx.conf; then
        # Find the http block and add the include directive
        sed -i '/http {/a \    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf
        log "Added sites-enabled include to nginx.conf"
    fi
    
    # Test Nginx configuration
    if nginx -t; then
        success "Nginx configuration is valid"
        systemctl reload nginx
    else
        error "Nginx configuration is invalid"
        return 1
    fi
}

# Configure firewall
configure_firewall() {
    log "Configuring firewall..."
    
    case "$OS" in
        *"Ubuntu"*|*"Debian"*)
            if command -v ufw &> /dev/null; then
                ufw allow 'Nginx Full'
                ufw allow ssh
                ufw --force enable
                success "UFW firewall configured"
            fi
            ;;
        *"CentOS"*|*"Red Hat"*|*"Rocky"*|*"AlmaLinux"*)
            if command -v firewall-cmd &> /dev/null; then
                firewall-cmd --permanent --add-service=http
                firewall-cmd --permanent --add-service=https
                firewall-cmd --permanent --add-service=ssh
                firewall-cmd --reload
                success "firewalld configured"
            fi
            ;;
        *"Amazon Linux"*)
            if command -v firewall-cmd &> /dev/null; then
                firewall-cmd --permanent --add-service=http
                firewall-cmd --permanent --add-service=https
                firewall-cmd --permanent --add-service=ssh
                firewall-cmd --reload
                success "firewalld configured"
            fi
            ;;
    esac
}

# Create systemd service for domain manager
create_systemd_service() {
    log "Creating systemd service for domain manager..."
    
    cat > /etc/systemd/system/domain-manager.service << EOF
[Unit]
Description=Custom Domain Manager Service
After=network.target nginx.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/manage-domain.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable domain-manager.service
    
    success "Systemd service created and enabled"
}

# Create cron job for certificate renewal
create_cron_job() {
    log "Creating cron job for certificate renewal..."
    
    # Add to root's crontab
    (crontab -l 2>/dev/null; echo "0 12 * * * $SCRIPT_DIR/manage-domain.sh renew >> $SCRIPT_DIR/cron.log 2>&1") | crontab -
    
    success "Cron job created for daily certificate renewal at 12:00 PM"
}

# Set up log rotation
setup_log_rotation() {
    log "Setting up log rotation..."
    
    cat > /etc/logrotate.d/domain-manager << EOF
$SCRIPT_DIR/*.log {
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
}
EOF
    
    success "Log rotation configured"
}

# Create backup directory
create_backup_dir() {
    log "Creating backup directory..."
    
    mkdir -p /var/backups/domain-configs
    chmod 755 /var/backups/domain-configs
    
    success "Backup directory created"
}

# Set proper permissions
set_permissions() {
    log "Setting proper permissions..."
    
    chmod +x "$SCRIPT_DIR"/*.sh
    chown -R root:root "$SCRIPT_DIR"
    
    success "Permissions set correctly"
}

# Test the installation
test_installation() {
    log "Testing installation..."
    
    # Test Nginx
    if systemctl is-active --quiet nginx; then
        success "Nginx is running"
    else
        error "Nginx is not running"
        return 1
    fi
    
    # Test Certbot
    if command -v certbot &> /dev/null; then
        success "Certbot is available"
    else
        error "Certbot is not available"
        return 1
    fi
    
    # Test DNS utilities
    if command -v dig &> /dev/null; then
        success "DNS utilities are available"
    else
        error "DNS utilities are not available"
        return 1
    fi
    
    # Test scripts
    if [[ -x "$SCRIPT_DIR/manage-domain.sh" ]]; then
        success "Domain management script is executable"
    else
        error "Domain management script is not executable"
        return 1
    fi
    
    success "All tests passed"
}

# Show post-installation instructions
show_post_install() {
    cat << EOF

${GREEN}=== Installation Complete! ===${NC}

The Custom Domain Management System has been successfully installed.

${YELLOW}Next Steps:${NC}

1. ${BLUE}Configure your domain settings:${NC}
   Edit $CONFIG_FILE to customize:
   - Backend application port and host
   - Email for certificates
   - DNS servers
   - Other configuration options

2. ${BLUE}Test the system:${NC}
   $SCRIPT_DIR/manage-domain.sh list

3. ${BLUE}Add your first domain:${NC}
   $SCRIPT_DIR/manage-domain.sh request example.com your-email@example.com

4. ${BLUE}Check domain status:${NC}
   $SCRIPT_DIR/manage-domain.sh check example.com

5. ${BLUE}Verify DNS:${NC}
   $SCRIPT_DIR/verify-dns.sh example.com 192.168.1.1

${YELLOW}Important Notes:${NC}

- The system runs as root (required for Nginx and Certbot)
- Certificates will auto-renew daily at 12:00 PM
- Logs are stored in $SCRIPT_DIR/
- Backup directory: /var/backups/domain-configs/

${YELLOW}Service Management:${NC}

- Start: systemctl start domain-manager.service
- Stop: systemctl stop domain-manager.service
- Status: systemctl status domain-manager.service
- Logs: journalctl -u domain-manager.service

${YELLOW}For Let's Encrypt staging environment:${NC}
   Set STAGING="true" in $CONFIG_FILE

${GREEN}Happy domain managing!${NC}

EOF
}

# Main installation function
main() {
    log "Starting Custom Domain Management System installation..."
    
    # Check if running as root
    check_root
    
    # Detect OS
    detect_os
    
    # Install dependencies
    update_packages
    install_basic_deps
    install_nginx
    install_certbot
    install_dns_utils
    install_jq
    install_nodejs
    
    # Configure services
    configure_nginx
    configure_firewall
    
    # Set up system services
    create_systemd_service
    create_cron_job
    setup_log_rotation
    
    # Create directories and set permissions
    create_backup_dir
    set_permissions
    
    # Test installation
    test_installation
    
    # Show post-installation instructions
    show_post_install
    
    success "Installation completed successfully!"
}

# Run main function
main "$@"
