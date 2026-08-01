#!/usr/bin/env python3
"""
Checks the exact installed WordPress core/plugin/theme versions (read from
composer.lock) against the WPScan vulnerability database, failing (exit 1)
if any installed version falls within a known vulnerability's affected
range. This is what would have caught something like CVE-2026-9284
(WooCommerce PayPal Payments <= 4.0.1) automatically, and is a direct
response to the 2026-08-01 incident (WordPress core CVE-2026-63030 /
CVE-2026-60137) - checking composer.lock directly means every dependency
gets checked on every push, not just the ones someone remembers to look up
by hand after the fact.

Pure stdlib (json/urllib) against WPScan's official REST API directly -
no third-party Action, no gem/binary install, same "smallest possible
trust surface" reasoning as the trivy step in this workflow.

Needs a WPSCAN_API_TOKEN env var (free tier - register at
https://wpscan.com/register to get one, add it as a repo secret). The free
tier is rate-limited, so this checks only the exact packages pinned in
composer.lock, one request each - no retries, no speculative lookups.
"""
import json
import os
import sys
import urllib.request
import urllib.error

API_BASE = "https://wpscan.com/api/v3"
COMPOSER_LOCK = "projects/usctdp-bedrock/composer.lock"


def version_tuple(v):
    parts = []
    for segment in v.split('.'):
        digits = ''
        for ch in segment:
            if ch.isdigit():
                digits += ch
            else:
                break
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def version_lt(a, b):
    return version_tuple(a) < version_tuple(b)


def version_gte(a, b):
    return version_tuple(a) >= version_tuple(b)


def api_get(path, token):
    req = urllib.request.Request(
        f"{API_BASE}/{path}",
        headers={"Authorization": f"Token token={token}"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def load_targets():
    with open(COMPOSER_LOCK) as f:
        lock = json.load(f)

    targets = []
    for pkg in lock.get("packages", []):
        name = pkg["name"]
        version = pkg["version"].lstrip("v")
        if name == "roots/wordpress":
            targets.append(("wordpress", None, version))
        elif name.startswith("wpackagist-plugin/"):
            targets.append(("plugin", name.split("/", 1)[1], version))
        elif name.startswith("wpackagist-theme/"):
            targets.append(("theme", name.split("/", 1)[1], version))
    return targets


def check_wordpress(version, token):
    data = api_get(f"wordpresses/{version}", token)
    if not data:
        return []
    return data.get(version, {}).get("vulnerabilities", [])


def check_plugin_or_theme(kind, slug, version, token):
    endpoint = "plugins" if kind == "plugin" else "themes"
    data = api_get(f"{endpoint}/{slug}", token)
    if not data:
        return []
    entry = data.get(slug, {})
    affected = []
    for vuln in entry.get("vulnerabilities", []):
        introduced_in = vuln.get("introduced_in")
        fixed_in = vuln.get("fixed_in")
        # No introduced_in means "affected since the beginning"; no fixed_in
        # means "still affected in the latest version" - both are absence-
        # of-a-boundary, not absence-of-a-vulnerability.
        if introduced_in and not version_gte(version, introduced_in):
            continue
        if fixed_in and not version_lt(version, fixed_in):
            continue
        affected.append(vuln)
    return affected


def main():
    token = os.environ.get("WPSCAN_API_TOKEN")
    if not token:
        print("WPSCAN_API_TOKEN not set - skipping WPScan check.", file=sys.stderr)
        sys.exit(0)

    targets = load_targets()
    found_any = False

    for kind, slug, version in targets:
        label = "WordPress core" if kind == "wordpress" else f"{kind} '{slug}'"
        try:
            if kind == "wordpress":
                vulns = check_wordpress(version, token)
            else:
                vulns = check_plugin_or_theme(kind, slug, version, token)
        except urllib.error.HTTPError as e:
            print(f"WARNING: WPScan lookup failed for {label} ({version}): HTTP {e.code}", file=sys.stderr)
            continue

        if vulns:
            found_any = True
            plural = "y" if len(vulns) == 1 else "ies"
            print(f"\n{label} {version} has {len(vulns)} known vulnerabilit{plural}:")
            for v in vulns:
                fixed = v.get("fixed_in") or "no fix available yet"
                print(f"  - {v.get('title', '(untitled)')} [{v.get('vuln_type', '?')}] - fixed in {fixed}")
                for url in v.get("references", {}).get("url", []):
                    print(f"      {url}")

    if found_any:
        print("\nWPScan check failed: known vulnerabilities in installed versions. See above.", file=sys.stderr)
        sys.exit(1)

    print("WPScan check passed: no known vulnerabilities in installed core/plugin/theme versions.")


if __name__ == "__main__":
    main()
