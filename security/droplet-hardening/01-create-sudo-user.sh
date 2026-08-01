#!/bin/bash
# Run as root (or via sudo), over your existing SSH session.
#
# Creates a non-root user with sudo access and copies your current
# authorized_keys to it, so the SAME key you're using right now also works
# for the new user. This has to happen and be VERIFIED before
# 02-harden-ssh.sh disables root login - that script will lock you out
# entirely if there's no working non-root login yet.
#
# Usage: ./01-create-sudo-user.sh <username>
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

USERNAME="${1:-}"
if [ -z "$USERNAME" ]; then
  echo "Usage: $0 <username>" >&2
  exit 1
fi

if id "$USERNAME" >/dev/null 2>&1; then
  echo "User '$USERNAME' already exists - skipping creation, still verifying SSH key setup below."
else
  adduser --disabled-password --gecos "" "$USERNAME"
  usermod -aG sudo "$USERNAME"
  echo "Created '$USERNAME' and added to the sudo group."
fi

SRC_AUTH_KEYS="$HOME/.ssh/authorized_keys"
if [ ! -f "$SRC_AUTH_KEYS" ]; then
  echo "No authorized_keys found at $SRC_AUTH_KEYS - can't copy your key. Aborting." >&2
  exit 1
fi

DEST_HOME=$(eval echo "~$USERNAME")
mkdir -p "$DEST_HOME/.ssh"
cp "$SRC_AUTH_KEYS" "$DEST_HOME/.ssh/authorized_keys"
chown -R "$USERNAME:$USERNAME" "$DEST_HOME/.ssh"
chmod 700 "$DEST_HOME/.ssh"
chmod 600 "$DEST_HOME/.ssh/authorized_keys"

# adduser --disabled-password means exactly that - no password at all, not
# just "can't use it over SSH". sudo's own PAM prompt still needs one to
# authenticate against, and that check is completely separate from sshd's
# PasswordAuthentication setting (which 02-harden-ssh.sh turns off) - so
# setting a password here doesn't reopen remote password login, it just
# lets sudo work once you're already in via your key.
if [ "$(passwd -S "$USERNAME" | awk '{print $2}')" != "P" ]; then
  echo
  echo "'$USERNAME' has no password yet, and sudo needs one even though SSH"
  echo "login for this user is key-only. Set one now:"
  passwd "$USERNAME"
fi

echo
echo "=================================================================="
echo " STOP. Do not proceed to 02-harden-ssh.sh yet."
echo
echo " Open a NEW terminal (leave this SSH session open) and confirm you"
echo " can log in as the new user:"
echo
echo "   ssh $USERNAME@<your-droplet-ip>"
echo "   sudo whoami   # should print 'root'"
echo
echo " Only once that works should you run 02-harden-ssh.sh - it disables"
echo " root login and password auth, and if the new user doesn't already"
echo " work, you will lock yourself out with no way back in except"
echo " DigitalOcean's recovery console."
echo "=================================================================="
