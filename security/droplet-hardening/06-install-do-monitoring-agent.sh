#!/bin/bash
# Run as root (or via sudo). Installs DigitalOcean's own monitoring agent
# (do-agent) - gives you CPU/memory/disk alerts in the DO control panel.
# Mainly useful as a tripwire: a compromised box doing something it
# shouldn't (cryptomining, spamming, participating in a DDoS) usually shows
# up as a resource spike before you'd notice it any other way.
#
# Downloads the installer to a file and lets you inspect it before running,
# rather than piping straight to bash - same verify-before-trust approach
# used for every other script/binary in this project. DigitalOcean's own
# docs recommend this too.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

TMP_INSTALLER=$(mktemp)
trap 'rm -f "$TMP_INSTALLER"' EXIT

curl -sSL -o "$TMP_INSTALLER" https://repos.insights.digitalocean.com/install.sh

echo "Downloaded to $TMP_INSTALLER - review it before continuing:"
echo "  less $TMP_INSTALLER"
read -p "Reviewed it and ready to run? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Stopping without installing." >&2
  exit 1
fi

bash "$TMP_INSTALLER"

systemctl status do-agent --no-pager
