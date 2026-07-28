#!/bin/bash
# Run as root (or via sudo). Enables automatic installation of security
# updates - same reasoning as the `apt-get upgrade` layer already added to
# the app's own Dockerfile earlier in this project: an unpatched OS is
# exactly the kind of thing that silently accumulates risk if nobody's
# manually keeping up with it.
#
# Deliberately leaves automatic reboots OFF (Automatic-Reboot "false"
# below) - a kernel security update sometimes needs a reboot to fully take
# effect, but auto-rebooting a live production box on its own schedule
# risks unexpected downtime. Flip it to "true" if you'd rather have
# fully hands-off patching and accept that tradeoff; either way, check
# `cat /var/run/reboot-required` periodically to know when a manual
# reboot is actually needed.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

apt-get update
apt-get install -y unattended-upgrades apt-listchanges

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

# New file rather than editing the package-maintained 50unattended-upgrades
# directly - apt.conf.d files are read cumulatively in filename order, so
# this coexists cleanly and survives package upgrades to that file.
cat > /etc/apt/apt.conf.d/51usctdp-unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF

systemctl enable --now unattended-upgrades

# Dry run to confirm the config is valid and see what it would do.
unattended-upgrade --dry-run --debug
