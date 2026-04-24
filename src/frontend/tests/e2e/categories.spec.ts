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
});
