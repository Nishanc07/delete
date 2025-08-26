# config.py - Configuration for Custom Domain Management

# Backend Application Configuration
BACKEND_APP_PORT = 3000
BACKEND_APP_HOST = "127.0.0.1"

# Certificate Management
EMAIL = "siddhant@pearlthoughts"
STAGING = False            # Set to True for Let's Encrypt staging environment
FORCE_RENEWAL = False      # Set to True to force certificate renewal

# Nginx Configuration
NGINX_SITES_AVAILABLE = "/etc/nginx/sites-available"
NGINX_SITES_ENABLED = "/etc/nginx/sites-enabled"
NGINX_CONF_DIR = "/etc/nginx/conf.d"

# Certbot Configuration
CERTBOT_PATH = "/usr/bin/certbot"
CERTBOT_CONFIG_DIR = "/etc/letsencrypt"
CERTBOT_WORK_DIR = "/var/lib/letsencrypt"
CERTBOT_LOG_DIR = "/var/log/letsencrypt"

# DNS Verification
DNS_SERVERS = ["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1"]
DNS_TIMEOUT = 30
DNS_RETRIES = 3

# Logging
LOG_LEVEL = "INFO"        # DEBUG, INFO, WARNING, ERROR
LOG_FILE = "/var/log/domain-manager.log"
LOG_MAX_SIZE = "100M"
LOG_MAX_FILES = 5

# Security Settings
SSL_PROTOCOLS = "TLSv1.2 TLSv1.3"
SSL_CIPHERS = "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384"
SSL_SESSION_CACHE = "shared:SSL:10m"
SSL_SESSION_TIMEOUT = "10m"

# Health Check Configuration
HEALTH_CHECK_PATH = "/health"
HEALTH_CHECK_TIMEOUT = 5

# WebSocket Support
WEBSOCKET_ENABLED = True
WEBSOCKET_TIMEOUT = 60

# Rate Limiting (optional)
RATE_LIMIT_ENABLED = False
RATE_LIMIT_ZONE = "custom_domain"
RATE_LIMIT_RATE = "10r/s"

# Backup Configuration
BACKUP_ENABLED = True
BACKUP_DIR = "/var/backups/domain-configs"
BACKUP_RETENTION_DAYS = 30

# Monitoring and Alerts
MONITORING_ENABLED = False
ALERT_EMAIL = "alerts@example.com"
CERT_EXPIRY_WARNING_DAYS = 30

# Development/Testing
DEBUG_MODE = False
DRY_RUN = False
