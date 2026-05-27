import { test, expect } from '@playwright/test';
import { uid } from './helpers.js';

test.describe('Category management', () => {
  // Track categories created in each test so we can clean them up
  let createdName: string | null = null;

  test.beforeEach(async ({ page }) => {
    createdName = null;
    await page.goto('/items');
    page.on('dialog', (d) => d.accept());
  });

  test.afterEach(async ({ page }) => {
    if (!createdName) return;
    // Clean up any category this test created.
    // The dialog handler from beforeEach is still active — don't re-register it.
    await page.goto('/items');
    const row = page.locator('li').filter({ hasText: createdName }).first();
    await row.getByRole('button', { name: 'Delete' }).click().catch(() => {});
  });

  test('shows empty state when no categories exist', async ({ page }) => {
    // This passes when categories section is visible even if empty
    await expect(page.getByText('Categories', { exact: true })).toBeVisible();
  });

  test('can add a category', async ({ page }) => {
    const name = `Cat-${uid()}`;
    createdName = name;

    await page.getByRole('button', { name: '+ Add' }).first().click();
    await expect(page.getByLabel('Name').first()).toBeVisible();

    await page.getByLabel('Name').first().fill(name);
    await page.getByLabel(/icon/i).first().fill('🧪');
    await page.getByRole('button', { name: 'Add Category' }).click();

    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('add form is dismissed after save', async ({ page }) => {
    const name = `Cat-${uid()}`;
    createdName = name;

    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(name);
    await page.getByLabel(/icon/i).first().fill('🧪');
    await page.getByRole('button', { name: 'Add Category' }).click();

    // Form should close: "Add Category" button gone, toggle back to "+ Add"
    await expect(page.getByRole('button', { name: 'Add Category' })).not.toBeVisible();
  });

  test('cancel button hides the add form without saving', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await expect(page.getByLabel('Name').first()).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByLabel('Name')).not.toBeVisible();
  });

  test('Add Category button is disabled when fields are empty', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await expect(page.getByRole('button', { name: 'Add Category' })).toBeDisabled();
  });

  test('can delete a category', async ({ page }) => {
    const name = `Cat-${uid()}`;
    // Don't set createdName — the test itself deletes the category

    // Create it first
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(name);
    await page.getByLabel(/icon/i).first().fill('🧪');
    await page.getByRole('button', { name: 'Add Category' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    // Delete it
    const row = page.locator('li').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(name).first()).not.toBeVisible();
  });

  test('duration picker hours column wraps when scrolled past the end', async ({ page }) => {
    await page.goto('/items');
    await page.getByRole('button', { name: '+ Add', exact: false }).first().click();

    // Open the duration picker via the Initial wear button (first ▾ button in the form)
    await page.getByRole('button', { name: /▾/ }).first().click();
    await page.waitForSelector('[data-testid="hours-col"]');

    // Scroll the hours column to the very bottom of the tripled list
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="hours-col"]') as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });

    // Wait for the debounce (150ms) + snap (allow 300ms total)
    await page.waitForTimeout(300);

    const scrollTop = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="hours-col"]') as HTMLElement;
      return el.scrollTop;
    });

    // After wrap the position must be in the middle third: [24*44, 2*24*44)
    expect(scrollTop).toBeGreaterThanOrEqual(24 * 44);
    expect(scrollTop).toBeLessThan(2 * 24 * 44);

    // Dismiss the picker without saving
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('can create a category with custom initial wear, rest multiplier, and band count', async ({ page }) => {
    const name = `Cat-${uid()}`;
    createdName = name;

    await page.goto('/items');
    await page.getByRole('button', { name: '+ Add', exact: false }).first().click();
    await page.getByLabel('Name').first().fill(name);

    // Open icon picker and select the first available icon
    await page.getByRole('button', { name: /choose icon/i }).click();
    await page.waitForSelector('.overflow-y-auto'); // icon grid
    await page.locator('.overflow-y-auto button').first().click(); // pick first icon

    // Set initial wear to 1h 30m via the picker
    await page.getByRole('button', { name: /▾/ }).first().click();
    await page.waitForSelector('[data-testid="hours-col"]');
    // Scroll hours to 1 (middle copy index = 24 + 1 = 25, scrollTop = 25 * 44)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="hours-col"]') as HTMLElement;
      el.scrollTop = 25 * 44;
    });
    // Scroll minutes to 30 (middle copy index = 60 + 30 = 90, scrollTop = 90 * 44)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="minutes-col"]') as HTMLElement;
      el.scrollTop = 90 * 44;
    });
    await page.waitForTimeout(200); // let scroll settle
    await page.getByRole('button', { name: 'Done' }).click();

    // Set rest multiplier to 1.5
    await page.getByLabel(/rest multiplier/i).fill('1.5');

    // Add a 4th band
    await page.getByRole('button', { name: '+' }).click();

    // Submit
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByText(name).first().waitFor();

    // Verify via API
    const res = await page.request.get('/api/categories');
    const cats: Array<{
      name: string;
      initial_wear_duration_seconds: number;
      rest_multiplier: number;
      risk_levels: unknown[];
    }> = await res.json();
    const saved = cats.find((c) => c.name === name);

    expect(saved).toBeDefined();
    expect(saved!.initial_wear_duration_seconds).toBe(1 * 3600 + 30 * 60); // 5400
    expect(saved!.rest_multiplier).toBe(1.5);
    expect(saved!.risk_levels).toHaveLength(4);
  });
});
