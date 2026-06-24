import { test, expect } from '@playwright/test';

// ── Deep-route direct-load tests ─────────────────────────────────────────────
// Each test navigates straight to the route (no prior load of '/') and checks
// that the correct screen is displayed.
//
// Regression guard: Vite base: './' produced relative asset paths that caused
// JS to fail loading when the app was accessed on any route other than '/'.
// If the app fails to mount, Vue-rendered content will be absent.

test.describe('Direct navigation to each route', () => {
  const routes = [
    {
      path: '/',
      description: 'Home screen',
      // ActionPane renders this block title once items are loaded
      landmark: 'Currently Wearing',
    },
    {
      path: '/items',
      description: 'Items screen',
      landmark: 'Categories',
    },
    {
      path: '/stats',
      description: 'Stats screen',
      // SegmentedControl always renders the first leaderboard tab label
      landmark: 'Longest Wear',
    },
    {
      path: '/setup',
      description: 'Setup screen',
      // k-navbar title is always visible
      landmark: 'Welcome to Weartrack',
    },
  ];

  for (const { path, description, landmark } of routes) {
    test(`${description} loads when navigating directly to ${path}`, async ({ page }) => {
      await page.goto(path);
      // Tab bar must be visible — proves Vue mounted (JS loaded correctly)
      await expect(page.getByRole('link', { name: /home/i })).toBeVisible();
      // Screen-specific landmark scoped to main content — proves the correct view
      // was rendered and guards against accidental matches on tab bar labels.
      await expect(
        page.locator('[data-testid="main-content"]').getByText(landmark, { exact: true }).first()
      ).toBeVisible();
    });
  }
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads home page', async ({ page }) => {
    await expect(page).toHaveTitle(/weartrack/i);
    // Home renders the ActionPane "Currently Wearing" block title
    await expect(
      page.locator('[data-testid="main-content"]').getByText('Currently Wearing').first()
    ).toBeVisible();
  });

  test('tab bar is always visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: /home/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /items/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /stats/i })).toBeVisible();
  });

  test('navigates to Items tab', async ({ page }) => {
    await page.getByRole('link', { name: /items/i }).click();
    await expect(page).toHaveURL(/\/items/);
    await expect(page.getByText('Categories', { exact: true })).toBeVisible();
    await expect(page.getByText('Items', { exact: true }).first()).toBeVisible();
  });

  test('navigates to Stats tab', async ({ page }) => {
    await page.getByRole('link', { name: /stats/i }).click();
    await expect(page).toHaveURL(/\/stats/);
  });

  test('navigates back to Home tab', async ({ page }) => {
    await page.getByRole('link', { name: /items/i }).click();
    await page.getByRole('link', { name: /home/i }).click();
    await expect(page).toHaveURL('/');
  });
});
