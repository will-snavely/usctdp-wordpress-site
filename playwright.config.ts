import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Default 30s was too tight for the very first page load against a
   * freshly-seeded test stack (cold theme/WooCommerce asset cache) -
   * observed timing out on auth.setup.ts even though the page had, in
   * fact, finished rendering by the time the timeout fired. */
  timeout: 60_000,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Always serial, not just on CI: every test here shares one Apache/MySQL
   * container in the isolated test stack (Taskfile.test.yml), which can't
   * absorb concurrent browser sessions hammering it - observed as flaky
   * SweetAlert2/redirect timing specifically when 2 workers ran at once. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    // Points at the isolated test stack (`task test:up`/`task test:e2e`,
    // see Taskfile.test.yml) by default - override with PLAYWRIGHT_BASE_URL
    // to run against something else.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8180',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    // Setup project
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    //{
    //  name: 'firefox',
    //  use: {
    //    ...devices['Desktop Firefox'],
    //    storageState: 'playwright/.auth/user.json',
    //  },
    //  dependencies: ['setup'],
    //},

    //{
    //  name: 'webkit',
    //  use: {
    //    ...devices['Desktop Safari'],
    //    storageState: 'playwright/.auth/user.json',
    //  },
    //  dependencies: ['setup'],
    //},

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
