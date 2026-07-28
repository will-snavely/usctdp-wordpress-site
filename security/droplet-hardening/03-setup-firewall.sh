#!/bin/bash
# Run as root (or via sudo). Sets up ufw as a host-level firewall: only
# SSH, HTTP, and HTTPS get in, everything else is denied by default.
#
# This is meant to sit alongside a DigitalOcean Cloud Firewall configured
# the same way (see README.md in this directory) - two independent layers,
# not a replacement for each other. ufw protects the droplet even if the
# Cloud Firewall is ever misconfigured or removed; the Cloud Firewall
# blocks traffic before it reaches the droplet at all, which ufw can't do.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

apt-get update
apt-get install -y ufw

ufw default deny incoming
ufw default allow outgoing

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp

ufw --force enable

ufw status verbose
