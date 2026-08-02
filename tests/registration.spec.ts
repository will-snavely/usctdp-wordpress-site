import { test, expect } from '@playwright/test';
import { createFamily, createStudent, queryDb, selectFromSelect2, uniqueFamilyDetails } from './helpers';

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
