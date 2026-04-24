import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  fullyParallel: false, // sequential — tests share a live DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],

  // Start the unified dev server before tests; skip if already running.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
    cwd: '../..',
  },
});
