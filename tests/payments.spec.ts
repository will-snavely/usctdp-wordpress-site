import { test, expect } from '@playwright/test';
import {
  createFamily,
  createStudent,
  queryDb,
  runWpCli,
  selectFromSelect2,
  uniqueFamilyDetails,
} from './helpers';

// Covers the "Record Payment" flow on the admin History page (as opposed to
// registration.spec.ts, which covers paying at initial registration time via
// the Register page) - in particular create_woocommerce_order()/
// record_deferred_payment() (class-usctdp-mgmt-woocommerce.php / class-
// usctdp-mgmt-woocommerce-hooks.php), which handle an *existing* purchase's
// outstanding balance rather than a brand-new one.
//
// Card payments never need a real gateway to test:
//   - Creating the order only needs payment_method=card to reach checkout -
//     ajax_submit_payment() creates a real 'pending' WC order and redirects
//     to /order-pay/<id> with no gateway configured (ajax_submit_payment()
//     in class-usctdp-mgmt-admin-ajax.php).
//   - "Completing" it is a single wp-cli eval forcing the order's status
//     transition (`$order->payment_complete()`), which fires the exact same
//     woocommerce_payment_complete hook a real gateway callback would -
//     record_deferred_payment() doesn't know or care that nothing actually
//     went through a processor. registration.spec.ts's "voids the
//     registration when a storefront order fails" test uses the same
//     technique against a different hook (order_status_failed).

// Every test below registers a student against the real, shared "Test
// Clinic" Monday slot (via registerWithUnpaidBalance) - a permanent,
// capacity-consuming registration, not a self-contained fixture like
// registration-update.spec.ts's dynamically-created activity. Left
// uncleaned, this silently eats into the fixture's fixed capacity (10, per
// tests/fixtures/e2e-sessions.json) for every other spec file that shares
// it - see waitlist.spec.ts's beforeAll, which computes its filler count
// from whatever's already registered.
let registrationId: number | undefined;

test.afterEach(() => {
  if (registrationId) {
    queryDb(`DELETE FROM wp_usctdp_registration WHERE id=${registrationId}`);
    registrationId = undefined;
  }
});

