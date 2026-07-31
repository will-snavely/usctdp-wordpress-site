import { test, expect } from '@playwright/test';
import {
  createFamily,
  createStudent,
  queryDb,
  selectFromSelect2,
  switchToUser,
  uniqueFamilyDetails,
} from './helpers';

// Exercises the OTHER purchase path (see registration.spec.ts for the
// admin-panel path): a customer buying directly through the WooCommerce
// storefront. Depends on the same tests/fixtures/e2e-*.json fixtures, plus
// Taskfile.test.yml's seed step marking "Test Clinic" virtual (so checkout
// needs no shipping zone) and enabling the Cash on Delivery gateway (so
// checkout needs no real payment processor/sandbox). This front-end path
// reuses the same usctdp_purchase/usctdp_registration/usctdp_ledger tables
// as the admin path, via WooCommerce's own order-status hooks
// (class-usctdp-mgmt.php's define_woocommerce_hooks()).
test('customer purchases a clinic registration through the WooCommerce storefront', async ({ page }) => {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  const student = {
    firstName: 'Junior',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  };
  await createStudent(page, student);

  // Buying requires being logged in as the family's own account (gated by
  // display_before_single_product()'s is_user_logged_in() check) - switch
  // from the admin session via user-switching rather than needing to know
  // the family user's randomly-generated password.
  await switchToUser(page, family.email);

  await page.goto('/product/test-clinic/');

  // Session auto-selects itself (only one option in our fixture). Days Per
  // Week has two real options, so it needs an explicit pick - a plain
  // native <select>, not select2 (unlike the dynamically-added day-of-week
  // selector below, which is). This must happen BEFORE touching
  // #student_select: that field lives inside #usctdp-woocommerce-extra,
  // which usctdp-mgmt-product.js keeps force-hidden until WooCommerce's
  // `found_variation` event fires - which only happens once every variation
  // attribute (including Days Per Week) has a value.
  await page.locator('#days-per-week').selectOption('One');
  await selectFromSelect2(page, 'student_select', student.firstName);
  await selectFromSelect2(page, 'day_of_week_1', 'Monday');

  await page.locator('.single_add_to_cart_button').click();

  await page.goto('/checkout/');

  // The site doesn't support WooCommerce Blocks checkout (heavy template
  // overrides assume the classic flow) - Taskfile.test.yml's seed step runs
  // `wp usctdp import_pages` against the real data/pages.json, which
  // overwrites the Cart/Checkout pages with the classic
  // [woocommerce_cart]/[woocommerce_checkout] shortcodes, same as
  // production. That renders a plain server-rendered form with real
  // <label for> associations and standard WC field ids, not the React
  // Blocks checkout.
  await page.locator('#billing_first_name').fill(student.firstName);
  await page.locator('#billing_last_name').fill(student.lastName);
  await page.locator('#billing_address_1').fill(family.address);
  await page.locator('#billing_city').fill(family.city);
  await page.locator('#billing_state').selectOption(family.state);
  await page.locator('#billing_postcode').fill(family.zip);
  await page.locator('#billing_email').fill(family.email);

  await page.locator('#payment_method_cod').check();
  await page.locator('#place_order').click();

  await page.waitForURL(/order-received/);

  // DB-level verification, mirroring registration.spec.ts - but this path's
  // ledger shape is genuinely different, not just a copy-paste: COD moves
  // the order straight to "processing", which fires
  // create_purchase_and_ledger_entries() (class-usctdp-mgmt-woocommerce-
  // hooks.php) directly - unlike the admin pay_later path, this books BOTH
  // entries under the same 'registration_fees' account (a self-balancing
  // charge/payment pair), not a registration_fees/revenue split, and tags
  // them event_id='wc_order<order_id>' with payment_method='cod'.
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

  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`);
  expect(ledgerRows).toHaveLength(2);
  const chargeEntry = ledgerRows.find((r) => r.entry_type === 'charge');
  const paymentEntry = ledgerRows.find((r) => r.entry_type === 'payment');
  expect(chargeEntry?.account).toBe('registration_fees');
  expect(paymentEntry?.account).toBe('registration_fees');
  expect(Number(chargeEntry?.debit)).toBe(100);
  expect(Number(paymentEntry?.credit)).toBe(100);
  expect(chargeEntry?.order_id).toBeTruthy();
  expect(chargeEntry?.event_id).toBe(`wc_order${chargeEntry?.order_id}`);
  expect(paymentEntry?.event_id).toBe(`wc_order${chargeEntry?.order_id}`);
  expect(chargeEntry?.payment_method).toBe('cod');
});
