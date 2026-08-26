import { test, expect } from '@playwright/test';
import { createFamily, createStudent, queryDb, selectFromSelect2, uniqueFamilyDetails } from './helpers';

// Covers the "Confirm Registration Update" modal on the admin History page
// (reviewPriceChange()/updateRegistration() in usctdp-mgmt-admin-history.js;
// get_price_change()/ajax_preview_registration_activity_change() in
// class-usctdp-mgmt-admin-ajax.php) - what happens when an admin moves an
// existing registration to a different, differently-priced activity:
// recomputing/persisting discounts, writing the price-adjustment ledger
// entry, and Cancel being a genuine no-op (nothing saved until confirmed).
//
// Needs a second, differently-priced activity to move a registration to,
// which the shared e2e fixtures don't provide (tests/fixtures/e2e-*.json
// define exactly one priced activity, "Test Clinic" at $100/one day).
// Built as a self-contained fixture below, same technique capacity-
// concurrency.spec.ts already uses for its own dynamic "Friday" activity -
// reuses Test Clinic's existing WooCommerce product (no new WC product
// needed: this flow never touches WooCommerce at all, only
// usctdp_activity/usctdp_pricing/usctdp_registration/usctdp_ledger), just
// cloning its session into a new one with its own, different-priced
// usctdp_pricing row.

interface SecondActivityFixture {
  sessionId: number;
  sessionTitle: string;
  activityId: number;
  activityTitle: string;
  groupId: number;
  uniqueTag: string;
}

async function createSecondPricedActivity(uniqueTag: string): Promise<SecondActivityFixture> {
  const [testClinic] = queryDb(`
    SELECT act.session_id AS session_id, act.product_id AS product_id, act.level AS level
    FROM wp_usctdp_activity act
    JOIN wp_usctdp_product prod ON act.product_id = prod.id
    WHERE prod.title = 'Test Clinic'
  `);
  expect(testClinic).toBeTruthy();

  // Clones Test Session's own row rather than hand-crafting one, so
  // category/season/date columns stay valid without needing to know their
  // encoding - only title/search_term need to be distinct.
  const sessionTitle = `Test Session Alt ${uniqueTag}`;
  queryDb(`
    INSERT INTO wp_usctdp_session (title, search_term, status, start_date, end_date, num_weeks, category, season, meta)
    SELECT '${sessionTitle}', '${sessionTitle}', status, start_date, end_date, num_weeks, category, season, meta
    FROM wp_usctdp_session WHERE id = ${testClinic.session_id}
  `);
  const [session] = queryDb(`SELECT id FROM wp_usctdp_session WHERE title = '${sessionTitle}'`);
  const sessionId = Number(session.id);

  // $120/one day, $216/two days (same 1.8x two-day ratio as the Test Clinic
  // fixture's $100/$180) - deliberately different from the original so
  // get_price_change() reports a real delta.
  queryDb(`
    INSERT INTO wp_usctdp_pricing (session_id, product_id, pricing)
    VALUES (${sessionId}, ${testClinic.product_id}, '{"One": 120, "Two": 216}')
  `);

  queryDb(`INSERT INTO wp_usctdp_reservation_group (capacity, created_at, updated_at) VALUES (10, NOW(), NOW())`);
  const [group] = queryDb(`SELECT id FROM wp_usctdp_reservation_group ORDER BY id DESC LIMIT 1`);
  const groupId = Number(group.id);

  const activityTitle = `Test Clinic Alt, Wednesday, 3:30 PM to 4:15 PM (${uniqueTag})`;
  queryDb(`
    INSERT INTO wp_usctdp_activity (session_id, product_id, type, title, level, search_term, reservation_group_id)
    VALUES (${sessionId}, ${testClinic.product_id}, 'clinic', '${activityTitle}', '${testClinic.level}', '${uniqueTag}', ${groupId})
  `);
  const [activity] = queryDb(`SELECT id FROM wp_usctdp_activity WHERE title = '${activityTitle}'`);
  const activityId = Number(activity.id);
  queryDb(
    `INSERT INTO wp_usctdp_clinic (id, day_of_week, start_time, end_time) VALUES (${activityId}, 3, '15:30:00', '16:15:00')`
  );

  return { sessionId, sessionTitle, activityId, activityTitle, groupId, uniqueTag };
}

