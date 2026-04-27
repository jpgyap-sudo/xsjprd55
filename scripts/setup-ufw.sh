#!/usr/bin/env bash
# ============================================================
# UFW Firewall Setup for DigitalOcean Droplet
# Run as root on a fresh Ubuntu Droplet.
# ============================================================

set -e

echo "========================================"
echo "Setting up UFW firewall"
echo "========================================"

# Reset UFW to defaults
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# SSH (essential!)
ufw allow 22/tcp

# HTTP / HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Bot app port (only if not behind reverse proxy)
# ufw allow 3000/tcp

# Enable UFW
ufw --force enable

echo "✅ UFW rules applied:"
ufw status verbose

echo ""
echo "========================================"
echo "Firewall active. Ports open:"
echo "  22  (SSH)"
echo "  80  (HTTP)"
echo "  443 (HTTPS)"
echo "========================================"
