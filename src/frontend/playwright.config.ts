import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'node:child_process';

// Target app. Locally this is the Vite dev server started by `webServer` below.
// In CI the app runs as a service container (the built production image) and
// the Playwright component sets BASE_URL to http://app:3000, so no webServer
// is started and the browser talks to the service directly.
//
// Chromium 130+ performs DNS HTTPS record (SVCB) lookups; Docker's embedded
// DNS may return an HTTPS record for the "app" alias, causing Chromium to
// upgrade http://app:3000 → https://app:3000, which fails with
// ERR_SSL_PROTOCOL_ERROR. --disable-features flags don't prevent this path.
// Fix: resolve "app" to its Docker-network IP at startup and use the raw IP as
// the base URL — IP addresses skip DNS HTTPS lookups entirely.
let baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
if (baseURL.includes('//app:')) {
  try {
    const ip = execSync(
      "getent hosts app 2>/dev/null | awk '{print $1}' | head -1",
      { encoding: 'utf-8', timeout: 3000 },
    ).trim();
    if (ip) {
      baseURL = baseURL.replace('//app:', `//${ip}:`);
      // Keep BASE_URL in sync so globalSetup sees the same URL.
      process.env.BASE_URL = baseURL;
    }
  } catch {
    // Not in a Docker environment — fall through and use the original URL.
  }
}

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
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
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
