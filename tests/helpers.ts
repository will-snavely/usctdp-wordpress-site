import { Page, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * Runs a SQL statement directly against the isolated test stack's DB via
 * `docker compose exec` (the db container only exposes 3306 to other
 * containers on its own network, not to the host, so a direct MySQL client
 * connection from the test process isn't an option - this goes through the
 * Docker API instead, same mechanism used throughout this repo's manual
 * debugging). Returns rows as objects keyed by column name. Test-only,
 * against a disposable per-run DB, so plain string interpolation into the
 * SQL is fine - no untrusted input ever reaches this.
 */
export function queryDb(sql: string): Record<string, string>[] {
  const password = readFileSync('.secret_db_password_test', 'utf8').trim();
  const output = execFileSync(
    'docker',
    [
      'compose', '--env-file', '.env.test', '-p', 'usctdp_test',
      '-f', 'sage_dev/compose.test.yaml', 'exec', '-T', 'db',
      'mariadb', '-uwordpress_test', `-p${password}`, 'wordpress_test', '-B', '-e', sql,
    ],
    { encoding: 'utf8' }
  );
  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const values = line.split('\t');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i]; });
    return row;
  });
}

export interface FamilyDetails {
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  email: string;
  phone: string;
}

// Unique per call: create_family provisions a WP user keyed off
// last-name + last-4-of-phone (user_login) and the raw email, both of
// which must be unique or wp_insert_user fails and the family row gets
// rolled back server-side.
export function uniqueFamilyDetails(): FamilyDetails {
  const unique = Date.now().toString().slice(-8);
  return {
    lastName: `Testerson${unique}`,
    address: '123 Main St',
    city: 'Columbia',
    state: 'SC',
    zip: '29201',
    email: `family-${unique}@example.com`,
    phone: `803555${unique.slice(-4)}`,
  };
}

/**
 * Creates a family via the admin Families page and leaves the page on the
 * newly created family's detail view (?family_id=<id>, #family-section
 * visible).
 */
export async function createFamily(page: Page, details: FamilyDetails) {
  await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-families');

  await page.locator('#new-family-button').click();
  await expect(page.locator('#new-family-modal')).toBeVisible();

  await page.locator('#family_modal_last_name').fill(details.lastName);
  await page.locator('#family_modal_address').fill(details.address);
  await page.locator('#family_modal_city').fill(details.city);
  await page.locator('#family_modal_state').fill(details.state);
  await page.locator('#family_modal_zip').fill(details.zip);
  await page.locator('#family_modal_email').fill(details.email);
  await page.locator('#family_modal_phone').fill(details.phone);

  await page.locator('#save-family-modal').click();

  // SweetAlert2 success dialog, then a full-page reload to
  // ?page=usctdp-admin-families&family_id=<id>.
  await expect(page.getByText('Family created successfully!')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForURL(/page=usctdp-admin-families&family_id=\d+/);

  await expect(page.locator('#family-section')).toBeVisible();
}

export interface StudentDetails {
  firstName: string;
  lastName: string;
  birthdate: string; // YYYY-MM-DD
  level: string;
}

/**
 * Adds a student to whichever family is currently selected on the
 * Families page (call after createFamily, in the same `page`).
 */
export async function createStudent(page: Page, details: StudentDetails) {
  await page.locator('#new-student-button').click();
  await expect(page.locator('#new-student-modal')).toBeVisible();

  await page.locator('#student_modal_first_name').fill(details.firstName);
  await page.locator('#student_modal_last_name').fill(details.lastName);
  await page.locator('#student_modal_birthdate').fill(details.birthdate);
  await page.locator('#student_modal_level').fill(details.level);

  // create_student's success handler uses a plain browser alert(), not the
  // SweetAlert2 dialog create_family uses - must be registered before the
  // click since the dialog event fires synchronously with it.
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#save-student-modal').click();

  // No page reload here (unlike family creation) - #family-members-table
  // refreshes in place via its own AJAX call, newest row first (ordered by
  // id DESC, no paging/sorting UI).
  const firstRow = page.locator('#family-members-table-body tr').first();
  await expect(firstRow).toContainText(details.firstName);
  await expect(firstRow).toContainText(details.lastName);
}

/**
 * Switches the current browser session from the logged-in admin to another
 * WP user, via the user-switching plugin's real "Switch To" row action on
 * the Users list (searched by `searchTerm`, e.g. the target user's email) -
 * avoids ever needing to know/reset that user's password.
 */
export async function switchToUser(page: Page, searchTerm: string) {
  await page.goto(`/wp/wp-admin/users.php?s=${encodeURIComponent(searchTerm)}`);
  // WP admin's row-actions links are hidden until the row is hovered/
  // focused, which makes Playwright's visibility/viewport actionability
  // checks on a real .click() spin indefinitely. The nonce-secured href is
  // already correct without any hover state, so just navigate to it.
  const href = await page.getByRole('link', { name: 'Switch To' }).first().getAttribute('href');
  await page.goto(href!);
}

/**
 * Drives one of this plugin's select2-based cascading dropdowns
 * (#family-selector, #student-selector, #session-selector, etc.):
 * opens it, types a search query into the AJAX-backed search box, and
 * clicks the first matching result containing `optionText` (defaults to
 * the query itself).
 */
export async function selectFromSelect2(
  page: Page,
  selectId: string,
  query: string,
  optionText?: string
) {
  await page.locator(`#select2-${selectId}-container`).click();
  const searchBox = page.locator('.select2-search__field').last();
  await searchBox.fill(query);
  const option = page.locator('.select2-results__option', { hasText: optionText ?? query }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
  // The register page's cascading selectors each trigger their own
  // AJAX (select2 search, cascade:change side effects like
  // activity_preregistration) - selecting the next dropdown before the
  // current one's request/handler has settled leaves the page's internal
  // selection state (e.g. selectedStudent/selectedActivity) out of sync,
  // even though the visible <select> value looks correct. A real user
  // can't click through 5 dropdowns fast enough to hit this; a script can.
  await page.waitForLoadState('networkidle');
}

/**
 * Selects one of a select2-based cascading dropdown's "pinned" options (e.g.
 * session-selector's "🎾 Merchandise Only" / "➕ New Special Session") -
 * these come from the client-side `pinnedOptions` list in select2Options
 * (usctdp-mgmt-admin.js), which is only spliced into the results when the
 * search box is empty (`isSearching` false), so unlike selectFromSelect2,
 * this opens the dropdown and clicks without typing anything first.
 */
export async function selectPinnedOption(page: Page, selectId: string, optionText: string) {
  await page.locator(`#select2-${selectId}-container`).click();
  const option = page.locator('.select2-results__option', { hasText: optionText }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
  await page.waitForLoadState('networkidle');
}
