<?php

/**
 * TEST-ONLY. Wires the usctdp_mgmt_checkout_lock_delay_ms filter
 * (class-usctdp-mgmt-woocommerce-hooks.php, after_checkout_validation())
 * to a plain WP option, so tests/capacity-concurrency.spec.ts can hold a
 * reservation group's row lock open for a controlled moment and force two
 * racing checkouts to genuinely overlap, instead of merely hoping
 * Promise.all's request timing happens to collide.
 *
 * Deliberately lives under tests/fixtures/, NOT projects/usctdp-bedrock/ -
 * Taskfile.test.yml's `sync` task copies this into the isolated test
 * stack's own web/app/mu-plugins/ directory, which is a separate tree
 * (projects_test/) from what actually gets deployed. This file must never
 * exist in a real deployment's mu-plugins directory.
 *
 * The option itself (usctdp_test_lock_delay_ms) defaults to 0/unset, so
 * even if this file WERE somehow present somewhere, it's a no-op unless a
 * test explicitly sets the option immediately before a race and clears it
 * immediately after (see runWpCli() calls in capacity-concurrency.spec.ts).
 */

add_filter('usctdp_mgmt_checkout_lock_delay_ms', function () {
    return (int) get_option('usctdp_test_lock_delay_ms', 0);
});
