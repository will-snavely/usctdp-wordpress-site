import { BrowserContext, Page, test, expect } from '@playwright/test';
import {
  createFamily,
  createStudent,
  queryDb,
  runWpCli,
  selectFromSelect2,
  switchToUser,
  uniqueFamilyDetails,
} from './helpers';

// Exercises after_checkout_validation()'s actual locking
// (class-usctdp-mgmt-woocommerce-hooks.php) under real concurrency, rather
// than just "a full class rejects a new attempt" (already covered
// sequentially by waitlist.spec.ts) - two DIFFERENT customers, in two
// independent browser sessions, both racing for the SAME single remaining
// seat.
//
// Playwright dispatches both #place_order clicks via Promise.all, which on
// its own only makes overlap LIKELY, not guaranteed (pure network/process
// timing). To make the race deterministic, this sets the
// usctdp_test_lock_delay_ms option before firing it - a test-only hook
// (usctdp_mgmt_checkout_lock_delay_ms filter in
// class-usctdp-mgmt-woocommerce-hooks.php, wired up by
// tests/fixtures/mu-plugins/usctdp-test-lock-delay.php, which only exists
// in the isolated test stack - see Taskfile.test.yml's `sync` task) that
// holds whichever request acquires the reservation group's row lock first
// open for a moment, guaranteeing the second request has arrived and is
// genuinely blocked on that same lock before the first one releases it.
// The assertions themselves - exactly one success, capacity never
// exceeded - would still be correct without this (see the option cleared
// in `finally` below), just probabilistic rather than deterministic about
// whether they'd ever have a chance to catch a regression.
//
// Deliberately its own brand-new, dedicated (unshared), capacity=1 clinic
// activity - not "Test Clinic"'s own Monday slot or the shared-group
// synthetic Wednesday one from waitlist.spec.ts - so there's exactly one
// seat to race for and zero interaction with what those other spec
// files/describe blocks assume about "Test Clinic"'s state.

async function attemptCheckout(page: Page): Promise<'success' | 'blocked' | 'unknown'> {
  await page.locator('#place_order').click();

  // Success navigates to order-received; a rejected out_of_stock/
  // already_enrolled/etc. validation error re-renders the SAME checkout
  // page with a WooCommerce notice instead - racing these two waits (each
  // independently caught, so neither becomes an unhandled rejection when
  // it's the losing branch) classifies whichever actually happened without
  // needing to know in advance which page would win.
  const success = page
    .waitForURL(/order-received/, { timeout: 20_000 })
    .then(() => 'success' as const)
    .catch(() => 'unknown' as const);
  const blocked = page
    .locator('.woocommerce-error')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => 'blocked' as const)
    .catch(() => 'unknown' as const);

  return Promise.race([success, blocked]);
}

async function getToPlaceOrder(
  page: Page,
  family: { address: string; city: string; state: string; zip: string; email: string },
  student: { firstName: string; lastName: string }
) {
  await page.goto('/product/test-clinic/');
  await page.locator('#days-per-week').selectOption('One');
  await selectFromSelect2(page, 'student_select', student.firstName);
  await selectFromSelect2(page, 'day_of_week_1', 'Friday');
  await page.locator('.single_add_to_cart_button').click();

  await page.goto('/checkout/');
  await page.locator('#billing_first_name').fill(student.firstName);
  await page.locator('#billing_last_name').fill(student.lastName);
  await page.locator('#billing_address_1').fill(family.address);
  await page.locator('#billing_city').fill(family.city);
  await page.locator('#billing_state').selectOption(family.state);
  await page.locator('#billing_postcode').fill(family.zip);
  await page.locator('#billing_email').fill(family.email);
  await page.locator('#payment_method_cod').check();
  // Stops short of clicking #place_order - that click is the timed race in
  // attemptCheckout(), fired for both pages together via Promise.all.
}

