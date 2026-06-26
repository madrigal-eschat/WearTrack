import { test, expect } from '@playwright/test';

/**
 * SettingsDrawer tests.
 *
 * The Settings tab lives in the App.vue tabbar (label "Settings", cog icon).
 * Clicking it opens the SettingsDrawer sheet component, which slides up from
 * the bottom of the screen.
 *
 * SettingsDrawer shows:
 *   - A "Settings" heading in the toolbar
 *   - A "Done" button to close it
 *   - A push-notifications toggle (k-toggle) — only visible when the browser
 *     supports push notifications AND the server has push configured.
 *     In test environments neither condition is typically met, so we also
 *     verify the fallback messages.
 */

/** Helper: click the Settings tab in the bottom tab bar. */
async function openSettings(page: import('@playwright/test').Page) {
  // Konsta k-tabbar-link renders as an <a> element. The Settings tab has
  // label="Settings" so Playwright can find it as a link or by text.
  // We try link role first (matches on desktop Chrome/WebKit); fall back to
  // any element with "Settings" text inside the tabbar.
  const link = page.getByRole('link', { name: /^settings$/i });
  if (await link.isVisible({ timeout: 1000 }).catch(() => false)) {
    await link.click();
  } else {
    // Fallback: find the tabbar element containing "Settings" text
    await page.locator('[class*="tabbar"] a').filter({ hasText: /^settings$/i }).click();
  }
}

test.describe('SettingsDrawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Settings tab is visible in the tab bar', async ({ page }) => {
    // Either a link or an anchor inside the tabbar
    const settingsTab =
      page.getByRole('link', { name: /^settings$/i }).or(
        page.locator('[class*="tabbar"] a').filter({ hasText: /^settings$/i }),
      );
    await expect(settingsTab.first()).toBeVisible();
  });

  test('clicking the Settings tab opens the settings sheet', async ({ page }) => {
    await openSettings(page);

    // The sheet toolbar contains a "Settings" heading (use .first() to avoid
    // strict-mode violation — the tab bar link also contains "Settings" text)
    await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible();
    // And a "Done" button
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('Done button closes the settings sheet', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();

    // Sheet should disappear — Done button no longer visible
    await expect(page.getByRole('button', { name: 'Done' })).not.toBeVisible();
  });

  test('clicking backdrop closes the settings sheet', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();

    // Click on the backdrop (outside the sheet) — the sheet uses @backdropclick
    // which Konsta wires to a backdrop overlay element. We click near the top of
    // the viewport, which is outside the bottom sheet.
    await page.mouse.click(200, 50);

    await expect(page.getByRole('button', { name: 'Done' })).not.toBeVisible({ timeout: 2000 });
  });

  test('settings sheet shows push-notification state message', async ({ page }) => {
    await openSettings(page);

    // In a test browser (Chromium/WebKit) without a push VAPID key configured on
    // the server, one of three states is expected:
    //   1. "Push notifications are not supported in this browser." — webkit/no-push
    //   2. "Push notifications are not configured on the server." — chromium, no VAPID
    //   3. A k-toggle element — only when server is configured AND browser supports push
    //
    // We assert at least one of these is present.
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

  test('settings sheet content mentions the Items tab', async ({ page }) => {
    await openSettings(page);

    // The static message in SettingsDrawer.vue always reads:
    // "Manage categories and items from the Items tab."
    await expect(page.getByText(/Manage categories and items from the/i)).toBeVisible();
  });
});
