import { test, expect } from '@playwright/test';

test('creates a family via the admin UI', async ({ page }) => {
  // Unique per run: create_family provisions a WP user keyed off
  // last-name + last-4-of-phone (user_login) and the raw email, both of
  // which must be unique or wp_insert_user fails and the family row gets
  // rolled back server-side.
  const unique = Date.now().toString().slice(-8);
  const lastName = `Testerson${unique}`;
  const phone = `803555${unique.slice(-4)}`;
  const email = `family-${unique}@example.com`;

  await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-families');

  await page.locator('#new-family-button').click();
  await expect(page.locator('#new-family-modal')).toBeVisible();

  await page.locator('#family_modal_last_name').fill(lastName);
  await page.locator('#family_modal_address').fill('123 Main St');
  await page.locator('#family_modal_city').fill('Columbia');
  await page.locator('#family_modal_state').fill('SC');
  await page.locator('#family_modal_zip').fill('29201');
  await page.locator('#family_modal_email').fill(email);
  await page.locator('#family_modal_phone').fill(phone);

  await page.locator('#save-family-modal').click();

  // SweetAlert2 success dialog, then a full-page reload to
  // ?page=usctdp-admin-families&family_id=<id>.
  await expect(page.getByText('Family created successfully!')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForURL(/page=usctdp-admin-families&family_id=\d+/);

  await expect(page.locator('#family-section')).toBeVisible();
  await expect(page.locator('#family-title')).toContainText(lastName);
});
