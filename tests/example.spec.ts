import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/wp/wp-admin');
  await expect(page.getByRole('link', { name: 'USCTDP Admin' })).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Create New Session' })).toHaveCount(1);
});