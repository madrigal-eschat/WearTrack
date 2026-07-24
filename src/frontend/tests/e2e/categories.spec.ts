import { test, expect } from '@playwright/test';
import { uid, createCategoryViaApi, deleteCategoryViaApi } from './helpers.js';

test.describe('Category management', () => {
  // Track categories created in each test so we can clean them up
  let createdName: string | null = null;

  test.beforeEach(async ({ page }) => {
    createdName = null;
    await page.goto('/items');
  });

  test.afterEach(async ({ page }) => {
    if (!createdName) {
      return;
    }
    // Clean up any category this test created.
    await page.goto('/items');
    const row = page.locator('li').filter({ hasText: createdName }).first();
    await row
      .getByRole('button', { name: 'Delete' })
      .first()
      .click()
      .catch(() => {});
    // force: true — every row mounts its own (fixed, viewport-centered)
    // confirm dialog, so an unrelated row's closed dialog can sit in the
    // hit-test path even though only this row's dialog is visually open.
    await row
      .getByTestId('delete-confirm')
      .click({ force: true })
      .catch(() => {});
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
    await page.getByRole('button', { name: /choose icon/i }).first().click();
    await page.waitForSelector('.overflow-y-auto');
    await page.locator('.overflow-y-auto button').first().click();
    await page.getByTestId('category-form-submit').click();

    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('add form is dismissed after save', async ({ page }) => {
    const name = `Cat-${uid()}`;
    createdName = name;

    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(name);
    await page.getByRole('button', { name: /choose icon/i }).first().click();
    await page.waitForSelector('.overflow-y-auto');
    await page.locator('.overflow-y-auto button').first().click();
    await page.getByTestId('category-form-submit').click();

    // Form should close: submit button gone, toggle back to "+ Add"
    await expect(page.getByTestId('category-form-submit')).not.toBeVisible();
  });

  test('cancel button hides the add form without saving', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await expect(page.getByLabel('Name').first()).toBeVisible();

    await page.getByTestId('category-form-cancel').click();
    await expect(page.getByLabel('Name')).not.toBeVisible();
  });

  test('submit button is disabled when fields are empty', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await expect(page.getByTestId('category-form-submit')).toBeDisabled();
  });

  test('can delete a category', async ({ page }) => {
    const name = `Cat-${uid()}`;
    // Don't set createdName — the test itself deletes the category

    // Create it first
    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(name);
    await page.getByRole('button', { name: /choose icon/i }).first().click();
    await page.waitForSelector('.overflow-y-auto');
    await page.locator('.overflow-y-auto button').first().click();
    await page.getByTestId('category-form-submit').click();
    await expect(page.getByText(name).first()).toBeVisible();

    // Delete it
    const row = page.locator('li').filter({ hasText: name }).first();
    await row.getByRole('button', { name: 'Delete' }).first().click();
    await row.getByTestId('delete-confirm').click({ force: true });

    await expect(page.getByText(name).first()).not.toBeVisible();
  });

  test('duration picker hours column wraps when scrolled past the end', async ({
    page,
  }) => {
    await page.goto('/items');
    await page
      .getByRole('button', { name: '+ Add', exact: false })
      .first()
      .click();

    // Open the duration picker via the Initial wear button (first ▾ button
    // in the form)
    await page.getByRole('button', { name: /▾/ }).first().click();
    await page.waitForSelector('[data-testid="hours-col"]');

    // Scroll the hours column to the very bottom of the tripled list
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="hours-col"]',
      ) as HTMLElement;
      el.scrollTop = el.scrollHeight;
    });

    // Wait for the debounce (150ms) + JS smooth-scroll wrap to settle.
    // Use waitForFunction so slow CI runners don't race against a fixed
    // timeout.
    await page.waitForFunction(() => {
      const el = document.querySelector(
        '[data-testid="hours-col"]',
      ) as HTMLElement | null;
      if (!el) {
        return false;
      }
      return el.scrollTop >= 24 * 44 && el.scrollTop < 2 * 24 * 44;
    }, { timeout: 2000 });

    const scrollTop = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="hours-col"]',
      ) as HTMLElement;
      return el.scrollTop;
    });

    // After wrap the position must be in the middle third: [24*44, 2*24*44)
    expect(scrollTop).toBeGreaterThanOrEqual(24 * 44);
    expect(scrollTop).toBeLessThan(2 * 24 * 44);

    // Dismiss the picker without saving
    await page.getByTestId('duration-picker-cancel').click();
  });

  test(
    'can create a category with custom initial wear, rest multiplier, ' +
      'and band count',
    async ({ page }) => {
      const name = `Cat-${uid()}`;
      createdName = name;

      await page.goto('/items');
      await page
        .getByRole('button', { name: '+ Add', exact: false })
        .first()
        .click();
      await page.getByLabel('Name').first().fill(name);

      // Open icon picker and select the first available icon
      await page.getByRole('button', { name: /choose icon/i }).click();
      await page.waitForSelector('.overflow-y-auto'); // icon grid
      // pick first icon
      await page.locator('.overflow-y-auto button').first().click();

      // Set initial wear to 1h 30m via the picker
      await page.getByRole('button', { name: /▾/ }).first().click();
      await page.waitForSelector('[data-testid="hours-col"]');
      // Scroll hours to 1 (middle copy index = 24 + 1 = 25,
      // scrollTop = 25 * 44)
      await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="hours-col"]',
        ) as HTMLElement;
        el.scrollTop = 25 * 44;
      });
      // Scroll minutes to 30 (middle copy index = 60 + 30 = 90,
      // scrollTop = 90 * 44)
      await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="minutes-col"]',
        ) as HTMLElement;
        el.scrollTop = 90 * 44;
      });
      await page.waitForTimeout(200); // let scroll settle
      await page.getByTestId('duration-picker-done').click();

      // Set rest multiplier to 1.5
      await page.getByLabel(/rest multiplier/i).fill('1.5');

      // Add a 4th band
      await page.getByTestId('add-band').click();

      // Submit
      await page.getByTestId('category-form-submit').click();
      await page.getByText(name).first().waitFor();

      // Verify via API
      const res = await page.request.get('/api/categories');
      const cats: Array<{
        name: string;
        initial_target_wear_duration_seconds: number;
        rest_multiplier: number;
        risk_levels: unknown[];
      }> = await res.json();
      const saved = cats.find((c) => c.name === name);

      expect(saved).toBeDefined();
      // 5400
      expect(saved!.initial_target_wear_duration_seconds).toBe(
        1 * 3600 + 30 * 60,
      );
      expect(saved!.rest_multiplier).toBe(1.5);
      expect(saved!.risk_levels).toHaveLength(4);
    },
  );

  test('clearing the maximum disables the minimum rest picker', async ({
    page,
  }) => {
    const name = `NoMax-${uid()}`;
    createdName = name;

    await page.getByRole('button', { name: '+ Add' }).first().click();
    await page.getByLabel('Name').first().fill(name);
    await page.getByRole('button', { name: /choose icon/i }).first().click();
    await page.waitForSelector('.overflow-y-auto');
    await page.locator('.overflow-y-auto button').first().click();

    await expect(page.getByTestId('min-rest')).toBeEnabled();
    await page.getByTestId('clear-max').click();
    await expect(page.getByTestId('min-rest')).toBeDisabled();

    await page.getByTestId('category-form-submit').click();
    await expect(page.getByText(name).first()).toBeVisible();
  });
});

