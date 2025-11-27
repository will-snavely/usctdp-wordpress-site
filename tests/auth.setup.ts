import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  // Perform authentication steps. Replace these actions with your own.
  await page.goto('/wp/wp-login.php');
  await page.getByLabel('Username or Email Address').fill('test_admin');
  await page.getByRole('textbox', { name: 'Password' }).fill('^I61qZLIJgUh(!4mQy');
  await page.getByLabel('Remember Me').check();
  await page.getByRole('button', { name: 'Log In' }).click();
  await page.waitForURL('/wp/wp-admin/');
  await page.context().storageState({ path: authFile });
});
