import {
  test, expect, type APIRequestContext, type Page,
} from '@playwright/test'
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
    // Whole minute, so it survives a round-trip through the minute-resolution
    // datetime-local inputs.
    startedAt = Math.floor(Date.now() / 60000) * 60 - 3600,
  ) {
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

  // Local "YYYY-MM-DDTHH:mm" in the browser's timezone (datetime-local).
  async function localInput(page: Page, ts: number) {
    return page.evaluate((seconds) => {
      const d = new Date(seconds * 1000)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
        + `T${p(d.getHours())}:${p(d.getMinutes())}`
    }, ts)
  }

  async function getSession(request: APIRequestContext, id: number) {
    const response = await request.get(`/api/sessions/${id}`)
    return await response.json() as { started_at: number; ended_at: number }
  }

  async function openEditDialog(page: Page, itemName: string) {
    await page.goto('/log')
    const row = page.locator('li').filter({ hasText: itemName }).first()
    const actions = row.getByRole('button', { name: 'Session actions' })
    await expect(actions).toBeVisible()
    await actions.click()

    const editButton = page.getByRole('button', { name: 'Edit' })
    await expect(editButton).toBeVisible()
    await editButton.click()

    await expect(page.getByText('Edit session', { exact: true })).toBeVisible()
    const inputs = page.locator('input[type="datetime-local"]')
    return {
      row,
      start: inputs.nth(0),
      end: inputs.nth(1),
      save: page.getByRole('button', { name: 'Save' }),
    }
  }

  test('can edit the end of a completed log entry', async ({
    page, request,
  }) => {
    const sessionId = await createSession(request, 600)
    const before = await getSession(request, sessionId)

    const { row, start, end, save } = await openEditDialog(page, itemName)
    await expect(start).toBeVisible()
    await expect(end).toBeVisible()
    await expect(page.getByText('Duration: 10m 0s')).toBeVisible()

    await end.fill(await localInput(page, before.started_at + 300))
    await expect(page.getByText('Duration: 5m 0s')).toBeVisible()
    await save.click()

    await expect.poll(async () => {
      const session = await getSession(request, sessionId)
      return session.ended_at - session.started_at
    }).toBe(300)
    await expect(row).toContainText('5m')
  })

  test('can edit the start of a completed log entry', async ({
    page, request,
  }) => {
    const sessionId = await createSession(request, 600)
    const before = await getSession(request, sessionId)

    const { start, save } = await openEditDialog(page, itemName)
    await start.fill(await localInput(page, before.started_at - 300))
    await expect(page.getByText('Duration: 15m 0s')).toBeVisible()
    await save.click()

    await expect.poll(async () => {
      const session = await getSession(request, sessionId)
      return [session.started_at, session.ended_at]
    }).toEqual([before.started_at - 300, before.ended_at])
  })

  test('blocks saving when the end is not after the start', async ({
    page, request,
  }) => {
    const sessionId = await createSession(request, 600)
    const before = await getSession(request, sessionId)

    const { end, save } = await openEditDialog(page, itemName)
    await end.fill(await localInput(page, before.started_at - 60))

    await expect(page.getByText('End must be after start')).toBeVisible()
    await expect(save).toBeDisabled()
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
