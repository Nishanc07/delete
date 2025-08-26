# Custom Domain Management Scripts

This directory contains shell scripts that replace the AWS Lambda functionality for managing custom domains using **Certbot** and **Nginx** instead of AWS ACM and ALB.

## 🚀 Quick Start

### 1. Installation
```bash
# Run as root
sudo ./setup.sh
```

### 2. Configure Settings
Edit `config.sh` to customize your environment:
```bash
# Backend application
BACKEND_APP_PORT=3000
BACKEND_APP_HOST="127.0.0.1"

# Certificate settings
EMAIL="admin@example.com"
STAGING="false"  # Set to "true" for testing
```

### 3. Add Your First Domain
```bash
sudo ./manage-domain.sh request example.com admin@example.com
```

## 📁 Scripts Overview

### `setup.sh` - Installation Script
**Purpose**: Installs all dependencies and configures the system

**What it does**:
- Detects operating system (Ubuntu, CentOS, Amazon Linux, etc.)
- Installs Nginx, Certbot, DNS utilities, and other dependencies
- Configures Nginx with custom domain support
- Sets up firewall rules
- Creates systemd service and cron jobs
- Configures log rotation

**Usage**:
```bash
sudo ./setup.sh
```

### `manage-domain.sh` - Main Domain Manager
**Purpose**: Handles all domain management operations (replaces the main Lambda function)

**Actions**:
- `request` - Request SSL certificate and configure domain
- `check` - Check domain configuration and DNS
- `delete` - Delete domain configuration and certificate
- `renew` - Renew all certificates
- `list` - List all configured domains

**Usage Examples**:
```bash
# Request certificate and configure domain
sudo ./manage-domain.sh request example.com admin@example.com

# Check domain status
sudo ./manage-domain.sh check example.com

# Check domain with expected IPs
sudo ./manage-domain.sh check example.com 192.168.1.1 192.168.1.2

# Delete domain
sudo ./manage-domain.sh delete example.com

# List all domains
sudo ./manage-domain.sh list

# Renew certificates
sudo ./manage-domain.sh renew
```

### `verify-dns.sh` - DNS Verification
**Purpose**: Verifies DNS configuration and identifies DNS providers (replaces verify-dns Lambda)

**Features**:
- Multi-DNS server resolution
- DNS provider detection (Cloudflare, Route 53, GoDaddy, etc.)
- Cloudflare proxy detection
- A record validation
- JSON output for API integration

**Usage Examples**:
```bash
# Basic verification
sudo ./verify-dns.sh example.com

# Verify with expected IPs
sudo ./verify-dns.sh example.com 192.168.1.1 192.168.1.2

# Check subdomain
sudo ./verify-dns.sh sub.example.com 10.0.0.1
```

### `config.sh` - Configuration File
**Purpose**: Centralized configuration for all scripts

**Key Settings**:
```bash
# Backend Application
BACKEND_APP_PORT=3000
BACKEND_APP_HOST="127.0.0.1"

# Certificate Management
EMAIL="admin@example.com"
STAGING="false"
FORCE_RENEWAL="false"

# DNS Verification
DNS_SERVERS=("8.8.8.8" "8.8.4.4" "1.1.1.1" "1.0.0.1")
DNS_TIMEOUT=30
DNS_RETRIES=3

# Security Settings
SSL_PROTOCOLS="TLSv1.2 TLSv1.3"
SSL_CIPHERS="ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384"
```

## 🔧 System Requirements

### Operating Systems Supported
- **Ubuntu** 18.04+
- **Debian** 9+
- **CentOS** 7+
- **Red Hat Enterprise Linux** 7+
- **Rocky Linux** 8+
- **AlmaLinux** 8+
- **Amazon Linux** 2 & 2023

### Dependencies
- **Nginx** - Web server and reverse proxy
- **Certbot** - SSL certificate management
- **bind-utils** - DNS utilities (dig command)
- **jq** - JSON processor
- **Node.js** - For potential API backend
- **curl** - HTTP client
- **systemd** - Service management

## 🏗️ Architecture

### Before (AWS)
```
User Request → API Gateway → Lambda → ACM → ALB
```

### After (Server-based)
```
User Request → Nginx → Scripts → Certbot → Nginx
```

