#!/bin/bash
# Run as root (or via sudo). Installs fail2ban and enables its sshd jail -
# bans an IP after repeated failed SSH login attempts. Defense-in-depth
# alongside key-only auth (02-harden-ssh.sh already disables password
# login, so this mainly guards against the auth attempts themselves eating
# CPU/log space, and covers any future slip in that config).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

apt-get update
apt-get install -y fail2ban

# jail.local overrides jail.conf and survives package upgrades - never edit
# jail.conf directly, it gets overwritten.
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF

systemctl enable --now fail2ban
systemctl status fail2ban --no-pager
fail2ban-client status sshd