async function registerWithUnpaidBalance(page: import('@playwright/test').Page) {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  const student = {
    firstName: 'Junior',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  };
  await createStudent(page, student);

  // pay_later leaves the full $100 fixture price owed and unpaid - exactly
  // the "existing balance" state Record Payment operates against.
  await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-register');
  await selectFromSelect2(page, 'family-selector', family.lastName);
  await selectFromSelect2(page, 'student-selector', student.firstName);
  await selectFromSelect2(page, 'session-selector', 'Test Session');
  await selectFromSelect2(page, 'clinic-selector', 'Test Clinic');
  await selectFromSelect2(page, 'activity-selector', 'Test Clinic');
  await expect(page.locator('#activity-preorder')).toBeVisible();
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

/** Opens the History page's Record Payment modal for the row matching `studentFirstName`. */
async function openRecordPaymentModal(page: import('@playwright/test').Page, familyId: number, studentFirstName: string) {
  await page.goto(`/wp/wp-admin/admin.php?page=usctdp-admin-history&family_id=${familyId}`);
  const row = page.locator('.purchase-card', { hasText: studentFirstName });
  await row.locator('.payment-action-select').selectOption('post-payment');
  await row.locator('.ledger-action').click();
  await expect(page.locator('#post-payment-modal')).toBeVisible();
}

test('collects only the recorded partial amount when paying an existing balance by card', async ({ page }) => {
  // Regression test for create_woocommerce_order() pricing WC line items at
  // the item's *full outstanding balance* instead of the admin-recorded
  // "Pay" amount - a card payment used to always charge the whole balance
  // regardless of what was typed into the payment table.
  test.setTimeout(90_000);

  const { familyId, student, purchase, registration } = await registerWithUnpaidBalance(page);
  registrationId = Number(registration.id);
  await openRecordPaymentModal(page, familyId, student.firstName);

  // Partial: $40 of the $100 owed, typed directly rather than using
  // transfer-one/transfer-all (which would collect the full balance).
  await page.locator('#post-payment-modal .credit-input').fill('40');
  await page.locator('#post-payment-modal .credit-input').blur();

  await expect(async () => {
    await page.locator('#post-payment-modal select[name="payment_method"]').selectOption('card');
    await page.locator('#post-payment-modal button[type="submit"], #post-payment-modal input[type="submit"]').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.waitForURL(/order-pay\/\d+/);
  const orderId = Number(page.url().match(/order-pay\/(\d+)/)![1]);
  expect(orderId).toBeGreaterThan(0);

  // WC order: line item still shows the full $100 list price (the receipt
  // reads Item -> Remaining Balance -> Total), but the order only actually
  // charges $40 - the point of this whole test.
  const orderItems = queryDb(
    `SELECT order_item_id, order_item_name, order_item_type FROM wp_woocommerce_order_items WHERE order_id=${orderId}`
  );
  const wcLineItems = orderItems.filter((r) => r.order_item_type === 'line_item');
  const wcFeeItems = orderItems.filter((r) => r.order_item_type === 'fee');
  expect(wcLineItems).toHaveLength(1);
  const [lineTotal] = queryDb(
    `SELECT meta_value FROM wp_woocommerce_order_itemmeta WHERE order_item_id=${wcLineItems[0].order_item_id} AND meta_key='_line_total'`
  );
  expect(Number(lineTotal.meta_value)).toBe(100);

  const remainingBalanceFee = wcFeeItems.find((r) => r.order_item_name === 'Remaining Balance');
  expect(remainingBalanceFee).toBeTruthy();
  const [feeTotal] = queryDb(
    `SELECT meta_value FROM wp_woocommerce_order_itemmeta WHERE order_item_id=${remainingBalanceFee!.order_item_id} AND meta_key='_line_total'`
  );
  expect(Number(feeTotal.meta_value)).toBe(-60);

  const orderTotal = runWpCli(['eval', `echo wc_get_order(${orderId})->get_total();`]);
  expect(Number(orderTotal)).toBe(40);

  // Nothing should be in the ledger yet - card payments defer recording
  // until the order actually completes (record_deferred_payment()).
  const preCompleteLedgerRows = queryDb(
    `SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id} AND entry_type='payment'`
  );
  expect(preCompleteLedgerRows).toHaveLength(0);

  // Force the order to complete - no gateway needed, see file header.
  // set_payment_method() first: a real gateway's checkout flow sets this
  // before calling payment_complete() itself (that's what
  // record_deferred_payment() reads via $order->get_payment_method() to
  // name the payment_<method> ledger account) - create_woocommerce_order()
  // deliberately leaves it unset for a card order (unlike cash/check, which
  // set it themselves), since the real gateway slug isn't known until the
  // family actually picks one on the WC payment page.
  runWpCli([
    'eval',
    `$order = wc_get_order(${orderId}); $order->set_payment_method('card'); $order->payment_complete();`,
  ]);

  // Ledger: the $40 actually charged, tagged to this order - not the $100
  // balance, and not silently dropped (see record_deferred_payment()'s
  // order_id-scoped dedup and its _charged_amount meta read).
  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id}`);
  const paymentCardEntry = ledgerRows.find((r) => r.account === 'payment_card' && r.entry_type === 'payment');
  const paymentFeeEntry = ledgerRows.find(
    (r) => r.account === 'registration_fees' && r.entry_type === 'payment'
  );
  expect(Number(paymentCardEntry?.debit)).toBe(40);
  expect(Number(paymentFeeEntry?.credit)).toBe(40);
  expect(Number(paymentCardEntry?.order_id)).toBe(orderId);

  // $60 should still be owed: $100 charge - $40 payment.
  const [balanceRow] = queryDb(
    `SELECT SUM(debit) - SUM(credit) AS owed FROM wp_usctdp_ledger
     WHERE purchase_id=${purchase.id} AND account='registration_fees'`
  );
  expect(Number(balanceRow.owed)).toBe(60);
});

test('does not double-record a deferred card payment when WooCommerce fires its completion hooks twice', async ({ page }) => {
  // Regression test for record_deferred_payment()'s dedup check, which used
  // to be scoped to purchase_id alone - matching (and thus wrongly skipping)
  // any *other* prior payment on the same purchase, or (before the order_id
  // scoping fix) failing to guard against this exact double-fire at all.
  // woocommerce_order_status_processing and woocommerce_payment_complete
  // both call record_deferred_payment(), and a real gateway callback can
  // plausibly land on both for one order.
  test.setTimeout(90_000);

  const { familyId, student, purchase, registration } = await registerWithUnpaidBalance(page);
  registrationId = Number(registration.id);
  await openRecordPaymentModal(page, familyId, student.firstName);

  await page.locator('#post-payment-modal .transfer-one').click();
  await expect(async () => {
    await page.locator('#post-payment-modal select[name="payment_method"]').selectOption('card');
    await page.locator('#post-payment-modal button[type="submit"], #post-payment-modal input[type="submit"]').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.waitForURL(/order-pay\/\d+/);
  const orderId = Number(page.url().match(/order-pay\/(\d+)/)![1]);

  // Full payment this time - no Remaining Balance fee expected.
  const orderTotal = runWpCli(['eval', `echo wc_get_order(${orderId})->get_total();`]);
  expect(Number(orderTotal)).toBe(100);

  // set_payment_method() once, as a real gateway's checkout flow would
  // before either hook below fires (see the payment method comment in the
  // partial-payment test above) - update_status('processing') and
  // payment_complete() each fire one of the two hooks record_deferred_
  // payment() is registered on, simulating both legitimately firing for the
  // same order.
  runWpCli(['eval', `$order = wc_get_order(${orderId}); $order->set_payment_method('card'); $order->save();`]);
  runWpCli(['eval', `$order = wc_get_order(${orderId}); $order->update_status('processing');`]);
  runWpCli(['eval', `$order = wc_get_order(${orderId}); $order->payment_complete();`]);

  const ledgerRows = queryDb(
    `SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id} AND entry_type='payment'`
  );
  expect(ledgerRows).toHaveLength(2); // payment_card + registration_fees, once each
  expect(Number(ledgerRows.find((r) => r.account === 'payment_card')?.debit)).toBe(100);

  const [balanceRow] = queryDb(
    `SELECT SUM(debit) - SUM(credit) AS owed FROM wp_usctdp_ledger
     WHERE purchase_id=${purchase.id} AND account='registration_fees'`
  );
  expect(Number(balanceRow.owed)).toBe(0);
});

test('splits a card payment between house credit and the card, and records both once the order completes', async ({ page }) => {
  // Regression test for record_deferred_payment() never having written a
  // house_credit ledger entry for a card-paid purchase at all - house
  // credit applied toward a card payment correctly reduced what the card
  // itself was charged (create_woocommerce_order()'s "House Credit Applied"
  // fee), but the family's house credit balance was never actually drawn
  // down for it. _house_credit_amount item meta (set at order-creation
  // time) is what makes this attributable per line item once the order
  // completes, same mechanism _charged_amount uses for the card portion.
  test.setTimeout(90_000);

  const { familyId, student, purchase, registration } = await registerWithUnpaidBalance(page);
  registrationId = Number(registration.id);

  // Issue $30 house credit on the family before recording payment - Issue
  // House Credit lives on the Families page, not History.
  await page.goto(`/wp/wp-admin/admin.php?page=usctdp-admin-families&family_id=${familyId}`);
  await page.locator('#issue-house-credit-btn').click();
  await expect(page.locator('#issue-house-credit-modal')).toBeVisible();
  await page.locator('#house-credit-amount').fill('30');
  await page.locator('#house-credit-reason').fill('E2E test credit');
  await page.locator('#save-house-credit-modal').click();
  await expect(page.getByText('House credit issued successfully!')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();

  await openRecordPaymentModal(page, familyId, student.firstName);

  // Full $100 owed transferred to "Pay", then $30 of it covered by house
  // credit - the "Max" button only becomes enabled once the async house-
  // credit-balance fetch triggered by adding the row resolves.
  await page.locator('#post-payment-modal .transfer-one').click();
  const houseCreditSection = page.locator('#post-payment-modal .house-credit-section');
  await expect(houseCreditSection).toBeVisible();
  await houseCreditSection.locator('.house-credit-max-btn').click();
  await expect(page.locator('#post-payment-modal .house-credit-apply-field input')).toHaveValue('30.00');

  await expect(async () => {
    await page.locator('#post-payment-modal select[name="payment_method"]').selectOption('card');
    await page.locator('#post-payment-modal button[type="submit"], #post-payment-modal input[type="submit"]').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await page.waitForURL(/order-pay\/\d+/);
  const orderId = Number(page.url().match(/order-pay\/(\d+)/)![1]);

  // The card should only be charged $70 - the $30 house credit portion
  // isn't part of what the family pays via this order at all.
  const orderTotal = runWpCli(['eval', `echo wc_get_order(${orderId})->get_total();`]);
  expect(Number(orderTotal)).toBe(70);

  const feeItems = queryDb(
    `SELECT order_item_id, order_item_name FROM wp_woocommerce_order_items
     WHERE order_id=${orderId} AND order_item_type='fee'`
  );
  const houseCreditFee = feeItems.find((r) => r.order_item_name === 'House Credit Applied');
  expect(houseCreditFee).toBeTruthy();
  const [houseCreditFeeTotal] = queryDb(
    `SELECT meta_value FROM wp_woocommerce_order_itemmeta WHERE order_item_id=${houseCreditFee!.order_item_id} AND meta_key='_line_total'`
  );
  expect(Number(houseCreditFeeTotal.meta_value)).toBe(-30);

  runWpCli([
    'eval',
    `$order = wc_get_order(${orderId}); $order->set_payment_method('card'); $order->payment_complete();`,
  ]);

  const paymentRows = queryDb(
    `SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id} AND order_id=${orderId}`
  );
  expect(paymentRows).toHaveLength(4); // payment_card pair + house_credit pair

  const paymentCard = paymentRows.find((r) => r.account === 'payment_card' && r.entry_type === 'payment');
  const paymentFee = paymentRows.find((r) => r.account === 'registration_fees' && r.entry_type === 'payment');
  const houseCreditPayment = paymentRows.find(
    (r) => r.account === 'payment_house_credit' && r.entry_type === 'house_credit'
  );
  const houseCreditFeeEntry = paymentRows.find(
    (r) => r.account === 'registration_fees' && r.entry_type === 'house_credit'
  );
  expect(Number(paymentCard?.debit)).toBe(70);
  expect(Number(paymentFee?.credit)).toBe(70);
  expect(Number(houseCreditPayment?.debit)).toBe(30);
  expect(Number(houseCreditFeeEntry?.credit)).toBe(30);

  // The purchase is fully settled...
  const [balanceRow] = queryDb(
    `SELECT SUM(debit) - SUM(credit) AS owed FROM wp_usctdp_ledger
     WHERE purchase_id=${purchase.id} AND account='registration_fees'`
  );
  expect(Number(balanceRow.owed)).toBe(0);

  // ...and the family's $30 house credit is actually spent, not still
  // sitting available - the specific gap this test exists to catch.
  const [houseCreditBalanceRow] = queryDb(
    `SELECT SUM(credit) - SUM(debit) AS balance FROM wp_usctdp_ledger
     WHERE family_id=${familyId} AND account='payment_house_credit'`
  );
  expect(Number(houseCreditBalanceRow.balance)).toBe(0);
});

// Cash/check take a genuinely different path through the server than card:
// ajax_submit_payment() only calls create_woocommerce_order() when
// payment_method === 'card' (class-usctdp-mgmt-admin-ajax.php) - for
// cash/check there's no WC order at all, and build_ledger_entries_for_line_
// item() writes the payment (and house_credit, if any) entries immediately,
// synchronously, in the same request - not deferred to record_deferred_
// payment() the way card payments are. On the client side this also means
// no navigation: RegistrationPaymentTable's settings on the History page set
// redirectOnComplete:false, so completion is signaled by a `payment:complete`
// event that just closes the modal and reloads the table in place (see
// handleFormSubmit()/finalizeFormRedirect() in usctdp-mgmt-admin.js and the
// `payment:complete` handler in usctdp-mgmt-admin-history.js) rather than a
// page redirect to /order-pay/.

test('records a cash payment immediately for an existing balance, with no WooCommerce order involved', async ({ page }) => {
  test.setTimeout(90_000);

  const { familyId, student, purchase, registration } = await registerWithUnpaidBalance(page);
  registrationId = Number(registration.id);
  await openRecordPaymentModal(page, familyId, student.firstName);

  // Partial again, same as the card test - proves cash doesn't require
  // full payment either.
  await page.locator('#post-payment-modal .credit-input').fill('40');
  await page.locator('#post-payment-modal .credit-input').blur();

  await expect(async () => {
    await page.locator('#post-payment-modal select[name="payment_method"]').selectOption('cash');
    await page.locator('#post-payment-modal button[type="submit"], #post-payment-modal input[type="submit"]').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // No order to navigate to - the modal just closes once the AJAX call
  // (which already wrote the ledger entries) resolves.
  await expect(page.locator('#post-payment-modal')).toBeHidden({ timeout: 20_000 });

  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id} AND entry_type='payment'`);
  const paymentCashEntry = ledgerRows.find((r) => r.account === 'payment_cash');
  const paymentFeeEntry = ledgerRows.find((r) => r.account === 'registration_fees');
  expect(Number(paymentCashEntry?.debit)).toBe(40);
  expect(Number(paymentFeeEntry?.credit)).toBe(40);
  expect(paymentCashEntry?.payment_method).toBe('cash');
  // No card order was ever created for this payment - the ledger schema
  // stores order_id as a non-nullable column (0, not NULL, for entries with
  // no associated WC order), so check the numeric value rather than truthiness.
  expect(Number(paymentCashEntry?.order_id)).toBe(0);

  const [balanceRow] = queryDb(
    `SELECT SUM(debit) - SUM(credit) AS owed FROM wp_usctdp_ledger
     WHERE purchase_id=${purchase.id} AND account='registration_fees'`
  );
  expect(Number(balanceRow.owed)).toBe(60);
});

