import { test, expect } from '@playwright/test';

/**
 * Settings page tests.
 *
 * Settings is accessed via a cog-icon button on the Home screen (ActionPane),
 * not a tabbar entry. Clicking it navigates to /settings, a full page view.
 */

/** Helper: click the Settings button on the home screen. */
async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^settings$/i }).click();
}

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Settings button is visible on the home screen', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /^settings$/i });
    await expect(settingsBtn).toBeVisible();
  });

  test(
    'clicking the Settings button navigates to /settings',
    async ({ page }) => {
      await openSettings(page);
      await expect(page).toHaveURL(/\/settings/);
    },
  );

  test(
    'settings page shows push-notification state message',
    async ({ page }) => {
      await openSettings(page);

      // In a test browser (Chromium/WebKit) without a push VAPID
      // key configured on the server, one of three states is expected:
      //   1. "Push notifications are not supported in this browser."
      //      — webkit/no-push
      //   2. "Push notifications are not configured on the server."
      //      — chromium, no VAPID
      //   3. A k-toggle element — only when server is configured AND
      //      browser supports push
      const notSupported = page.getByText(/not supported in this browser/i);
      const notConfigured = page.getByText(
        /not configured on the server/i,
      );
      const toggle = page
        .locator('[class*="toggle"], input[type="checkbox"]')
        .filter({ hasText: '' });

      const anyVisible =
        (await notSupported
          .isVisible({ timeout: 2000 })
          .catch(() => false)) ||
        (await notConfigured
          .isVisible({ timeout: 2000 })
          .catch(() => false)) ||
        (await toggle
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false));

      expect(anyVisible).toBe(true);
    },
  );

  test(
    'settings page content mentions the Items tab',
    async ({ page }) => {
      await openSettings(page);
      const itemsText = page.getByText(/Manage categories and items from the/i);
      await expect(itemsText).toBeVisible();
    },
  );
});
