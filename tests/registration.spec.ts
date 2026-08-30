import { test, expect } from '@playwright/test';
import {
  createFamily,
  createStudent,
  queryDb,
  runWpCli,
  selectFromSelect2,
  switchToUser,
  uniqueFamilyDetails,
} from './helpers';

// Depends on the fixture data imported by `task test:seed` (see
// tests/fixtures/e2e-products.json / e2e-sessions.json and the `usctdp
// import_products`/`import_sessions` calls in Taskfile.test.yml): exactly
// one clinic ("Test Clinic"), one session ("Test Session", stored with a
// year suffix e.g. "Test Session - 2026"), and one priced activity for
// that pair.
test('registers a student for a session via the admin UI, paying later', async ({ page }) => {
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

  // activity_preregistration fires automatically once activity+student are
  // both selected, revealing the pricing/capacity preview.
  await expect(page.locator('#activity-preorder')).toBeVisible();

  await page.locator('#add-activity-registration').click();
  await expect(page.locator('#payment-table-section')).toBeVisible();

  await page.locator('#payment-table-section .checkout-btn').click();

  // pay_later stays enabled with nothing transferred to "Pay" yet - no need
  // to touch the transfer-all/credit-input controls for this path. Adding
  // the item kicks off an async fetchHouseCredit() call whose response
  // handler (updateHouseCreditUI -> updatePaymentTotals ->
  // updatePaymentMethodConstraints) forcibly resets the payment method
  // select back to "" whenever the balance isn't fully covered - which is
  // always true here, since this path never transfers anything to "Pay".
  // If that response arrives after the selectOption below instead of
  // before, it clobbers the selection and hides the submit button. The
  // actual submit click has to live INSIDE the retried block, not just a
  // visibility check beforehand - a late reset can still land in the gap
  // between a passing check and a separate click call, so only a failed
  // click (not just a failed check) should trigger retrying the whole
  // select-and-click sequence from scratch.
  await expect(async () => {
    await page.locator('#__usctdp_payment_payment_method').selectOption('pay_later');
    await page.locator('#__usctdp_payment_submit-payment-btn').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // Real (non-AJAX) form POST to admin-post.php redirects here on success.
  // usctdp_token comes between page and family_id in the actual query
  // string, so don't assume adjacency.
  await page.waitForURL(/page=usctdp-admin-history.*family_id=\d+/);
  await expect(
    page.locator('.notice.notice-success', { hasText: 'Registration(s) completed successfully!' })
  ).toBeVisible();

  // UI-level check: the new registration shows up on the family's purchase
  // history view, pre-filtered to this family.
  const historyTable = page.locator('#history-table');
  await expect(historyTable).toContainText(student.firstName);
  await expect(historyTable).toContainText('Test Clinic');

  // DB-level verification of registration/purchase/ledger rows - stronger
  // than the UI check above, since it confirms the actual data written,
  // not just what the page happens to render. Schemas confirmed directly
  // against class-usctdp-mgmt-{registration,purchase,ledger}-table.php and
  // a live run's actual rows (pay_later produces a double-entry ledger:
  // registration_fees debited and revenue credited, both for the sale
  // price - $100 for our fixture's 1-day price).
  const [studentRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${student.firstName}' AND last='${student.lastName}'`
  );
  expect(studentRow).toBeTruthy();

  const registrationRows = queryDb(
    `SELECT * FROM wp_usctdp_registration WHERE student_id=${studentRow.id} AND status='active'`
  );
  expect(registrationRows).toHaveLength(1);
  const [registration] = registrationRows;
  expect(registration.student_level).toBe(student.level);

  const purchaseRows = queryDb(`SELECT * FROM wp_usctdp_purchase WHERE id=${registration.purchase_id}`);
  expect(purchaseRows).toHaveLength(1);
  const [purchase] = purchaseRows;
  expect(purchase.type).toBe('registration');
  expect(purchase.status).toBe('active');

  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`);
  expect(ledgerRows).toHaveLength(2);
  const registrationFeeEntry = ledgerRows.find((r) => r.account === 'registration_fees');
  const revenueEntry = ledgerRows.find((r) => r.account === 'revenue');
  expect(Number(registrationFeeEntry?.debit)).toBe(100);
  expect(Number(revenueEntry?.credit)).toBe(100);
  expect(registrationFeeEntry?.event_id).toBe('order_payment_pay_later');
  expect(revenueEntry?.event_id).toBe('order_payment_pay_later');
});

test('registers a student for a session via the admin UI, paying with cash', async ({ page }) => {
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

  await page.locator('#add-activity-registration').click();
  await expect(page.locator('#payment-table-section')).toBeVisible();

  // Unlike pay_later, the "cash" <option> stays disabled until some amount
  // is moved into the "Pay" column - updatePaymentMethodConstraints only
  // enables payment-method options once the payment total is nonzero (see
  // usctdp-mgmt-admin.js). transfer-all moves the full amount owed there.
  await page.locator('#payment-table-section .transfer-all').click();
  await page.locator('#payment-table-section .checkout-btn').click();

  // Same retry rationale as the pay_later test above: an async
  // fetchHouseCredit() response can re-run updatePaymentMethodConstraints
  // after this point, so the submit click has to live inside the retried
  // block rather than after a one-time visibility check.
  await expect(async () => {
    await page.locator('#__usctdp_payment_payment_method').selectOption('cash');
    await page.locator('#__usctdp_payment_submit-payment-btn').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.waitForURL(/page=usctdp-admin-history.*family_id=\d+/);
  await expect(
    page.locator('.notice.notice-success', { hasText: 'Registration(s) completed successfully!' })
  ).toBeVisible();

  const historyTable = page.locator('#history-table');
  await expect(historyTable).toContainText(student.firstName);
  await expect(historyTable).toContainText('Test Clinic');

  const [studentRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${student.firstName}' AND last='${student.lastName}'`
  );
  expect(studentRow).toBeTruthy();

  const registrationRows = queryDb(
    `SELECT * FROM wp_usctdp_registration WHERE student_id=${studentRow.id} AND status='active'`
  );
  expect(registrationRows).toHaveLength(1);
  const [registration] = registrationRows;
  expect(registration.student_level).toBe(student.level);

  const purchaseRows = queryDb(`SELECT * FROM wp_usctdp_purchase WHERE id=${registration.purchase_id}`);
  expect(purchaseRows).toHaveLength(1);
  const [purchase] = purchaseRows;
  expect(purchase.type).toBe('registration');
  expect(purchase.status).toBe('active');

  // Cash settles the balance immediately, so on top of pay_later's charge
  // entries (registration_fees debited, revenue credited), this also writes
  // the payment leg that clears registration_fees against payment_cash -
  // four rows total (see build_ledger_entries_for_line_item in
  // class-usctdp-mgmt-admin-ajax.php).
  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`);
  expect(ledgerRows).toHaveLength(4);

  const chargeFeeEntry = ledgerRows.find((r) => r.account === 'registration_fees' && r.entry_type === 'charge');
  const chargeRevenueEntry = ledgerRows.find((r) => r.account === 'revenue' && r.entry_type === 'charge');
  const paymentCashEntry = ledgerRows.find((r) => r.account === 'payment_cash');
  const paymentFeeEntry = ledgerRows.find((r) => r.account === 'registration_fees' && r.entry_type === 'payment');

  expect(Number(chargeFeeEntry?.debit)).toBe(100);
  expect(Number(chargeRevenueEntry?.credit)).toBe(100);
  expect(Number(paymentCashEntry?.debit)).toBe(100);
  expect(Number(paymentFeeEntry?.credit)).toBe(100);

  for (const row of ledgerRows) {
    expect(row.event_id).toBe('order_payment_cash');
  }
});

test('registers two students for the same session in a single checkout, paying later', async ({ page }) => {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  const studentOne = {
    firstName: 'JuniorAlpha',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  };
  await createStudent(page, studentOne);

  const studentTwo = {
    firstName: 'JuniorBravo',
    lastName: family.lastName,
    birthdate: '2016-06-01',
    level: 'Beginner',
  };
  await createStudent(page, studentTwo);

  await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-register');

  await selectFromSelect2(page, 'family-selector', family.lastName);
  await selectFromSelect2(page, 'student-selector', studentOne.firstName);
  await selectFromSelect2(page, 'session-selector', 'Test Session');
  await selectFromSelect2(page, 'clinic-selector', 'Test Clinic');
  await selectFromSelect2(page, 'activity-selector', 'Test Clinic');
  await expect(page.locator('#activity-preorder')).toBeVisible();
  await page.locator('#add-activity-registration').click();

  // Adding an item disables #family-selector (register.js's payment:cart:add
  // handler) but leaves its value in place, and only resets #activity-selector
  // - re-picking #student-selector cascades to reset/re-reveal
  // session/clinic/activity underneath it (CascasdingSelect.resetAndHide),
  // so those three need to be re-selected for the second student even though
  // they resolve to the same session/clinic/activity as the first.
  await expect(page.locator('#payment-table-section')).toBeVisible();
  await selectFromSelect2(page, 'student-selector', studentTwo.firstName);
  await selectFromSelect2(page, 'session-selector', 'Test Session');
  await selectFromSelect2(page, 'clinic-selector', 'Test Clinic');
  await selectFromSelect2(page, 'activity-selector', 'Test Clinic');
  await expect(page.locator('#activity-preorder')).toBeVisible();
  await page.locator('#add-activity-registration').click();

  // Both rows should be on the payment table together, still uncommitted -
  // the point of this test is that one checkout/submit covers both.
  const paymentTable = page.locator('#payment-table-section .payment-table');
  await expect(paymentTable).toContainText(studentOne.firstName);
  await expect(paymentTable).toContainText(studentTwo.firstName);

  await page.locator('#payment-table-section .checkout-btn').click();

  // Same retry rationale as the single-registration pay_later test above.
  await expect(async () => {
    await page.locator('#__usctdp_payment_payment_method').selectOption('pay_later');
    await page.locator('#__usctdp_payment_submit-payment-btn').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.waitForURL(/page=usctdp-admin-history.*family_id=\d+/);
  await expect(
    page.locator('.notice.notice-success', { hasText: 'Registration(s) completed successfully!' })
  ).toBeVisible();

  const historyTable = page.locator('#history-table');
  await expect(historyTable).toContainText(studentOne.firstName);
  await expect(historyTable).toContainText(studentTwo.firstName);

  // DB-level verification: each student got its own registration/purchase
  // (create_order_records in class-usctdp-mgmt-admin-ajax.php creates one
  // purchase per line item), but both were written by the same
  // ajax_submit_payment call/transaction.
  const [studentOneRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${studentOne.firstName}' AND last='${studentOne.lastName}'`
  );
  const [studentTwoRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${studentTwo.firstName}' AND last='${studentTwo.lastName}'`
  );
  expect(studentOneRow).toBeTruthy();
  expect(studentTwoRow).toBeTruthy();

  const registrationOneRows = queryDb(
    `SELECT * FROM wp_usctdp_registration WHERE student_id=${studentOneRow.id} AND status='active'`
  );
  const registrationTwoRows = queryDb(
    `SELECT * FROM wp_usctdp_registration WHERE student_id=${studentTwoRow.id} AND status='active'`
  );
  expect(registrationOneRows).toHaveLength(1);
  expect(registrationTwoRows).toHaveLength(1);
  const [registrationOne] = registrationOneRows;
  const [registrationTwo] = registrationTwoRows;
  expect(registrationOne.purchase_id).not.toBe(registrationTwo.purchase_id);

  const purchaseRows = queryDb(
    `SELECT * FROM wp_usctdp_purchase WHERE id IN (${registrationOne.purchase_id}, ${registrationTwo.purchase_id})`
  );
  expect(purchaseRows).toHaveLength(2);
  for (const purchase of purchaseRows) {
    expect(purchase.type).toBe('registration');
    expect(purchase.status).toBe('active');
  }

  // pay_later's double-entry charge (registration_fees debited, revenue
  // credited) written once per purchase - 4 rows total across the two
  // purchases from this one checkout.
  const ledgerRows = queryDb(
    `SELECT * FROM wp_usctdp_ledger WHERE purchase_id IN (${registrationOne.purchase_id}, ${registrationTwo.purchase_id})`
  );
  expect(ledgerRows).toHaveLength(4);
  for (const purchaseId of [registrationOne.purchase_id, registrationTwo.purchase_id]) {
    const rowsForPurchase = ledgerRows.filter((r) => r.purchase_id === purchaseId);
    expect(rowsForPurchase).toHaveLength(2);
    const feeEntry = rowsForPurchase.find((r) => r.account === 'registration_fees');
    const revenueEntry = rowsForPurchase.find((r) => r.account === 'revenue');
    expect(Number(feeEntry?.debit)).toBe(100);
    expect(Number(revenueEntry?.credit)).toBe(100);
  }
  for (const row of ledgerRows) {
    expect(row.event_id).toBe('order_payment_pay_later');
  }
});

