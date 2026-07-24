import { test, expect } from '@playwright/test'

test.describe('Stats / leaderboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/stats')
  })

  test('shows the stats page', async ({ page }) => {
    await expect(page).toHaveURL(/\/stats/)
  })

  test('shows all four leaderboard type tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /total wear/i }))
      .toBeVisible()
    await expect(page.getByRole('button', { name: /sessions/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /longest wear/i }))
      .toBeVisible()
    await expect(page.getByRole('button', { name: /longest streak/i }))
      .toBeVisible()
  })

  test('can switch between leaderboard types', async ({ page }) => {
    await page.getByRole('button', { name: /sessions/i }).click()
    await expect(page.getByRole('button', { name: /sessions/i })).toBeVisible()

    await page.getByRole('button', { name: /longest wear/i }).click()
    await expect(page.getByRole('button', { name: /longest wear/i }))
      .toBeVisible()

    await page.getByRole('button', { name: /longest streak/i }).click()
    await expect(page.getByRole('button', { name: /longest streak/i }))
      .toBeVisible()
  })
})
