#!/bin/bash
# Run as root, over an SSH session logged in as your non-root sudo user
# (not root) - confirming that login already works is the whole point of
# the stop-and-verify step at the end of 01-create-sudo-user.sh.
#
# Disables root SSH login and password authentication, leaving key-based
# login for your non-root user as the only way in. Do NOT run this until
# you've verified that login works, in a separate terminal, right now.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (or with sudo)." >&2
  exit 1
fi

read -p "Have you verified you can SSH in as your non-root user AND sudo works, in a separate open terminal, right now? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Stopping. Go verify that first - see the end of 01-create-sudo-user.sh." >&2
  exit 1
fi

# Drop-in file, not editing sshd_config directly: Ubuntu's default
# sshd_config has `Include /etc/ssh/sshd_config.d/*.conf` as its first
# line, and OpenSSH uses first-match-wins for these directives, so this
# file's settings take precedence over anything later in the main config -
# no risk of a botched sed leaving the main file in a broken state.
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PermitEmptyPasswords no
KbdInteractiveAuthentication no
X11Forwarding no
EOF

# Validate before restarting - if this fails, sshd_config is untouched by
# the restart and your current session stays alive either way.
if ! sshd -t; then
  echo "sshd config test failed - NOT restarting. Existing SSH sessions are unaffected." >&2
  rm -f /etc/ssh/sshd_config.d/99-hardening.conf
  exit 1
fi

systemctl restart ssh

echo
echo "=================================================================="
echo " Done. Root login and password auth are now disabled."
echo
echo " Before closing this terminal: open ANOTHER new terminal and"
echo " confirm you can still SSH in as your non-root user. This terminal"
echo " should stay open until you've confirmed that, in case something"
echo " needs to be rolled back (config backup is not created since this"
echo " uses a separate drop-in file - just delete"
echo " /etc/ssh/sshd_config.d/99-hardening.conf and run"
echo " 'systemctl restart ssh' to revert)."
echo "=================================================================="
