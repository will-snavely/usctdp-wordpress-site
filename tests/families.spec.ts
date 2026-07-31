import { test, expect } from '@playwright/test';
import { createFamily, uniqueFamilyDetails } from './helpers';

test('creates a family via the admin UI', async ({ page }) => {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  await expect(page.locator('#family-title')).toContainText(family.lastName);
});