### Components
1. **Nginx**: Reverse proxy and SSL termination
2. **Certbot**: Let's Encrypt certificate management
3. **Shell Scripts**: Domain management logic
4. **Systemd**: Service management and auto-restart
5. **Cron**: Automatic certificate renewal

## 📋 Workflow

### 1. Domain Request
```bash
sudo ./manage-domain.sh request example.com admin@example.com
```
- Validates domain format
- Requests SSL certificate from Let's Encrypt
- Creates Nginx configuration
- Enables site and reloads Nginx

### 2. DNS Verification
```bash
sudo ./verify-dns.sh example.com 192.168.1.1
```
- Identifies DNS provider
- Checks A record resolution
- Validates against expected IPs
- Provides detailed feedback

### 3. Domain Management
```bash
sudo ./manage-domain.sh check example.com
sudo ./manage-domain.sh list
sudo ./manage-domain.sh renew
```

## 🔒 Security Features

- **SSL/TLS 1.2+**: Modern encryption protocols
- **Security Headers**: XSS protection, frame options, etc.
- **Firewall Configuration**: Automatic UFW/firewalld setup
- **Root Access**: Required for system-level operations
- **Certificate Validation**: Proper ACME challenge handling

## 📊 Monitoring & Logging

### Log Files
- `domain-manager.log` - Main domain management logs
- `dns-verify.log` - DNS verification logs
- `setup.log` - Installation logs
- `cron.log` - Certificate renewal logs

### Log Rotation
- Daily rotation
- 7-day retention
- Compression enabled
- Automatic service reload

### Systemd Service
```bash
# Service management
sudo systemctl start domain-manager.service
sudo systemctl status domain-manager.service
sudo journalctl -u domain-manager.service

# Auto-restart on failure
sudo systemctl enable domain-manager.service
```

## 🚨 Troubleshooting

### Common Issues

1. **Permission Denied**
   ```bash
   sudo chmod +x *.sh
   sudo chown root:root *.sh
   ```

2. **Nginx Configuration Error**
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

3. **Certbot Issues**
   ```bash
   sudo certbot --version
   sudo certbot certificates
   ```

4. **DNS Resolution Problems**
   ```bash
   dig example.com @8.8.8.8
   nslookup example.com 8.8.8.8
   ```

### Debug Mode
Set in `config.sh`:
```bash
DEBUG_MODE="true"
LOG_LEVEL="DEBUG"
```

## 🔄 Migration from AWS

### What Changes
- **ACM** → **Certbot + Let's Encrypt**
- **ALB** → **Nginx reverse proxy**
- **Lambda** → **Shell scripts**
- **API Gateway** → **Nginx + backend API**
- **CloudWatch** → **System logs + logrotate**

### Benefits
- **Cost**: Free Let's Encrypt certificates
- **Control**: Full server control
- **Flexibility**: Custom configurations
- **Performance**: Direct server access
- **Compliance**: On-premises deployment

### Considerations
- **Maintenance**: Manual server management
- **Scaling**: Manual scaling vs. auto-scaling
- **Backup**: Manual backup strategies
- **Monitoring**: Custom monitoring setup

## 📚 Examples

### Complete Domain Setup
```bash
# 1. Install system
sudo ./setup.sh

# 2. Configure settings
sudo nano config.sh

# 3. Add domain
sudo ./manage-domain.sh request myapp.com admin@myapp.com

# 4. Verify DNS
sudo ./verify-dns.sh myapp.com 192.168.1.100

# 5. Check status
sudo ./manage-domain.sh check myapp.com

# 6. List all domains
sudo ./manage-domain.sh list
```

### Batch Domain Management
```bash
# Add multiple domains
for domain in app1.com app2.com app3.com; do
    sudo ./manage-domain.sh request "$domain" admin@company.com
done

# Check all domains
for domain in app1.com app2.com app3.com; do
    sudo ./manage-domain.sh check "$domain"
done
```

### Certificate Renewal
```bash
# Manual renewal
sudo ./manage-domain.sh renew

# Check renewal status
sudo certbot certificates

# View renewal logs
sudo journalctl -u certbot.timer
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For issues and questions:
1. Check the logs in the scripts directory
2. Review the troubleshooting section
3. Check systemd service status
4. Verify Nginx configuration
5. Test DNS resolution manually

---

**Note**: This system replaces AWS Lambda functionality with traditional server-based tools. Ensure you have proper backup and monitoring strategies in place.
