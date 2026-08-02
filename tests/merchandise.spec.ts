import { test, expect } from '@playwright/test';
import {
  createFamily,
  createStudent,
  queryDb,
  selectFromSelect2,
  selectPinnedOption,
  uniqueFamilyDetails,
} from './helpers';

// Depends on the fixture data imported by `task test:seed` (see
// tests/fixtures/e2e-products.json and the `usctdp import_products` call in
// Taskfile.test.yml): one merchandise item, "Test Racket" priced at $65,
// with code "racket" - that exact code matters, since
// localize_register_page_script() in class-usctdp-mgmt-admin.php hardcodes
// a lookup for a product with code "racket" to expose its pricing to the
// register page's JS (MERCHANDISE_PRICING in usctdp-mgmt-admin-register.js).
test('purchases a racket as merchandise-only via the admin UI, paying later', async ({ page }) => {
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
  // "🎾 Merchandise Only" is a pinned session-selector option that branches
  // straight to merchandise-selector instead of the clinic/tournament
  // cascade (see session-selector's `next` function in
  // usctdp-mgmt-admin-register.js) - no session/clinic/activity involved.
  await selectPinnedOption(page, 'session-selector', 'Merchandise Only');
  await selectFromSelect2(page, 'merchandise-selector', 'Test Racket');

  await expect(page.locator('#merch-preorder')).toBeVisible();
  await page.locator('#add-merchandise').click();
  await expect(page.locator('#payment-table-section')).toBeVisible();

  await page.locator('#payment-table-section .checkout-btn').click();

  // Same retry rationale as the registration tests: an async
  // fetchHouseCredit() response can re-run updatePaymentMethodConstraints
  // and touch the payment method select, so the submit click has to live
  // inside the retried block.
  await expect(async () => {
    await page.locator('#__usctdp_payment_payment_method').selectOption('pay_later');
    await page.locator('#__usctdp_payment_submit-payment-btn').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.waitForURL(/page=usctdp-admin-history.*family_id=\d+/);
  await expect(
    page.locator('.notice.notice-success', { hasText: 'Registration(s) completed successfully!' })
  ).toBeVisible();

  const historyTable = page.locator('#history-table');
  await expect(historyTable).toContainText(student.firstName);
  await expect(historyTable).toContainText('Test Racket');

  // DB-level verification. Merchandise purchases don't create a
  // wp_usctdp_registration row (that table is registration-only) - just the
  // purchase and its ledger entries (create_merchandise_order in
  // class-usctdp-mgmt-admin-ajax.php).
  const [studentRow] = queryDb(
    `SELECT id FROM wp_usctdp_student WHERE first='${student.firstName}' AND last='${student.lastName}'`
  );
  expect(studentRow).toBeTruthy();

  const purchaseRows = queryDb(
    `SELECT * FROM wp_usctdp_purchase WHERE student_id=${studentRow.id} AND type='merchandise' AND status='active'`
  );
  expect(purchaseRows).toHaveLength(1);
  const [purchase] = purchaseRows;

  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`);
  expect(ledgerRows).toHaveLength(2);
  const merchandiseFeeEntry = ledgerRows.find((r) => r.account === 'merchandise_fees');
  const revenueEntry = ledgerRows.find((r) => r.account === 'revenue');
  expect(Number(merchandiseFeeEntry?.debit)).toBe(65);
  expect(Number(revenueEntry?.credit)).toBe(65);
  expect(merchandiseFeeEntry?.event_id).toBe('order_payment_pay_later');
  expect(revenueEntry?.event_id).toBe('order_payment_pay_later');
});