function cleanupSecondPricedActivity(fixture: SecondActivityFixture) {
  queryDb(`DELETE FROM wp_usctdp_registration WHERE activity_id = ${fixture.activityId}`);
  queryDb(`DELETE FROM wp_usctdp_clinic WHERE id = ${fixture.activityId}`);
  queryDb(`DELETE FROM wp_usctdp_activity WHERE id = ${fixture.activityId}`);
  queryDb(`DELETE FROM wp_usctdp_reservation_group WHERE id = ${fixture.groupId}`);
  queryDb(`DELETE FROM wp_usctdp_pricing WHERE session_id = ${fixture.sessionId}`);
  queryDb(`DELETE FROM wp_usctdp_session WHERE id = ${fixture.sessionId}`);
}

/** Registers a student for Test Clinic with a 10% sibling discount, paying later. */
async function registerWithSiblingDiscount(page: import('@playwright/test').Page) {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  const student = {
    firstName: 'Junior',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  };
  await createStudent(page, student);

  await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-register');
  await selectFromSelect2(page, 'family-selector', family.lastName);
  await selectFromSelect2(page, 'student-selector', student.firstName);
  await selectFromSelect2(page, 'session-selector', 'Test Session');
  await selectFromSelect2(page, 'clinic-selector', 'Test Clinic');
  await selectFromSelect2(page, 'activity-selector', 'Test Clinic');
  await expect(page.locator('#activity-preorder')).toBeVisible();
  await expect(page.locator('#clinic-only-discounts')).toBeVisible();
  await page.locator('#discount-sibling').check();
  await page.locator('#discount-sibling-percent').selectOption('10');
  await expect(page.locator('#sale-price-value')).toHaveText('$90.00');
  await page.locator('#add-activity-registration').click();
  await expect(page.locator('#payment-table-section')).toBeVisible();
  await page.locator('#payment-table-section .checkout-btn').click();
  await expect(async () => {
    await page.locator('#__usctdp_payment_payment_method').selectOption('pay_later');
    await page.locator('#__usctdp_payment_submit-payment-btn').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.waitForURL(/page=usctdp-admin-history.*family_id=(\d+)/);
  const familyId = Number(new URL(page.url()).searchParams.get('family_id'));

  const [studentRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${student.firstName}' AND last='${student.lastName}'`
  );
  const [registration] = queryDb(
    `SELECT * FROM wp_usctdp_registration WHERE student_id=${studentRow.id} AND status='active'`
  );
  const [purchase] = queryDb(`SELECT * FROM wp_usctdp_purchase WHERE id=${registration.purchase_id}`);

  return { family, familyId, student, registration, purchase };
}

/**
 * Puts a family's one registration row into edit mode and picks a new
 * session + activity - assumes exactly one purchase-card on the page
 * (a fresh test family's row is DataTables draw-index 0, so its selectors
 * are always...-selector-0, letting this reuse the shared selectFromSelect2
 * helper directly rather than resolving a dynamic per-row id).
 *
 * Searches by the fixture's bare uniqueTag rather than the full session/
 * activity title: search_sessions()/search_activities() (class-usctdp-mgmt-
 * session-query.php et al) run a FULLTEXT ... IN BOOLEAN MODE match, and
 * MariaDB's fulltext tokenizer splits on punctuation when *indexing*
 * content - so a title/tag containing a hyphen (or here, a whole sentence
 * of commas/colons/parens) gets indexed as several separate tokens, while a
 * search string typed verbatim (only split on whitespace) sends one
 * literal, differently-shaped term that can never match any of them. The
 * tag alone has no such punctuation, so it round-trips as one clean token
 * on both sides - and it's still enough to uniquely identify the right
 * <option> via hasText, since it's embedded in both full titles.
 */
async function editRegistrationActivity(
  page: import('@playwright/test').Page,
  familyId: number,
  fixture: SecondActivityFixture
) {
  await page.goto(`/wp/wp-admin/admin.php?page=usctdp-admin-history&family_id=${familyId}`);
  await page.locator('.edit-registration-btn').click();
  await selectFromSelect2(page, 'session-selector-0', fixture.uniqueTag, fixture.sessionTitle);
  await selectFromSelect2(page, 'activity-selector-0', fixture.uniqueTag, fixture.activityTitle);
  await page.locator('.save-registration-btn').click();
}

test.describe('Confirm Registration Update', () => {
  let fixture: SecondActivityFixture;
  let registrationId: number | undefined;

  test.beforeEach(async () => {
    // Alphanumeric only - see editRegistrationActivity()'s doc comment for
    // why a hyphen here breaks the fulltext search that finds this fixture.
    fixture = await createSecondPricedActivity(`ru${Date.now()}${Math.floor(Math.random() * 1000)}`);
    registrationId = undefined;
  });

  test.afterEach(() => {
    cleanupSecondPricedActivity(fixture);
    // registerWithSiblingDiscount() puts a *real* registration on the
    // shared "Test Clinic" Monday slot (fixture capacity 10) via the normal
    // register page - unlike the family/student/purchase it also creates,
    // which nothing else in the suite cares about being left behind, this
    // one genuinely needs freeing: waitlist.spec.ts computes its filler
    // count dynamically specifically to tolerate other spec files adding
    // real registrations here, but only up to that capacity ceiling, and
    // the storefront's own "is this day full" check (usctdp-mgmt-
    // product.js) draws from the same pool. Leaving this behind
    // permanently consumes one of those 10 seats for every later spec file
    // in the run, eventually starving both.
    if (registrationId) {
      queryDb(`DELETE FROM wp_usctdp_registration WHERE id=${registrationId}`);
    }
  });

  test('recomputes the discount and applies a price-increase adjustment when confirmed', async ({ page }) => {
    // Regression test for the original bug report: a discount added/
    // recomputed on a registration update never showed up on the next
    // edit's "Current" column, because usctdp_purchase.discounts was never
    // written back after the initial purchase. Also covers get_price_change()'s
    // additional-day/percent-discount recompute and the price-adjustment
    // ledger entry itself.
    test.setTimeout(90_000);

    const { familyId, purchase, registration: initialRegistration } = await registerWithSiblingDiscount(page);
    registrationId = Number(initialRegistration.id);
    expect(purchase.discounts).toContain('sibling_10');

    await editRegistrationActivity(page, familyId, fixture);

    // "Current": the $100 base, original 10% ($10) sibling discount, $90 net.
    await expect(page.locator('#confirm-registration-update-modal')).toBeVisible();
    await expect(page.locator('#current-base-price-display')).toHaveText('$100.00');
    await expect(page.locator('#current-discounts-list')).toContainText('$10.00');
    await expect(page.locator('#current-net-price-display')).toHaveText('$90.00');

    // "New": recomputed against the $120 activity - 10% of $120 = $12, so
    // $108 net. The point of this test: the discount followed the price
    // change automatically rather than being dropped.
    await expect(page.locator('#new-base-price-display')).toHaveText('$120.00');
    await expect(page.locator('#new-discounts-list')).toContainText('$12.00');
    await expect(page.locator('#new-net-price-display')).toHaveText('$108.00');
    await expect(page.locator('#registration-update-delta')).toContainText('$18.00');

    await page.locator('#confirm-registration-update-btn').click();
    await expect(page.getByText('Price adjustment applied.')).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();

    // Registration now points at the new activity.
    const [registration] = queryDb(`SELECT * FROM wp_usctdp_registration WHERE purchase_id=${purchase.id}`);
    expect(Number(registration.activity_id)).toBe(fixture.activityId);

    // usctdp_purchase.discounts persisted the *recomputed* $12 amount, not
    // the original $10 - re-fetched fresh from the DB, independent of
    // whatever the page happens to be showing. Parsed rather than string-
    // matched: ajax_update_purchase()'s discounts transform casts amount to
    // a real float (round(floatval(...), 2)), so it round-trips through
    // wp_json_encode() as a JSON number here - but that's specific to this
    // update path, not a guarantee worth hard-coding into the assertion.
    const [updatedPurchase] = queryDb(`SELECT * FROM wp_usctdp_purchase WHERE id=${purchase.id}`);
    const updatedDiscounts = JSON.parse(updatedPurchase.discounts);
    expect(updatedDiscounts).toHaveLength(1);
    expect(updatedDiscounts[0].code).toBe('sibling_10');
    expect(Number(updatedDiscounts[0].amount)).toBe(12);

    // Ledger: original $90 charge (charge + adjustment pair from the
    // discounted signup) plus a new $18 increase adjustment - $90 + $18 =
    // $108, matching the reviewed net price.
    const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`);
    const increaseAdjustments = ledgerRows.filter(
      (r) => r.entry_type === 'adjustment' && r.event === 'Registration Change'
    );
    expect(increaseAdjustments).toHaveLength(2); // registration_fees + revenue
    expect(Number(increaseAdjustments.find((r) => r.account === 'registration_fees')?.debit)).toBe(18);
    expect(Number(increaseAdjustments.find((r) => r.account === 'revenue')?.credit)).toBe(18);

    const [balanceRow] = queryDb(
      `SELECT SUM(debit) - SUM(credit) AS owed FROM wp_usctdp_ledger
       WHERE purchase_id=${purchase.id} AND account='registration_fees'`
    );
    expect(Number(balanceRow.owed)).toBe(108);
  });

  test('cancelling leaves the registration, ledger, and discounts untouched', async ({ page }) => {
    test.setTimeout(90_000);

    const { familyId, purchase } = await registerWithSiblingDiscount(page);
    const [originalRegistration] = queryDb(`SELECT * FROM wp_usctdp_registration WHERE purchase_id=${purchase.id}`);
    registrationId = Number(originalRegistration.id);
    const originalLedgerCount = queryDb(`SELECT id FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`).length;

    await editRegistrationActivity(page, familyId, fixture);
    await expect(page.locator('#confirm-registration-update-modal')).toBeVisible();
    await page.locator('#cancel-registration-update-btn').click();
    await expect(page.getByText('The registration was not changed.')).toBeVisible();
    await page.getByRole('button', { name: 'OK' }).click();

    // Nothing was ever saved: activity_id unchanged...
    const [registration] = queryDb(`SELECT * FROM wp_usctdp_registration WHERE purchase_id=${purchase.id}`);
    expect(Number(registration.activity_id)).toBe(Number(originalRegistration.activity_id));

    // ...no new ledger rows...
    const ledgerRows = queryDb(`SELECT id FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`);
    expect(ledgerRows).toHaveLength(originalLedgerCount);

    // ...and the discount snapshot still reflects the original $100-based
    // amount, not a recomputed one that was never actually confirmed.
    // Parsed rather than string-matched: this purchase's discounts came
    // from the original registration-creation path (parse_registration_data()
    // -> json_encode() of whatever raw strings arrived from $_POST, never
    // cast to a float), so "amount" round-trips as a JSON *string* ("10")
    // here, unlike the confirmed-update path in the test above.
    const [unchangedPurchase] = queryDb(`SELECT * FROM wp_usctdp_purchase WHERE id=${purchase.id}`);
    const unchangedDiscounts = JSON.parse(unchangedPurchase.discounts);
    expect(unchangedDiscounts).toHaveLength(1);
    expect(unchangedDiscounts[0].code).toBe('sibling_10');
    expect(Number(unchangedDiscounts[0].amount)).toBe(10);
  });
});
