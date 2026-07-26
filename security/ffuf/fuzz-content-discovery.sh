#!/bin/sh
# Checks a curated list of sensitive Bedrock/WordPress paths for accidental
# web exposure: secrets, debug logs, VCS metadata, dependency manifests, and
# a few directories that shouldn't be browsable. Everything in
# sensitive-paths.txt should come back 404 - filtered out here so only the
# exceptions show up. A 200/301/403-with-body is worth investigating.
#
# .env and wp-config.php are included as regression checks, not expected
# findings: Bedrock keeps both outside the web root (web/) by design, so
# they should 404 unless something changes that.
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/config.sh"
mkdir -p "$SCRIPT_DIR/results"

$FFUF_DOCKER_RUN \
  -w /wordlists/sensitive-paths.txt \
  -u "${BASE_URL}/FUZZ" \
  -t "$THREADS" -rate "$RATE" \
  -mc all -fc 404 \
  -o /results/content-discovery.json -of json
