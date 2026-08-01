import { Hono } from 'hono'
import { reminderScheduleStore } from
  '../db/stores/reminder-schedule-store.js'
import { categoryStore } from '../db/stores/category-store.js'
import { NotFoundError, ValidationError } from '../middleware/errors.js'

export const router = new Hono()

// GET /api/reminder-schedules?category_id=X
router.get('/', (c) => {
  const categoryId = c.req.query('category_id')
  if (categoryId === undefined) {
    throw new ValidationError('category_id query param is required')
  }
  return c.json(
    reminderScheduleStore.findAllForCategory(Number(categoryId)),
  )
})

// POST /api/reminder-schedules
router.post('/', async (c) => {
  const body = await c.req.json()
  const { category_id, remind_each_seconds, text } = body

  if (typeof category_id !== 'number') {
    throw new ValidationError('category_id must be a number')
  }
  if (!categoryStore.find(category_id)) {
    throw new ValidationError(`Category ${category_id} does not exist`)
  }
  if (typeof remind_each_seconds !== 'number' || remind_each_seconds < 60) {
    throw new ValidationError('remind_each_seconds must be a number >= 60')
  }
  if (!text || typeof text !== 'string') {
    throw new ValidationError('text is required')
  }

  const schedule = reminderScheduleStore.create({
    category_id,
    remind_each_seconds,
    text,
  })
  return c.json(schedule, 201)
})

// PATCH /api/reminder-schedules/:id
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = reminderScheduleStore.find(id)
  if (!existing) {
    throw new NotFoundError(`Reminder schedule ${id} not found`)
  }

  const body = await c.req.json()
  const updates: { remind_each_seconds?: number; text?: string } = {}
  if ('remind_each_seconds' in body) {
    if (
      typeof body.remind_each_seconds !== 'number' ||
      body.remind_each_seconds < 60
    ) {
      throw new ValidationError('remind_each_seconds must be a number >= 60')
    }
    updates.remind_each_seconds = body.remind_each_seconds
  }
  if ('text' in body) {
    if (!body.text || typeof body.text !== 'string') {
      throw new ValidationError('text must be a non-empty string')
    }
    updates.text = body.text
  }

  if (Object.keys(updates).length === 0) {
    return c.json(existing)
  }

  return c.json(reminderScheduleStore.update(id, updates))
})

// DELETE /api/reminder-schedules/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const existing = reminderScheduleStore.find(id)
  if (!existing) {
    throw new NotFoundError(`Reminder schedule ${id} not found`)
  }
  reminderScheduleStore.delete(id)
  return c.body(null, 204)
})
