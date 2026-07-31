import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  // Credentials come from the test stack's own admin account (created by
  // install_wordpress.sh / `task test:seed`), not a hardcoded user - see
  // the `e2e` task in Taskfile.test.yml for where these are set.
  const username = process.env.E2E_ADMIN_USER;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('E2E_ADMIN_USER and E2E_ADMIN_PASSWORD must be set (run via `task test:e2e`).');
  }

  // wp-login.php redirects here to WooCommerce's My Account page (a site
  // hook, not WP core default). Its login form is a custom Blade/Tailwind
  // component whose "labels" are plain styled text, not real <label for>
  // associations - getByLabel can't resolve them, hence the name-attribute
  // locators below instead.
  await page.goto('/wp/wp-login.php');
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('checkbox', { name: 'Remember Me' }).check();
  await page.getByRole('button', { name: 'Sign In' }).click();
  // Successful login lands back on /my-account/, not /wp/wp-admin/ - the
  // admin toolbar is the actual signal that auth succeeded.
  await page.getByRole('menuitem', { name: 'Howdy, admin' }).waitFor();
  await page.context().storageState({ path: authFile });
});
