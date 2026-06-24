import { defineConfig, devices } from '@playwright/test';

// In CI we connect to a remote Playwright browser server (the `playwright`
// service) instead of launching local browsers. `exposeNetwork: '<loopback>'`
// lets that remote browser reach the dev server running on localhost:3000 in
// the job container. We read a dedicated env var (not PW_TEST_CONNECT_WS_ENDPOINT,
// which would trigger Playwright's built-in connect and ignore exposeNetwork)
// so the config-driven connectOptions — including exposeNetwork — always apply.
// When the env var is unset (local dev), browsers launch normally.
const wsEndpoint = process.env.E2E_WS_ENDPOINT;

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  fullyParallel: false, // sequential — tests share a live DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // In CI, fail fast on a systemic break (e.g. browser can't reach the app)
  // rather than letting all 82 tests time out one by one.
  maxFailures: process.env.CI ? 5 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...(wsEndpoint
      ? { connectOptions: { wsEndpoint, exposeNetwork: '<loopback>' } }
      : {}),
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
    timeout: 120_000,
    cwd: '../..',
  },
});
