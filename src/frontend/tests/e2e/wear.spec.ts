import { test, expect } from '@playwright/test';
import { uid } from './helpers.js';

test.describe('Wear sessions', () => {
  let categoryId: number;
  let categoryName: string;
  let itemName: string;

  // Use the API directly for setup so we can set rest_constant_seconds: 0,
  // meaning the item can be worn again immediately after a session ends.
  test.beforeAll(async ({ request }) => {
    categoryName = `WearCat-${uid()}`;
    itemName = `WearItem-${uid()}`;

    const catRes = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '👟',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 900,
        rest_multiplier: 0,
        minimum_rest: 0,
        risk_levels: [
          { lower: null, upper: 3600, text: 'Low', severity: 1 },
          { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
          { lower: 7200, upper: null, text: 'High', severity: 3 },
        ],
        break_decay_multiplier: 0.91,
        break_grace_time: 86400,
      },
    });
    const cat = await catRes.json();
    categoryId = cat.id;

    await request.post('/api/items', {
      data: { name: itemName, color: '#3b82f6', category_id: categoryId },
    });
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    page.on('dialog', (d) => d.accept());
    // Stop any active session left from a previous test.
    // Safe to do because rest_constant_seconds: 0 — no penalty for stopping.
    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    if (await stopBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await stopBtn.click();
    }
  });

  test('shows a Wear button for each item', async ({ page }) => {
    await expect(page.getByRole('button', { name: /wear/i }).first()).toBeVisible();
  });

  test('can start a wear session', async ({ page }) => {
    const wearBtn = page.getByRole('button', { name: /^wear$/i }).filter({ enabled: true }).first();
    await wearBtn.click();

    await expect(page.getByRole('button', { name: /stop/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('elapsed time is shown while wearing', async ({ page }) => {
    const wearBtn = page.getByRole('button', { name: /^wear$/i }).filter({ enabled: true }).first();
    await wearBtn.click();

    // formatDuration returns "Xs", "Xm Ys", or "Xh Ym" — e.g. "0s", "5s", "1m 2s"
    await expect(page.locator('text=/\\d+[smh]/').first()).toBeVisible({ timeout: 5000 });
  });

  test('can stop a wear session', async ({ page }) => {
    const wearBtn = page.getByRole('button', { name: /^wear$/i }).filter({ enabled: true }).first();
    await wearBtn.click();

    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    await stopBtn.waitFor({ timeout: 5000 });
    await stopBtn.click();

    await expect(page.getByRole('button', { name: /^wear$/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('active session shows a target marker on the bar', async ({ page }) => {
    const wearBtn = page.getByRole('button', { name: /^wear$/i }).filter({ enabled: true }).first();
    await wearBtn.click();
    await expect(page.getByRole('button', { name: /stop/i }).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('target-marker').first()).toBeVisible();
  });
});
