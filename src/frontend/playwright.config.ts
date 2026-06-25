import { defineConfig, devices } from '@playwright/test';

// Target app. Locally this is the Vite dev server started by `webServer` below.
// In CI the app runs as a service container (the built production image) and
// the Playwright component sets BASE_URL to it (e.g. http://app:3000), so no
// webServer is started and the browser talks to the service directly.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  fullyParallel: false, // sequential — tests share a live DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium 130+ has multiple HTTPS-upgrade mechanisms. In CI the browser
        // reaches the app service container at http://app:3000 (plain HTTP);
        // any upgrade attempt gets ERR_SSL_PROTOCOL_ERROR. Disable all known
        // variants: HttpsUpgrades (original), HttpsFirstBalancedMode and its
        // auto-enable flag (Chrome 130 default-on), HttpsFirstModeV2, and
        // AutomaticHttpsRewrites.
        launchOptions: {
          args: ['--disable-features=HttpsUpgrades,HttpsFirstBalancedMode,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2,AutomaticHttpsRewrites'],
        },
      },
    },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],

  // Only start a local dev server when no external BASE_URL is provided.
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:3000/api/health',
          reuseExistingServer: true,
          timeout: 120_000,
          cwd: '../..',
        },
      }),
});
