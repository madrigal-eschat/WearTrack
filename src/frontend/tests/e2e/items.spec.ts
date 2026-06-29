import { test, expect } from '@playwright/test';
import { uid } from './helpers.js';

test.describe('Item management', () => {
  let categoryName: string;

  test.beforeEach(async ({ page }) => {
    await page.goto('/items');
    page.on('dialog', (d) => d.accept());

    // Ensure a category exists for item tests
    categoryName = `Cat-${uid()}`;
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(categoryName);
    await page.getByRole('button', { name: /choose icon/i }).first().click();
    await page.waitForSelector('.overflow-y-auto');
    await page.locator('.overflow-y-auto button').first().click();
    await page.getByTestId('category-form-submit').click();
    await expect(page.getByText(categoryName).first()).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    // Clean up the category (cascades to items)
    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Delete' }).click().catch(() => {});
  });

  test('shows Items section', async ({ page }) => {
    await expect(page.getByText('Items', { exact: true }).first()).toBeVisible();
  });

  test('can add an item', async ({ page }) => {
    const name = `Item-${uid()}`;

    // Open item form (second "+ Add" button — first is for categories)
    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);
    // Category should be pre-selected; pick one if not
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('Add Item button is disabled when name is empty', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  });

  test('can delete an item', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    const row = page.locator('li').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(name)).not.toBeVisible();
  });

  test('item appears under its category', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    // Verify the item appears within its category's section by scoping the
    // item search to the div that wraps both the category heading and its list.
    // This avoids fragile bounding-box comparisons that break when other
    // categories are present on the page.
    const categorySection = page.locator('div').filter({
      has: page.locator('div.uppercase', { hasText: categoryName }),
    }).first();
    await expect(categorySection.getByText(name)).toBeVisible();
  });

  test('can select a color via swatch', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);

    // Open the color picker popover
    await page.locator('[data-testid="color-trigger"]').click();

    // Click the second swatch (hue 30°)
    await page.locator('[data-testid="color-swatch"]').nth(1).click();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    // The picked swatch is persisted as an oklch colour
    const items = await page.request.get('/api/items').then((r) => r.json());
    const created = items.find((i: { name: string }) => i.name === name);
    expect(created?.color).toContain('oklch');
  });

  test('new items get random default colors', async ({ page }) => {
    const names = Array.from({ length: 4 }, () => `Item-${uid()}`);

    for (const name of names) {
      await page.getByRole('button', { name: '+ Add' }).nth(1).click();
      await page.getByLabel('Name').last().fill(name);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText(name).first()).toBeVisible();
    }

    const items = await page.request.get('/api/items').then((r) => r.json());
    const colors = names.map(
      (name) => items.find((i: { name: string }) => i.name === name)?.color,
    );

    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });

  test('can set color via advanced hue and chroma sliders', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);

    // Open color picker
    await page.locator('[data-testid="color-trigger"]').click();

    // Expand advanced sliders
    await page.getByRole('button', { name: /advanced/i }).click();

    // Set hue to 180, chroma to 0.2
    await page.locator('[data-testid="hue-slider"]').fill('180');
    await page.locator('[data-testid="chroma-slider"]').fill('0.2');

    // Close the dropdown before submitting
    await page.locator('[data-testid="color-backdrop"]').click();

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    const items = await page.request.get('/api/items').then((r) => r.json());
    const created = items.find((i: { name: string }) => i.name === name);
    expect(created?.color).toContain('oklch');
    expect(created?.color).toContain('180');
    expect(created?.color).toContain('0.2');
  });
});

test.describe('Item editing', () => {
  let categoryName: string;
  let itemName: string;

  test.beforeEach(async ({ page }) => {
    await page.goto('/items');
    page.on('dialog', (d) => d.accept());

    // Create a fresh category via the UI form
    categoryName = `EditItemCat-${uid()}`;
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(categoryName);
    await page.getByRole('button', { name: /choose icon/i }).first().click();
    await page.waitForSelector('.overflow-y-auto');
    await page.locator('.overflow-y-auto button').first().click();
    await page.getByTestId('category-form-submit').click();
    await expect(page.getByText(categoryName).first()).toBeVisible();

    // Create a fresh item under that category
    itemName = `EditItem-${uid()}`;
    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(itemName);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(itemName).first()).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    // Delete the category (cascades to items)
    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Delete' }).click().catch(() => {});
  });

  test('Edit button opens an inline edit form below the item row', async ({ page }) => {
    const row = page.locator('li').filter({ hasText: itemName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    // The edit form contains a Name field (id="edit-item-name") and a Save button
    await expect(page.getByLabel('Name').last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  });

  test('edit form is pre-filled with the item name', async ({ page }) => {
    const row = page.locator('li').filter({ hasText: itemName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    // The edit-item-name field should contain the current name
    await expect(page.locator('#edit-item-name')).toHaveValue(itemName);
  });

  test('can rename an item and the new name appears in the list', async ({ page }) => {
    const newName = `${itemName}-renamed`;

    const row = page.locator('li').filter({ hasText: itemName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    await page.locator('#edit-item-name').fill(newName);
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Form closes and updated name appears
    await expect(page.getByRole('button', { name: 'Save', exact: true })).not.toBeVisible();
    await expect(page.getByText(newName).first()).toBeVisible();

    // Verify persisted via API
    const items: Array<{ name: string; id: number }> = await page.request
      .get('/api/items')
      .then((r) => r.json());
    expect(items.some((i) => i.name === newName)).toBe(true);

    // Update cleanup reference so afterEach doesn't break on the category row
    itemName = newName;
  });

  test('can change difficulty multiplier and the change persists', async ({ page }) => {
    const row = page.locator('li').filter({ hasText: itemName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    // Set difficulty to 1.5
    await page.locator('#edit-item-difficulty').fill('1.5');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Save', exact: true })).not.toBeVisible();

    // Verify via API
    const items: Array<{ name: string; difficulty_multiplier: number }> = await page.request
      .get('/api/items')
      .then((r) => r.json());
    const saved = items.find((i) => i.name === itemName);
    expect(saved?.difficulty_multiplier).toBe(1.5);
  });

  test('Cancel button closes the edit form without saving changes', async ({ page }) => {
    const row = page.locator('li').filter({ hasText: itemName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    await page.locator('#edit-item-name').fill('should-not-save');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Form closes; original name still in list
    await expect(page.getByRole('button', { name: 'Save', exact: true })).not.toBeVisible();
    await expect(page.getByText(itemName).first()).toBeVisible();

    // Verify API unchanged
    const items: Array<{ name: string }> = await page.request
      .get('/api/items')
      .then((r) => r.json());
    expect(items.some((i) => i.name === itemName)).toBe(true);
    expect(items.some((i) => i.name === 'should-not-save')).toBe(false);
  });

  test('clicking Edit a second time closes the form (toggle)', async ({ page }) => {
    const row = page.locator('li').filter({ hasText: itemName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#edit-item-name')).toBeVisible();

    // Click Edit again — form should close
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#edit-item-name')).not.toBeVisible();
  });
});
