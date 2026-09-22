import { test, expect } from '@playwright/test'

/**
 * Settings page tests.
 *
 * Settings is accessed via a cog-icon button on the Home screen (ActionPane),
 * not a tabbar entry. Clicking it navigates to /settings, a full page view.
 */

/** Helper: click the Settings button on the home screen. */
async function openSettings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /^settings$/i }).click()
}

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Settings button is visible on the home screen', async ({ page }) => {
    const settingsBtn = page.getByRole('button', { name: /^settings$/i })
    await expect(settingsBtn).toBeVisible()
  })

  test(
    'clicking the Settings button navigates to /settings',
    async ({ page }) => {
      await openSettings(page)
      await expect(page).toHaveURL(/\/settings/)
    },
  )

  test(
    'settings page shows push-notification state message',
    async ({ page }) => {
      // In a test browser (Chromium/WebKit) without a push VAPID
      // key configured on the server, one of three states is expected:
      //   1. "Push notifications are not supported in this browser."
      //      — webkit/no-push
      //   2. "Push notifications are not configured on the server."
      //      — chromium, no VAPID
      //   3. A k-toggle element — only when server is configured AND
      //      browser supports push
      const notSupported = page.getByText(/not supported in this browser/i)
      const notConfigured = page.getByText(
        /not configured on the server/i,
      )
      const toggle = page
        .locator('[class*="toggle"], input[type="checkbox"]')
        .filter({ hasText: '' })

      const browserSupportsPush = await page.evaluate(
        () =>
          'Notification' in window &&
          'PushManager' in window,
      )
      const vapidKeyResponse = browserSupportsPush
        ? page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/notifications/vapid-public-key') &&
            response.request().method() === 'GET',
        )
        : undefined

      await openSettings(page)
      if (vapidKeyResponse) {
        await vapidKeyResponse
      }

      if (browserSupportsPush) {
        // Wait for the async notification initialization before checking the
        // configured branch; isConfigured starts false.
        await expect(notConfigured.or(toggle.first())).toBeVisible()
      } else {
        await expect(notSupported).toBeVisible()
      }
    },
  )

  test(
    'settings page content mentions the Items tab',
    async ({ page }) => {
      await openSettings(page)
      const itemsText = page.getByText(/Manage categories and items from the/i)
      await expect(itemsText).toBeVisible()
    },
  )

  test(
    'built image displays its frontend and backend version metadata',
    async ({ page }) => {
      const builtImageMetadataEnabled =
        process.env.E2E_BUILT_IMAGE_METADATA === 'true'
      test.skip(
        !builtImageMetadataEnabled,
        'Set E2E_BUILT_IMAGE_METADATA=true to test built-image metadata.',
      )

      await openSettings(page)

      // Opt in after building the image with:
      //   APP_VERSION=1.2.5 COMMIT_HASH=abcd1234 docker build \
      //     --build-arg APP_VERSION --build-arg COMMIT_HASH -t weartrack:e2e .
      // Then run this spec with BASE_URL pointing at that container and
      // E2E_BUILT_IMAGE_METADATA=true. APP_VERSION and COMMIT_HASH may be
      // overridden to match different metadata supplied to the image.
      const expectedVersion = process.env.APP_VERSION || '1.2.5'
      const expectedCommit = process.env.COMMIT_HASH || 'abcd1234'
      await expect(
        page.getByText(
          `Frontend ${expectedVersion} (${expectedCommit})`,
          { exact: true },
        ),
      ).toBeVisible()
      await expect(
        page.getByText(
          `Backend ${expectedVersion} (${expectedCommit})`,
          { exact: true },
        ),
      ).toBeVisible()
    },
  )
})