test('records a check payment with the check number attached to the ledger entry', async ({ page }) => {
  test.setTimeout(90_000);

  const { familyId, student, purchase, registration } = await registerWithUnpaidBalance(page);
  registrationId = Number(registration.id);
  await openRecordPaymentModal(page, familyId, student.firstName);

  await page.locator('#post-payment-modal .transfer-one').click();
  await expect(async () => {
    await page.locator('#post-payment-modal select[name="payment_method"]').selectOption('check');
    await page.locator('#post-payment-modal input[name="check_number"]').fill('204');
    await page.locator('#post-payment-modal button[type="submit"], #post-payment-modal input[type="submit"]').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await expect(page.locator('#post-payment-modal')).toBeHidden({ timeout: 20_000 });

  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id} AND entry_type='payment'`);
  const paymentCheckEntry = ledgerRows.find((r) => r.account === 'payment_check');
  const paymentFeeEntry = ledgerRows.find((r) => r.account === 'registration_fees');
  expect(Number(paymentCheckEntry?.debit)).toBe(100);
  expect(Number(paymentFeeEntry?.credit)).toBe(100);
  expect(paymentCheckEntry?.reference_id).toBe('204');
  expect(paymentCheckEntry?.description).toContain('204');

  const [balanceRow] = queryDb(
    `SELECT SUM(debit) - SUM(credit) AS owed FROM wp_usctdp_ledger
     WHERE purchase_id=${purchase.id} AND account='registration_fees'`
  );
  expect(Number(balanceRow.owed)).toBe(0);
});

test('applies house credit immediately (not deferred) when paying an existing balance by cash', async ({ page }) => {
  // Companion to the card+house-credit test above: for card, house_credit
  // entries wait for the order to actually complete
  // (record_deferred_payment()). Cash has no such deferral - both the
  // payment_cash and payment_house_credit entries should exist as soon as
  // the AJAX call returns, in the same request that recorded the cash
  // portion.
  test.setTimeout(90_000);

  const { familyId, student, purchase, registration } = await registerWithUnpaidBalance(page);
  registrationId = Number(registration.id);

  await page.goto(`/wp/wp-admin/admin.php?page=usctdp-admin-families&family_id=${familyId}`);
  await page.locator('#issue-house-credit-btn').click();
  await expect(page.locator('#issue-house-credit-modal')).toBeVisible();
  await page.locator('#house-credit-amount').fill('30');
  await page.locator('#house-credit-reason').fill('E2E test credit');
  await page.locator('#save-house-credit-modal').click();
  await expect(page.getByText('House credit issued successfully!')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();

  await openRecordPaymentModal(page, familyId, student.firstName);
  await page.locator('#post-payment-modal .transfer-one').click();
  const houseCreditSection = page.locator('#post-payment-modal .house-credit-section');
  await expect(houseCreditSection).toBeVisible();
  await houseCreditSection.locator('.house-credit-max-btn').click();
  await expect(page.locator('#post-payment-modal .house-credit-apply-field input')).toHaveValue('30.00');

  await expect(async () => {
    await page.locator('#post-payment-modal select[name="payment_method"]').selectOption('cash');
    await page.locator('#post-payment-modal button[type="submit"], #post-payment-modal input[type="submit"]').click({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  await expect(page.locator('#post-payment-modal')).toBeHidden({ timeout: 20_000 });

  const ledgerRows = queryDb(`SELECT * FROM wp_usctdp_ledger WHERE purchase_id=${purchase.id} AND entry_type IN ('payment', 'house_credit')`);
  expect(ledgerRows).toHaveLength(4); // payment_cash pair + house_credit pair, all written in this one request

  const paymentCash = ledgerRows.find((r) => r.account === 'payment_cash' && r.entry_type === 'payment');
  const paymentFee = ledgerRows.find((r) => r.account === 'registration_fees' && r.entry_type === 'payment');
  const houseCreditPayment = ledgerRows.find((r) => r.account === 'payment_house_credit' && r.entry_type === 'house_credit');
  const houseCreditFeeEntry = ledgerRows.find((r) => r.account === 'registration_fees' && r.entry_type === 'house_credit');
  expect(Number(paymentCash?.debit)).toBe(70);
  expect(Number(paymentFee?.credit)).toBe(70);
  expect(Number(houseCreditPayment?.debit)).toBe(30);
  expect(Number(houseCreditFeeEntry?.credit)).toBe(30);

  const [balanceRow] = queryDb(
    `SELECT SUM(debit) - SUM(credit) AS owed FROM wp_usctdp_ledger
     WHERE purchase_id=${purchase.id} AND account='registration_fees'`
  );
  expect(Number(balanceRow.owed)).toBe(0);

  const [houseCreditBalanceRow] = queryDb(
    `SELECT SUM(credit) - SUM(debit) AS balance FROM wp_usctdp_ledger
     WHERE family_id=${familyId} AND account='payment_house_credit'`
  );
  expect(Number(houseCreditBalanceRow.balance)).toBe(0);
});
