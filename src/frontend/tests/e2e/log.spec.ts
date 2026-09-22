import { test, expect, type APIRequestContext } from '@playwright/test'
import { uid } from './helpers.js'

test.describe('Log session actions', () => {
  let categoryId: number
  let itemId: number
  let categoryName: string
  let itemName: string

  test.beforeAll(async ({ request }) => {
    categoryName = `LogCat-${uid()}`
    itemName = `LogItem-${uid()}`

    const categoryResponse = await request.post('/api/categories', {
      data: {
        name: categoryName,
        icon: '🧪',
        initial_target_wear_duration_seconds: 600,
        initial_max_wear_duration_seconds: 1800,
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
    })
    categoryId = (await categoryResponse.json()).id

    const itemResponse = await request.post('/api/items', {
      data: { name: itemName, color: '#3b82f6', category_id: categoryId },
    })
    itemId = (await itemResponse.json()).id
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/categories/${categoryId}`)
  })

  async function createSession(
    request: APIRequestContext,
    durationSeconds: number,
  ) {
    const startedAt = Math.floor(Date.now() / 1000) - 3600
    const startResponse = await request.post('/api/sessions/start', {
      data: { item_id: itemId, started_at: startedAt },
    })
    const session = await startResponse.json()
    await request.post(`/api/sessions/${session.id}/end`, {
      data: { ended_at: startedAt + durationSeconds },
    })
    return session.id as number
  }

  test.afterEach(async ({ request }) => {
    const response = await request.get(
      `/api/sessions?category_id=${categoryId}`,
    )
    const sessions = await response.json() as Array<{ id: number }>
    for (const session of sessions) {
      await request.delete(`/api/sessions/${session.id}`)
    }
  })

  test('can edit a completed log entry', async ({ page, request }) => {
    const sessionId = await createSession(request, 600)

    await page.goto('/log')
    const row = page.locator('li').filter({ hasText: itemName }).first()
    const actions = row.getByRole('button', { name: 'Session actions' })
    await expect(actions).toBeVisible()
    await actions.click()

    const editButton = page.getByRole('button', { name: 'Edit' })
    await expect(editButton).toBeVisible()
    await editButton.click()

    const title = page.getByText('Edit session', { exact: true })
    await expect(title).toBeVisible()
    const duration = page.locator('input[type="number"]')
    await expect(duration).toBeVisible()
    await duration.fill('5')
    const saveButton = page.getByRole('button', { name: 'Save' })
    await expect(saveButton).toBeVisible()
    await saveButton.click()

    await expect.poll(async () => {
      const response = await request.get(`/api/sessions/${sessionId}`)
      const session = await response.json()
      return session.ended_at - session.started_at
    }).toBe(300)
    await expect(row).toContainText('5m')
  })

  test('can delete a completed log entry', async ({ page, request }) => {
    await createSession(request, 600)

    await page.goto('/log')
    const row = page.locator('li').filter({ hasText: itemName }).first()
    const actions = row.getByRole('button', { name: 'Session actions' })
    await expect(actions).toBeVisible()
    await actions.click()

    const deleteButton = page.getByRole('button', { name: 'Delete' }).first()
    await expect(deleteButton).toBeVisible()
    await deleteButton.click()

    const title = page.getByText('Delete session?', { exact: true })
    await expect(title).toBeVisible()
    const confirm = page.getByTestId('delete-confirm')
    await expect(confirm).toBeVisible()
    await confirm.click()

    await expect(row).not.toBeVisible()
  })
})
