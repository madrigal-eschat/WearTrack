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
    await page.getByLabel(/icon/i).first().fill('🧪');
    await page.getByRole('button', { name: 'Add Category' }).click();
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
    await page.getByRole('button', { name: 'Add Item' }).click();

    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('Add Item button is disabled when name is empty', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await expect(page.getByRole('button', { name: 'Add Item' })).toBeDisabled();
  });

  test('can delete an item', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);
    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    const row = page.locator('li').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByText(name)).not.toBeVisible();
  });

  test('item appears under its category', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);
    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    // The category heading should precede the item in the DOM
    const categoryHeading = page.getByText(categoryName).last();
    const itemEntry = page.getByText(name).first();
    const catBox = await categoryHeading.boundingBox();
    const itemBox = await itemEntry.boundingBox();
    expect(catBox!.y).toBeLessThan(itemBox!.y);
  });

  test('can select a color via swatch', async ({ page }) => {
    const name = `Item-${uid()}`;

    await page.getByRole('button', { name: '+ Add' }).nth(1).click();
    await page.getByLabel('Name').last().fill(name);

    // Open the color picker popover
    await page.locator('[data-testid="color-trigger"]').click();

    // Click the second swatch (hue 30°)
    await page.locator('[data-testid="color-swatch"]').nth(1).click();

    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    // Color circle style should contain oklch
    const circle = page.locator('li').filter({ hasText: name }).locator('[data-testid="color-circle"]').first();
    const style = await circle.getAttribute('style');
    expect(style).toContain('oklch');
  });

  test('new items get random default colors', async ({ page }) => {
    const names = Array.from({ length: 4 }, () => `Item-${uid()}`);

    for (const name of names) {
      await page.getByRole('button', { name: '+ Add' }).nth(1).click();
      await page.getByLabel('Name').last().fill(name);
      await page.getByRole('button', { name: 'Add Item' }).click();
      await expect(page.getByText(name).first()).toBeVisible();
    }

    const colors = await Promise.all(
      names.map((name) =>
        page
          .locator('li')
          .filter({ hasText: name })
          .locator('[data-testid="color-circle"]')
          .first()
          .getAttribute('style')
      )
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

    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(page.getByText(name).first()).toBeVisible();

    const circle = page
      .locator('li')
      .filter({ hasText: name })
      .locator('[data-testid="color-circle"]')
      .first();
    const style = await circle.getAttribute('style');
    expect(style).toContain('oklch');
    expect(style).toContain('180');
    expect(style).toContain('0.2');
  });
});
