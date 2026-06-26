import { test, expect } from '@playwright/test';

/**
 * Settings page tests.
 *
 * The Settings tab lives in the App.vue tabbar (label "Settings", cog icon).
 * Clicking it navigates to /settings, a full page view like the other tabs.
 */

/** Helper: click the Settings tab in the bottom tab bar. */
async function openSettings(page: import('@playwright/test').Page) {
  const link = page.getByRole('link', { name: /^settings$/i });
  if (await link.isVisible({ timeout: 1000 }).catch(() => false)) {
    await link.click();
  } else {
    await page.locator('[class*="tabbar"] a').filter({ hasText: /^settings$/i }).click();
  }
}

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Settings tab is visible in the tab bar', async ({ page }) => {
    const settingsTab =
      page.getByRole('link', { name: /^settings$/i }).or(
        page.locator('[class*="tabbar"] a').filter({ hasText: /^settings$/i }),
      );
    await expect(settingsTab.first()).toBeVisible();
  });

  test('clicking the Settings tab navigates to /settings', async ({ page }) => {
    await openSettings(page);
    await expect(page).toHaveURL(/\/settings/);
  });

  test('settings page shows push-notification state message', async ({ page }) => {
    await openSettings(page);

    // In a test browser (Chromium/WebKit) without a push VAPID key configured on
    // the server, one of three states is expected:
    //   1. "Push notifications are not supported in this browser." — webkit/no-push
    //   2. "Push notifications are not configured on the server." — chromium, no VAPID
    //   3. A k-toggle element — only when server is configured AND browser supports push
    const notSupported = page.getByText(/not supported in this browser/i);
    const notConfigured = page.getByText(/not configured on the server/i);
    const toggle = page.locator('[class*="toggle"], input[type="checkbox"]').filter({
      hasText: '',
    });

    const anyVisible =
      (await notSupported.isVisible({ timeout: 2000 }).catch(() => false)) ||
      (await notConfigured.isVisible({ timeout: 2000 }).catch(() => false)) ||
      (await toggle.first().isVisible({ timeout: 500 }).catch(() => false));

    expect(anyVisible).toBe(true);
  });

  test('settings page content mentions the Items tab', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByText(/Manage categories and items from the/i)).toBeVisible();
  });
});
