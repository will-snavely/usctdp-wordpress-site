# Security Measures — Plain-Language Summary

This document explains, without technical jargon, what has been done to keep
the USCTDP website and its data safe. It's meant to be readable by anyone,
not just developers.

## 1. Locking down the server itself

The website runs on a server (a "droplet") hosted at DigitalOcean. Several
layers of protection are in place so that even if someone tries to break in,
they hit a wall at every step:

- **No more logging in as an all-powerful "root" user, and no password
  logins at all.** The only way in is with a securely generated digital key
  (like a very long, un-guessable password that never gets typed or sent
  over the network).
- **A firewall** blocks every incoming connection except the ones the site
  actually needs (secure web traffic, and the one door used for
  maintenance). This exists in two independent layers — one on the server
  itself, one in front of it at the hosting provider — so a mistake in one
  doesn't leave the door open.
- **Automatic banning of repeated break-in attempts.** If something tries
  to guess its way in repeatedly, it gets locked out automatically.
- **Automatic security patching.** When the underlying operating system
  gets a security fix, it's applied automatically rather than waiting for
  someone to remember to do it.
- **Monitoring for unusual activity.** If the server ever starts behaving
  strangely (for example, using far more resources than normal — a common
  sign of a break-in), an alert is generated.

## 2. Protecting the website itself

- **All traffic is encrypted** (the padlock/HTTPS in the browser), and the
  site forces every visitor onto the encrypted connection — there's no way
  to load it insecurely.
- **Browser-level protections** are turned on that stop common web attacks
  like clickjacking (tricking a user into clicking something disguised as
  something else) and content-sniffing attacks.
- **The login page is rate-limited**, meaning an attacker can't rapidly
  machine-gun thousands of password guesses at it.
- **Unused, risky legacy features are switched off** (an old remote-access
  feature from WordPress's early days that's a common attack target).
- **Two-factor authentication** is available for admin accounts — so even
  if a password were ever stolen or guessed, an attacker would still need a
  second code to get in.
- **Email verification for customer accounts** on the store, to cut down on
  fake or fraudulent account creation.
- The site's own defenses have been **actively tested** by deliberately
  trying to find weak points (looking for hidden/forgotten pages,
  checking whether the login page can be hammered with rapid attempts,
  and similar checks) — the same kind of testing a security professional
  would run, done proactively rather than waiting to find out the hard way.

## 3. Backups — so a disaster is recoverable, not catastrophic

- The website's **database** (all the actual content, orders, user
  accounts) is automatically backed up every night and stored securely
  off-server, with older backups cleaned up automatically after two weeks.
- **Uploaded files** (photos, documents, anything users or staff have
  uploaded) are also backed up nightly on the same schedule, separately
  from the database — so one type of data being fine doesn't mean the
  other is too.
- Both of these backups have been **manually tested end-to-end** — not just
  "assumed to be working" — by triggering a real backup on demand and
  confirming the file actually showed up in storage.
- Separately, DigitalOcean's own whole-server backup is also available as a
  coarser, independent safety net covering the entire server, not just the
  website's data.

## 4. Keeping the software itself trustworthy

- Every time an update to the website's code is published, it's
  **automatically scanned for known security vulnerabilities** before it's
  allowed to go live. If a serious, fixable vulnerability is found, the
  release is blocked until it's addressed.
- The base software images the site is built on are **regularly rebuilt** on
  a schedule, so security fixes from the broader open-source community get
  pulled in automatically rather than going stale.
- Every release is tagged with an exact version marker, so it's always
  possible to know precisely what code is running in production and to roll
  back to a known-good version if ever needed.

## What this adds up to

No system is unbreakable, but the goal here is **defense in depth** — many
independent layers, so that no single mistake or single attack technique is
enough to cause real harm. A break-in attempt has to get past the network
firewall, then the server's own firewall, then account lockout protection,
then encrypted-only access, then the website's own login protections and
two-factor authentication — and even in a worst-case scenario, verified,
working backups mean the site's data isn't at risk of being permanently
lost.
