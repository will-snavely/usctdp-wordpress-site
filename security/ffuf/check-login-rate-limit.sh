#!/bin/sh
# Fires a burst of 30 concurrent GET requests at wp-login.php (rendering the
# login form only - no credentials submitted, no brute forcing) to confirm
# the nginx rate limiter in sage_dev/nginx/prod.conf.main actually engages.
#
# Only meaningful against a target sitting behind that config
# (sage_dev/compose.prod.yaml). The default dev stack's proxy generates its
# own config via dev_entrypoint.sh, which has no rate limiter, so running
# this against the default BASE_URL will just show 30 plain 200s.
#
# Expect the first few requests through (up to the burst=5 allowance in
# limit_req_zone=login_zone), then 503s for the rest of the burst.
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/config.sh"
mkdir -p "$SCRIPT_DIR/results"

$FFUF_DOCKER_RUN \
  -w /wordlists/burst-30.txt \
  -u "${BASE_URL}/wp-login.php?probe=FUZZ" \
  -t 30 -rate 0 \
  -mc all \
  -o /results/login-rate-limit.json -of json
