#!/bin/sh
# Probes every action registered in Usctdp_Mgmt_Admin_Ajax::$ajax_handlers,
# plus five unregistered decoy names at the end of the wordlist
# (export_ledger, delete_family, delete_student, admin_login, get_settings),
# as unauthenticated requests against admin-ajax.php.
#
# check_nonce() checks current_user_can('manage_options') before it checks
# the nonce, so every REGISTERED action should come back with the same
# status/size (403, "You do not have permission..."). A registered action
# that instead responds differently from the pack, or with a 200, is a
# capability-check regression worth investigating immediately. The decoy
# actions should come back as WordPress core's default unregistered-action
# response - a different, consistent shape - which gives you a baseline to
# diff registered actions against.
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/config.sh"
mkdir -p "$SCRIPT_DIR/results"

$FFUF_DOCKER_RUN \
  -w /wordlists/admin-ajax-actions.txt \
  -u "${BASE_URL}/wp-admin/admin-ajax.php?action=FUZZ" \
  -t "$THREADS" -rate "$RATE" \
  -mc all \
  -o /results/admin-ajax.json -of json
