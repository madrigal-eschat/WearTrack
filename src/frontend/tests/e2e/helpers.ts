import { Page } from '@playwright/test';

/** Unique suffix so parallel test runs don't collide on names. */
export const uid = () => Math.random().toString(36).slice(2, 7);

/** Navigate to the Items tab. */
export async function goToItems(page: Page) {
  await page.getByRole('link', { name: /items/i }).click();
  await page.waitForURL('**/items');
}

/** Navigate to the Home tab. */
export async function goToHome(page: Page) {
  await page.getByRole('link', { name: /home/i }).click();
  await page.waitForURL('/');
}

/** Navigate to the Stats tab. */
export async function goToStats(page: Page) {
  await page.getByRole('link', { name: /stats/i }).click();
  await page.waitForURL('**/stats');
}

/**
 * Create a category via the Items view form.
 * Returns the category name used.
 */
export async function createCategory(page: Page, name: string, icon = '🧪') {
  await page.getByRole('button', { name: '+ Add', exact: false }).first().click();
  await page.getByLabel('Name').first().fill(name);
  await page.getByLabel(/icon/i).first().fill(icon);
  await page.getByRole('button', { name: 'Add Category' }).click();
  // Wait for the category to appear in the list
  await page.getByText(name).first().waitFor();
  return name;
}

/**
 * Delete a category by name via the Items view.
 */
export async function deleteCategory(page: Page, name: string) {
  const row = page.locator('li').filter({ hasText: name }).first();
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'OK' }).click().catch(() => {
    // confirm() dialogs are handled automatically by Playwright (accepted by default)
  });
}