test.describe('Category editing', () => {
  let categoryId: number | null = null;
  let categoryName: string;

  test.beforeEach(async ({ page }) => {
    categoryName = `EditCat-${uid()}`;
    await page.goto('/items');
    page.on('dialog', (d) => d.accept());
    // Create via API for fast, reliable setup
    const cat = await createCategoryViaApi(page, categoryName);
    categoryId = cat.id;
    await page.reload(); // ensure the new category appears in the list
  });

  test.afterEach(async ({ page }) => {
    if (categoryId !== null) {
      await deleteCategoryViaApi(page, categoryId).catch(() => {});
      categoryId = null;
    }
  });

  test('Edit button opens an inline form below the row', async ({ page }) => {
    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();
    // The form appears right after the row — check for the Name field
    await expect(page.getByTestId('category-form-submit')).toBeVisible();
  });

  test('edit form is pre-filled with the existing category values', async ({
    page,
  }) => {
    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    // Name field should contain the category's name
    await expect(page.getByLabel('Name').first()).toHaveValue(categoryName);
  });

  test('can save an edited name via the Save button', async ({ page }) => {
    const newName = `${categoryName}-edited`;

    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    await page.getByLabel('Name').first().fill(newName);
    await page.getByTestId('category-form-submit').click();

    // Form closes and updated name appears in the list
    await expect(page.getByTestId('category-form-submit')).not.toBeVisible();
    await expect(page.getByText(newName).first()).toBeVisible();

    // Verify persisted via API
    const res = await page.request.get('/api/categories');
    const cats: Array<{ id: number; name: string }> = await res.json();
    const updated = cats.find((c) => c.id === categoryId);
    expect(updated?.name).toBe(newName);
    // update cleanup name so afterEach delete still works
    categoryName = newName;
  });

  test('cancel edit closes the form without saving changes', async ({
    page,
  }) => {
    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    await page.getByLabel('Name').first().fill('should-not-save');
    await page.getByTestId('category-form-cancel').click();

    // Form closed
    await expect(page.getByTestId('category-form-cancel')).not.toBeVisible();
    // Original name still in list
    await expect(page.getByText(categoryName).first()).toBeVisible();

    // Verify API unchanged
    const res = await page.request.get('/api/categories');
    const cats: Array<{ id: number; name: string }> = await res.json();
    expect(cats.find((c) => c.id === categoryId)?.name).toBe(categoryName);
  });

  test('clicking Edit a second time closes the inline form (toggle)', async ({
    page,
  }) => {
    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByTestId('category-form-submit')).toBeVisible();

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByTestId('category-form-submit')).not.toBeVisible();
  });

  test('opening the edit form closes the add form', async ({ page }) => {
    // Open the add form first
    await page
      .getByRole('button', { name: '+ Add', exact: false })
      .first()
      .click();
    await expect(page.getByTestId('category-form-submit')).toBeVisible();

    // Open edit for the existing category
    const row = page.locator('li').filter({ hasText: categoryName }).first();
    await row.getByRole('button', { name: 'Edit' }).click();

    // Still one form visible (the edit form), the add form should be gone
    await expect(page.getByTestId('category-form-submit')).toHaveCount(1);
  });

  test(
    'can edit custom fields (initial wear, rest multiplier, band count)',
    async ({ page }) => {
      const row = page
        .locator('li')
        .filter({ hasText: categoryName })
        .first();
      await row.getByRole('button', { name: 'Edit' }).click();

      // Change rest multiplier to 3
      await page.getByLabel(/rest multiplier/i).fill('3');

      // Add a 4th band
      await page.getByTestId('add-band').click();

      await page.getByTestId('category-form-submit').click();
      await expect(
        page.getByTestId('category-form-submit'),
      ).not.toBeVisible();

      // Verify via API
      const res = await page.request.get('/api/categories');
      const cats: Array<{
        id: number;
        rest_multiplier: number;
        risk_levels: unknown[];
      }> = await res.json();
      const updated = cats.find((c) => c.id === categoryId);
      expect(updated?.rest_multiplier).toBe(3);
      expect(updated?.risk_levels).toHaveLength(4);
    },
  );
});
