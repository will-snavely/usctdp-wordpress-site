# Droplet hardening

Numbered, standalone scripts - review each before running it, don't just
run the whole directory blind. Written for Ubuntu 22.04/24.04.

## Order matters, especially the first two

1. `01-create-sudo-user.sh <username>` - creates a non-root sudo user and
   copies your current SSH key to it. It'll also prompt you to set a local
   password for the account if it doesn't have one - that's for `sudo`'s own
   prompt, which checks separately from SSH login (which stays key-only).
   **Stop after this and verify you can actually log in as that user, in a
   separate terminal, before going further.**
2. `02-harden-ssh.sh` - disables root login and password auth. Refuses to
   run until you confirm you've done the verification from step 1. If you
   skip that verification and this locks you out, recovery means
   DigitalOcean's web-based recovery console, not a quick fix.
3. `03-setup-firewall.sh` - ufw, host-level. Only SSH/80/443 allowed in.
4. `04-setup-fail2ban.sh` - bans IPs after repeated failed SSH attempts.
5. `05-setup-unattended-upgrades.sh` - automatic OS security patches.
   Automatic reboot is left off on purpose (see comment in the script) -
   check `cat /var/run/reboot-required` periodically.
6. `06-install-do-monitoring-agent.sh` - resource-usage alerting, useful as
   a tripwire for a compromised box behaving oddly.

Run them as root over SSH, e.g.:

```
chmod +x *.sh
sudo ./01-create-sudo-user.sh youruser
# --- verify SSH access as youruser in a new terminal here ---
sudo ./02-harden-ssh.sh
# --- verify SSH access again before closing this terminal ---
sudo ./03-setup-firewall.sh
sudo ./04-setup-fail2ban.sh
sudo ./05-setup-unattended-upgrades.sh
sudo ./06-install-do-monitoring-agent.sh
```

## Two things these scripts can't do, because they're not droplet-side

**DigitalOcean Cloud Firewall** - a second, independent layer in front of
ufw: it blocks traffic before it ever reaches the droplet, which ufw can't
do (ufw only acts on traffic that's already arrived). Configure it in the
DO control panel under *Networking > Firewalls*: create a firewall with
inbound rules for SSH (22), HTTP (80), HTTPS (443) only, and attach it to
this droplet. Redundant with `03-setup-firewall.sh` on purpose - if one is
ever misconfigured or removed, the other still holds.

**Droplet backups/snapshots** - DO control panel, *Droplet > Backups*.
Note this backs up the whole droplet (OS + everything on disk), which is a
different, coarser thing than the application-level DB and uploads backups
already running inside the compose stack (`compose.prod.yaml`'s `backup`
and `uploads-backup` services) - worth having both, not one instead of the
other.

## Docker daemon note

This droplet's entire prod stack runs in Docker, so two things worth
confirming rather than assuming:

- The Docker daemon's remote API should not be exposed on a TCP port
  (`-H tcp://...`) without TLS - if it never has been, nothing to do here,
  just don't add it later without also adding client cert auth.
- Docker Engine itself gets security updates through the same `apt`
  mechanism `unattended-upgrades` already covers, *if* it was installed via
  Docker's official apt repository (the standard install method) rather
  than a one-off binary drop - worth a quick `apt policy docker-ce` to
  confirm it's tracking an apt repo, not something that update mechanism
  can't see.
