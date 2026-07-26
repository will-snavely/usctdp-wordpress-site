#!/bin/sh
# Probes the plugin's REST namespace (usctdp-mgmt/v1) for known routes
# (students/, waitlist/, clinics/1/1) plus a handful of guessed route names
# that don't exist in the plugin today, as unauthenticated requests.
#
# Per class-usctdp-mgmt-public.php, students/ and waitlist/ require
# is_user_logged_in() and clinics/ only needs a valid session/product id -
# so unauthenticated requests to the known routes should come back 401
# (or, for clinics/, a normal 200 with clinic data - it's intentionally
# public). Anything else responding with a 200, or any guessed route
# responding at all instead of REST's standard 404 rest_no_route, means a
# route exists that wasn't accounted for in the last audit and needs a look.
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/config.sh"
mkdir -p "$SCRIPT_DIR/results"

$FFUF_DOCKER_RUN \
  -w /wordlists/rest-routes.txt \
  -u "${BASE_URL}/wp-json/usctdp-mgmt/v1/FUZZ" \
  -t "$THREADS" -rate "$RATE" \
  -mc all \
  -o /results/rest-api.json -of json