test('applies per-item discounts to the WooCommerce order when paying by card', async ({ page }) => {
  // Regression test for create_woocommerce_order (class-usctdp-mgmt-
  // woocommerce.php): its discount/house-credit fee blocks used to sit
  // AFTER the line-item foreach, reading the stale $line_item from the
  // final iteration - so only the LAST line item's discounts ever reached
  // the WC order. The shape below is exactly the case that broke: the
  // discounted registration added first, an undiscounted one added last.
  // Only the card path is affected (ajax_submit_payment only builds a WC
  // order for payment_method === 'card'; cash/check/pay_later go straight
  // to the ledger, which was always per-item).
  //
  // Two students + card checkout + WC-order verification is roughly double
  // the work of the other tests here - the shared 60s budget (set for
  // single-registration flows) isn't enough on a cold stack.
  test.setTimeout(120_000);

  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  const studentOne = {
    firstName: 'JuniorAlpha',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  };
  await createStudent(page, studentOne);

  const studentTwo = {
    firstName: 'JuniorBravo',
    lastName: family.lastName,
    birthdate: '2016-06-01',
    level: 'Beginner',
  };
  await createStudent(page, studentTwo);

  await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-register');

  // First student: sibling discount, 10% of the fixture's $100 one-day
  // price = $10 off (SiblingDiscount.amount() floors the product). The
  // sibling controls live in #clinic-only-discounts, revealed by
  // bind_clinic_info once the clinic activity's preregistration loads.
  // Checking the box fires update_sale_price with the percent select's
  // default ("10") already in place; the explicit selectOption pins the
  // value rather than relying on the <option> order.
  await selectFromSelect2(page, 'family-selector', family.lastName);
  await selectFromSelect2(page, 'student-selector', studentOne.firstName);
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

  // Second student: NO discount, added last (see the two-student pay_later
  // test above for why session/clinic/activity must all be re-picked).
  // loadClinicRegistration resets the page-level `discounts` array when the
  // activity loads; the $100.00 sale-price check guards that the first
  // student's discount didn't leak onto this line item.
  await selectFromSelect2(page, 'student-selector', studentTwo.firstName);
  await selectFromSelect2(page, 'session-selector', 'Test Session');
  await selectFromSelect2(page, 'clinic-selector', 'Test Clinic');
  await selectFromSelect2(page, 'activity-selector', 'Test Clinic');
  await expect(page.locator('#activity-preorder')).toBeVisible();
  await expect(page.locator('#sale-price-value')).toHaveText('$100.00');
  await page.locator('#add-activity-registration').click();

  // Card, like cash, stays disabled until the full amount is moved to
  // "Pay"; same transfer-all + retried select-and-click pattern as the
  // cash test above.
  await page.locator('#payment-table-section .transfer-all').click();
  await page.locator('#payment-table-section .checkout-btn').click();

  await expect(async () => {
    await page.locator('#__usctdp_payment_payment_method').selectOption('card');
    await page.locator('#__usctdp_payment_submit-payment-btn').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // Card path: ajax_submit_payment creates a pending WC order and returns
  // its checkout payment URL; payment_checkout_handler (class-usctdp-mgmt-
  // admin.php) then switches the session to the family's WP user and
  // redirects there. No gateway needs to be configured for the pending
  // order + order-pay page to exist.
  await page.waitForURL(/order-pay\/\d+/);
  const orderId = Number(page.url().match(/order-pay\/(\d+)/)![1]);
  expect(orderId).toBeGreaterThan(0);

  // WC-side verification: both $100 line items, plus the first student's
  // discount as a negative fee line. Order items/itemmeta live in the same
  // tables regardless of whether HPOS is enabled, so query those directly;
  // the order total goes through wc_get_order() to stay storage-agnostic.
  const orderItems = queryDb(
    `SELECT order_item_id, order_item_name, order_item_type FROM wp_woocommerce_order_items WHERE order_id=${orderId}`
  );
  const wcLineItems = orderItems.filter((r) => r.order_item_type === 'line_item');
  const wcFeeItems = orderItems.filter((r) => r.order_item_type === 'fee');
  expect(wcLineItems).toHaveLength(2);
  expect(wcFeeItems).toHaveLength(1);
  expect(wcFeeItems[0].order_item_name).toBe('Sibling Discount');

  for (const wcLineItem of wcLineItems) {
    const [lineTotal] = queryDb(
      `SELECT meta_value FROM wp_woocommerce_order_itemmeta WHERE order_item_id=${wcLineItem.order_item_id} AND meta_key='_line_total'`
    );
    expect(Number(lineTotal.meta_value)).toBe(100);
  }
  const [feeTotal] = queryDb(
    `SELECT meta_value FROM wp_woocommerce_order_itemmeta WHERE order_item_id=${wcFeeItems[0].order_item_id} AND meta_key='_line_total'`
  );
  expect(Number(feeTotal.meta_value)).toBe(-10);

  const orderTotal = runWpCli(['eval', `echo wc_get_order(${orderId})->get_total();`]);
  expect(Number(orderTotal)).toBe(190);

  // Ledger-side verification: the discounted purchase gets the charge pair
  // plus a discount adjustment pair (build_ledger_entries_for_line_item);
  // the undiscounted one gets just the charge pair. Card orders write no
  // payment legs at submit time (payment completes later via the WC
  // gateway hooks), and every row is tagged with the WC order.
  const [studentOneRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${studentOne.firstName}' AND last='${studentOne.lastName}'`
  );
  const [studentTwoRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${studentTwo.firstName}' AND last='${studentTwo.lastName}'`
  );
  const [registrationOne] = queryDb(
    `SELECT * FROM wp_usctdp_registration WHERE student_id=${studentOneRow.id} AND status='active'`
  );
  const [registrationTwo] = queryDb(
    `SELECT * FROM wp_usctdp_registration WHERE student_id=${studentTwoRow.id} AND status='active'`
  );
  expect(registrationOne).toBeTruthy();
  expect(registrationTwo).toBeTruthy();

  const [purchaseOne] = queryDb(`SELECT * FROM wp_usctdp_purchase WHERE id=${registrationOne.purchase_id}`);
  expect(purchaseOne.discounts).toContain('sibling_10');

  const ledgerOneRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${registrationOne.purchase_id}`);
  expect(ledgerOneRows).toHaveLength(4);
  const chargeFee = ledgerOneRows.find((r) => r.entry_type === 'charge' && r.account === 'registration_fees');
  const chargeRevenue = ledgerOneRows.find((r) => r.entry_type === 'charge' && r.account === 'revenue');
  const adjustmentFee = ledgerOneRows.find((r) => r.entry_type === 'adjustment' && r.account === 'registration_fees');
  const adjustmentRevenue = ledgerOneRows.find((r) => r.entry_type === 'adjustment' && r.account === 'revenue');
  expect(Number(chargeFee?.debit)).toBe(100);
  expect(Number(chargeRevenue?.credit)).toBe(100);
  expect(Number(adjustmentFee?.credit)).toBe(10);
  expect(Number(adjustmentRevenue?.debit)).toBe(10);
  expect(adjustmentFee?.description).toBe('Sibling Discount');

  const ledgerTwoRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${registrationTwo.purchase_id}`);
  expect(ledgerTwoRows).toHaveLength(2);
  expect(Number(ledgerTwoRows.find((r) => r.account === 'registration_fees')?.debit)).toBe(100);
  expect(Number(ledgerTwoRows.find((r) => r.account === 'revenue')?.credit)).toBe(100);

  for (const row of [...ledgerOneRows, ...ledgerTwoRows]) {
    expect(row.event_id).toBe(`order_card_${orderId}`);
    expect(Number(row.order_id)).toBe(orderId);
  }
});

// The two tests below drive the actual storefront checkout (not the admin
// register page above) and force the resulting order straight to
// 'failed'/'cancelled' rather than driving a real decline through a
// gateway - WooCommerce doesn't distinguish *why* an order reached that
// status, so this exercises the exact same hook a genuine decline or a
// customer-initiated cancellation would, without needing any gateway
// configured or real payment credentials.
//
// This deliberately isn't the admin register page: create_purchase_and_
// registration() (class-usctdp-mgmt-admin-ajax.php, used by every test
// above) creates registrations as 'active' immediately regardless of
// payment method - there's no 'pending' stage for it to release, so
// release_registrations_for_order() (class-usctdp-mgmt-woocommerce-hooks.php:1570)
// never has anything to do there. 'pending' registrations - the ones that
// hook actually reacts to - only come from after_checkout_validation(),
// which is the *storefront* checkout's woocommerce_after_checkout_validation
// handler, reserving a seat before an order even exists (see also
// class-usctdp-void-stale-registrations.php's docblock, which spells out
// this same distinction from the other side - abandoned-before-any-order
// cleanup rather than failed/cancelled-order cleanup).
//
// BACS (bank transfer) rather than COD as the payment method: COD is WC's
// zero-integration gateway and drives the order straight to 'processing'
// as part of the same checkout submission (see Taskfile.test.yml's seed
// task), which would fire confirm_registration() (pending -> active)
// before this test ever gets a chance to force a failure. BACS lands on
// 'on-hold' instead - not 'processing', so the registration stays
// 'pending' - giving a real window to force-fail/cancel from. BACS isn't
// pre-enabled by seed (only COD is), so each test enables/disables it
// itself rather than depending on stack-wide state.
test('voids the registration when a storefront order fails', async ({ page }) => {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  const student = {
    firstName: 'Junior',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  };
  await createStudent(page, student);

  runWpCli([
    'eval',
    "$s = get_option('woocommerce_bacs_settings', array()); $s['enabled'] = 'yes'; update_option('woocommerce_bacs_settings', $s);",
  ]);

  try {
    await switchToUser(page, family.email);

    // Test Clinic's only fixture slot is Monday (tests/fixtures/e2e-sessions.json)
    // - capacity-concurrency.spec.ts's "Friday" is its own dynamically
    // inserted activity, not this one.
    await page.goto('/product/test-clinic/');
    await page.locator('#days-per-week').selectOption('One');
    await selectFromSelect2(page, 'student_select', student.firstName);
    await selectFromSelect2(page, 'day_of_week_1', 'Monday');
    await page.locator('.single_add_to_cart_button').click();

    await page.goto('/checkout/');
    await page.locator('#billing_first_name').fill(student.firstName);
    await page.locator('#billing_last_name').fill(student.lastName);
    await page.locator('#billing_address_1').fill(family.address);
    await page.locator('#billing_city').fill(family.city);
    await page.locator('#billing_state').selectOption(family.state);
    await page.locator('#billing_postcode').fill(family.zip);
    await page.locator('#billing_email').fill(family.email);
    await page.locator('#payment_method_bacs').check();
    await page.locator('#place_order').click();

    await page.waitForURL(/order-received/);
    const orderId = Number(page.url().match(/order-received\/(\d+)/)![1]);
    expect(orderId).toBeGreaterThan(0);

    const [studentRow] = queryDb(
      `SELECT id FROM wp_usctdp_student WHERE first='${student.firstName}' AND last='${student.lastName}'`
    );
    expect(studentRow).toBeTruthy();

    const [pendingRegistration] = queryDb(`SELECT * FROM wp_usctdp_registration WHERE student_id=${studentRow.id}`);
    expect(pendingRegistration).toBeTruthy();
    expect(pendingRegistration.status).toBe('pending');

    runWpCli(['eval', `$order = wc_get_order(${orderId}); $order->update_status('failed');`]);

    const [registration] = queryDb(`SELECT * FROM wp_usctdp_registration WHERE id=${pendingRegistration.id}`);
    expect(registration.status).toBe('void');
  } finally {
    runWpCli([
      'eval',
      "$s = get_option('woocommerce_bacs_settings', array()); $s['enabled'] = 'no'; update_option('woocommerce_bacs_settings', $s);",
    ]);
  }
});

test('voids the registration when a storefront order is cancelled', async ({ page }) => {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  const student = {
    firstName: 'Junior',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  };
  await createStudent(page, student);

  runWpCli([
    'eval',
    "$s = get_option('woocommerce_bacs_settings', array()); $s['enabled'] = 'yes'; update_option('woocommerce_bacs_settings', $s);",
  ]);

  try {
    await switchToUser(page, family.email);

    await page.goto('/product/test-clinic/');
    await page.locator('#days-per-week').selectOption('One');
    await selectFromSelect2(page, 'student_select', student.firstName);
    await selectFromSelect2(page, 'day_of_week_1', 'Monday');
    await page.locator('.single_add_to_cart_button').click();

    await page.goto('/checkout/');
    await page.locator('#billing_first_name').fill(student.firstName);
    await page.locator('#billing_last_name').fill(student.lastName);
    await page.locator('#billing_address_1').fill(family.address);
    await page.locator('#billing_city').fill(family.city);
    await page.locator('#billing_state').selectOption(family.state);
    await page.locator('#billing_postcode').fill(family.zip);
    await page.locator('#billing_email').fill(family.email);
    await page.locator('#payment_method_bacs').check();
    await page.locator('#place_order').click();

    await page.waitForURL(/order-received/);
    const orderId = Number(page.url().match(/order-received\/(\d+)/)![1]);
    expect(orderId).toBeGreaterThan(0);

    const [studentRow] = queryDb(
      `SELECT id FROM wp_usctdp_student WHERE first='${student.firstName}' AND last='${student.lastName}'`
    );
    expect(studentRow).toBeTruthy();

    const [pendingRegistration] = queryDb(`SELECT * FROM wp_usctdp_registration WHERE student_id=${studentRow.id}`);
    expect(pendingRegistration).toBeTruthy();
    expect(pendingRegistration.status).toBe('pending');

    runWpCli(['eval', `$order = wc_get_order(${orderId}); $order->update_status('cancelled');`]);

    const [registration] = queryDb(`SELECT * FROM wp_usctdp_registration WHERE id=${pendingRegistration.id}`);
    expect(registration.status).toBe('void');
  } finally {
    runWpCli([
      'eval',
      "$s = get_option('woocommerce_bacs_settings', array()); $s['enabled'] = 'no'; update_option('woocommerce_bacs_settings', $s);",
    ]);
  }
});

// Regression coverage for the activity 'status' column (see class-usctdp-
// mgmt-activity-schema.php): add_day_selector() in usctdp-mgmt-product.js
// drops a 'closed' clinic activity from the day dropdown entirely, as
// though it didn't exist, rather than listing it disabled the way a full
// one is. Only the storefront-visibility half of the feature - the
// server-side after_checkout_validation()/validate_activity_status() guard
// against actually completing a registration against a closed activity
// isn't exercised here.
test('closing a clinic activity hides it from the day dropdown, reopening restores it', async ({ page }) => {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  let activityId: string | undefined;
  let groupId: string | undefined;

  try {
    // Same "first (session_id, product_id) pair for Test Clinic" lookup
    // capacity-concurrency.spec.ts uses to insert its own dedicated
    // fixture-adjacent activity.
    const [testClinic] = queryDb(`
      SELECT act.session_id AS session_id, act.product_id AS product_id, act.level AS level
      FROM wp_usctdp_activity act
      JOIN wp_usctdp_product prod ON act.product_id = prod.id
      WHERE prod.title = 'Test Clinic'
    `);
    expect(testClinic).toBeTruthy();

    queryDb(`INSERT INTO wp_usctdp_reservation_group (capacity, created_at, updated_at) VALUES (10, NOW(), NOW())`);
    const [group] = queryDb(`SELECT id FROM wp_usctdp_reservation_group ORDER BY id DESC LIMIT 1`);
    groupId = group.id;

    // Saturday: the fixture's only slot is Monday, and capacity-
    // concurrency.spec.ts's own dynamically-inserted/cleaned-up slot is
    // Friday - this doesn't interact with either. New activities default to
    // status='open' (the column's DB default), so it starts out visible.
    const uniqueTag = `status-toggle-${Date.now()}`;
    const title = `Test Clinic, Saturday, 9:00 AM to 9:45 AM (${uniqueTag})`;
    queryDb(`
      INSERT INTO wp_usctdp_activity (session_id, product_id, type, title, level, search_term, reservation_group_id)
      VALUES (${testClinic.session_id}, ${testClinic.product_id}, 'clinic', '${title}', '${testClinic.level}', '${uniqueTag}', ${groupId})
    `);
    const [activity] = queryDb(`SELECT id FROM wp_usctdp_activity WHERE title = '${title}'`);
    activityId = activity.id;
    queryDb(
      `INSERT INTO wp_usctdp_clinic (id, day_of_week, start_time, end_time) VALUES (${activityId}, 6, '09:00:00', '09:45:00')`
    );

    await switchToUser(page, family.email);

    // add_day_selector() builds each <option>'s label client-side from
    // day_of_week/start_time, not the DB row's `title` - "Saturday" is
    // enough to identify it, and no other Test Clinic activity in this
    // session uses that day. The day_of_week_1 <select> itself stays in the
    // DOM (just hidden behind select2), so toContainText can read its
    // options directly without opening the select2 popup - and it polls,
    // so it naturally waits out the async /clinics/ fetch that populates it
    // after 'found_variation' fires.
    const daySelect = page.locator('#day_of_week_1');

    await page.goto('/product/test-clinic/');
    await page.locator('#days-per-week').selectOption('One');
    await expect(daySelect).toContainText('Saturday');

    queryDb(`UPDATE wp_usctdp_activity SET status = 'closed' WHERE id = ${activityId}`);
    await page.reload();
    await page.locator('#days-per-week').selectOption('One');
    await expect(daySelect).not.toContainText('Saturday');

    queryDb(`UPDATE wp_usctdp_activity SET status = 'open' WHERE id = ${activityId}`);
    await page.reload();
    await page.locator('#days-per-week').selectOption('One');
    await expect(daySelect).toContainText('Saturday');
  } finally {
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