test('two customers racing for the last seat - exactly one succeeds, no overbooking', async ({ browser }) => {
  test.setTimeout(120_000);

  let activityId: string | undefined;
  let groupId: string | undefined;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;

  try {
    const [testClinic] = queryDb(`
      SELECT act.session_id AS session_id, act.product_id AS product_id, act.level AS level
      FROM wp_usctdp_activity act
      JOIN wp_usctdp_product prod ON act.product_id = prod.id
      WHERE prod.title = 'Test Clinic'
    `);
    expect(testClinic).toBeTruthy();

    const uniqueTag = `race-${Date.now()}`;
    queryDb(`INSERT INTO wp_usctdp_reservation_group (capacity, created_at, updated_at) VALUES (1, NOW(), NOW())`);
    const [group] = queryDb(`SELECT id FROM wp_usctdp_reservation_group ORDER BY id DESC LIMIT 1`);
    groupId = group.id;

    const title = `Test Clinic, Friday, 3:30 PM to 4:15 PM (${uniqueTag})`;
    queryDb(`
      INSERT INTO wp_usctdp_activity (session_id, product_id, type, title, level, search_term, reservation_group_id)
      VALUES (${testClinic.session_id}, ${testClinic.product_id}, 'clinic', '${title}', '${testClinic.level}', '${uniqueTag}', ${groupId})
    `);
    const [activity] = queryDb(`SELECT id FROM wp_usctdp_activity WHERE title = '${title}'`);
    activityId = activity.id;
    queryDb(
      `INSERT INTO wp_usctdp_clinic (id, day_of_week, start_time, end_time) VALUES (${activityId}, 5, '15:30:00', '16:15:00')`
    );

    contextA = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    contextB = await browser.newContext({ storageState: 'playwright/.auth/user.json' });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const familyA = uniqueFamilyDetails();
    const studentA = { firstName: 'RacerA', lastName: familyA.lastName, birthdate: '2015-06-01', level: 'Beginner' };
    const familyB = uniqueFamilyDetails();
    const studentB = { firstName: 'RacerB', lastName: familyB.lastName, birthdate: '2015-06-01', level: 'Beginner' };

    // Both families/students are created via the SAME still-admin page
    // (pageA, before it switches to a customer identity below) - createFamily
    // navigates fresh each call, so doing this twice in sequence on one page
    // is the same pattern registration.spec.ts's two-students test already
    // relies on.
    await createFamily(pageA, familyA);
    await createStudent(pageA, studentA);
    await createFamily(pageA, familyB);
    await createStudent(pageA, studentB);

    await switchToUser(pageA, familyA.email);
    await switchToUser(pageB, familyB.email);

    await getToPlaceOrder(pageA, familyA, studentA);
    await getToPlaceOrder(pageB, familyB, studentB);

    // Whichever request acquires the lock first will hold it open for
    // 300ms - comfortably longer than the few ms of network/dispatch
    // jitter between the two Promise.all-fired clicks below, so the second
    // request is guaranteed to have arrived and be genuinely blocked on
    // the same row lock before the first one releases it.
    runWpCli(['option', 'update', 'usctdp_test_lock_delay_ms', '300']);

    // The actual race: both submissions fired together.
    const [outcomeA, outcomeB] = await Promise.all([attemptCheckout(pageA), attemptCheckout(pageB)]);

    expect([outcomeA, outcomeB]).not.toContain('unknown');
    expect([outcomeA, outcomeB].filter((o) => o === 'success')).toHaveLength(1);
    expect([outcomeA, outcomeB].filter((o) => o === 'blocked')).toHaveLength(1);

    const blockedPage = outcomeA === 'blocked' ? pageA : pageB;
    await expect(blockedPage.locator('.woocommerce-error')).toContainText('is currently full');

    // The real guarantee, independent of how the UI-level race was
    // classified above: never more than the activity's capacity (1) worth
    // of active/pending registrations, no matter which request actually won.
    const registrations = queryDb(
      `SELECT id, status FROM wp_usctdp_registration WHERE activity_id = ${activityId} AND status IN ('active', 'pending')`
    );
    expect(registrations).toHaveLength(1);
  } finally {
    // Cleared unconditionally (delete is a safe no-op if it was never set,
    // e.g. an earlier setup step threw first) - this option controlling a
    // real delay on the live checkout path is not something to ever leave
    // set by accident.
    runWpCli(['option', 'delete', 'usctdp_test_lock_delay_ms']);

    if (contextA) await contextA.close();
    if (contextB) await contextB.close();

    if (activityId) {
      queryDb(`DELETE FROM wp_usctdp_registration WHERE activity_id = ${activityId}`);
      queryDb(`DELETE FROM wp_usctdp_clinic WHERE id = ${activityId}`);
      queryDb(`DELETE FROM wp_usctdp_activity WHERE id = ${activityId}`);
    }
    if (groupId) {
      queryDb(`DELETE FROM wp_usctdp_reservation_group WHERE id = ${groupId}`);
    }
  }
});
