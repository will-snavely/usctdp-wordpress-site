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
