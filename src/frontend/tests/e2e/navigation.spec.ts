import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // Regression guard: Vite base: './' produced relative asset paths that broke
  // JS loading when the app was loaded on any route other than '/'.
  // The tab bar is rendered by Vue — if it's missing, the app never mounted.
  test('app mounts when navigating directly to a deep route (no redirect from /)', async ({ page }) => {
    await page.goto('/items');
    await expect(page.getByRole('link', { name: /home/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /items/i })).toBeVisible();
  });


  test('loads home page', async ({ page }) => {
    await expect(page).toHaveTitle(/weartrack/i);
    await expect(page.getByText('Weartrack')).toBeVisible();
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
