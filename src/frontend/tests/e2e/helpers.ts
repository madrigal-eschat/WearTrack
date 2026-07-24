import { Page } from '@playwright/test'

/** Unique suffix so parallel test runs don't collide on names. */
export const uid = () => Math.random().toString(36).slice(2, 7)

/** Navigate to the Items tab. */
export async function goToItems(page: Page) {
  await page.getByRole('link', { name: /items/i }).click()
  await page.waitForURL('**/items')
}

/** Navigate to the Home tab. */
export async function goToHome(page: Page) {
  await page.getByRole('link', { name: /home/i }).click()
  await page.waitForURL('/')
}

/** Navigate to the Stats tab. */
export async function goToStats(page: Page) {
  await page.getByRole('link', { name: /stats/i }).click()
  await page.waitForURL('**/stats')
}

/**
 * Create a category via the Items view form.
 * Returns the category name used.
 */
export async function createCategory(page: Page, name: string) {
  const addBtn = page.getByRole('button', { name: '+ Add', exact: false })
  await addBtn.first().click()
  await page.getByLabel('Name').first().fill(name)
  // Open icon picker and select first available icon
  await page.getByRole('button', { name: /choose icon/i }).first().click()
  await page.waitForSelector('.overflow-y-auto')
  await page.locator('.overflow-y-auto button').first().click()
  await page.getByTestId('category-form-submit').click()
  // Wait for the category to appear in the list
  await page.getByText(name).first().waitFor()
  return name
}

/**
 * Create a category via the API directly (faster setup for non-add-form tests).
 * Returns the created category (with id).
 */
export async function createCategoryViaApi(
  page: Page,
  name: string,
  icon = '🧪',
) {
  const res = await page.request.post('/api/categories', {
    data: {
      name,
      icon,
      initial_target_wear_duration_seconds: 900,
      initial_max_wear_duration_seconds: 1800,
      rest_multiplier: 2,
      minimum_rest: 86400,
      risk_levels: [
        { lower: null, upper: 3600, text: 'Low', severity: 1 },
        { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
        { lower: 7200, upper: null, text: 'High', severity: 3 },
      ],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
    },
  })
  return res.json() as Promise<{ id: number; name: string; icon: string }>
}

/**
 * Delete a category by id via the API.
 */
export async function deleteCategoryViaApi(page: Page, id: number) {
  await page.request.delete(`/api/categories/${id}`)
}

/**
 * Delete a category by name via the Items view.
 */
export async function deleteCategory(page: Page, name: string) {
  const row = page.locator('li').filter({ hasText: name }).first()
  await row.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'OK' }).click().catch(() => {
    // confirm() dialogs are handled automatically by Playwright
    // (accepted by default)
  })
}
