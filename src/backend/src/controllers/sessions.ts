import { Hono } from 'hono'
import { sessionStore } from '../db/stores/session-store.js'
import { itemStore } from '../db/stores/item-store.js'
import { categoryStore } from '../db/stores/category-store.js'
import { NotFoundError, ValidationError } from '../middleware/errors.js'
import { nowSeconds } from '../utils/time.js'
import { StartSessionCommand } from '../commands/sessions.js'
import { CurrentSessionsQuery } from '../queries/sessions.js'

export const router = new Hono()

function parseEndTimingBody(raw: unknown): {
  startedAt?: number;
  endedAt?: number;
} {
  const body = raw as { started_at?: number; ended_at?: number }
  if (body.started_at !== undefined && typeof body.started_at !== 'number') {
    throw new ValidationError('started_at must be a Unix timestamp (number)')
  }
  if (body.ended_at !== undefined && typeof body.ended_at !== 'number') {
    throw new ValidationError('ended_at must be a Unix timestamp (number)')
  }
  return { startedAt: body.started_at, endedAt: body.ended_at }
}

// GET /api/sessions?item_id=&category_id=&before=&limit=
router.get('/', (c) => {
  const itemId = c.req.query('item_id')
  const categoryId = c.req.query('category_id')
  const before = c.req.query('before')
  const limit = c.req.query('limit')
  return c.json(
    sessionStore.findAll({
      itemId: itemId !== undefined ? Number(itemId) : undefined,
      categoryId: categoryId !== undefined ? Number(categoryId) : undefined,
      before: before !== undefined ? Number(before) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    }),
  )
})

// GET /api/sessions/current — one entry per category with active session
// or nulls
router.get('/current', (c) => {
  return c.json(new CurrentSessionsQuery().run())
})

// GET /api/sessions/dates?item_id=&category_id= — distinct days with
// completed sessions, for the Log jump index
router.get('/dates', (c) => {
  const categoryId = c.req.query('category_id')
  const itemId = c.req.query('item_id')
  return c.json(
    sessionStore.dates(
      categoryId !== undefined ? Number(categoryId) : undefined,
      itemId !== undefined ? Number(itemId) : undefined,
    ),
  )
})

// GET /api/sessions/:id
router.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const session = sessionStore.find(id)
  if (!session) {
    throw new NotFoundError(`Session ${id} not found`)
  }
  return c.json(session)
})

// POST /api/sessions/start — begin a new session for an item
router.post('/start', async (c) => {
  const body = await c.req.json()
  const session = new StartSessionCommand(body).run()
  return c.json(session, 201)
})

// POST /api/sessions/:id/end — finish a session and compute wear/rest
router.post('/:id/end', async (c) => {
  const id = Number(c.req.param('id'))
  const session = sessionStore.find(id)
  if (!session) {
    throw new NotFoundError(`Session ${id} not found`)
  }
  if (session.ended_at !== null) {
    throw new ValidationError(`Session ${id} is already ended`)
  }

  const { startedAt, endedAt } = parseEndTimingBody(
    await c.req.json().catch(() => ({})),
  )

  const item = itemStore.find(session.item_id)
  if (!item) {
    throw new NotFoundError(`Item ${session.item_id} not found`)
  }

  const category = categoryStore.findRaw(item.category_id)!
  const startTs = startedAt ?? session.started_at
  const endTs = endedAt ?? nowSeconds()

  if (endTs < startTs) {
    throw new ValidationError('ended_at must be after started_at')
  }

  const updated = sessionStore.end(session, category, endTs, startTs)
  return c.json(updated)
})

// PATCH /api/sessions/:id — correct a completed session's end time or duration
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const session = sessionStore.find(id)
  if (!session) {
    throw new NotFoundError(`Session ${id} not found`)
  }
  if (session.ended_at === null) {
    throw new ValidationError(`Session ${id} has not ended yet`)
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    started_at?: number;
    ended_at?: number;
    duration_seconds?: number;
  }

  const newStartedAt =
    typeof body.started_at === 'number' ? body.started_at : session.started_at

  let newEndedAt: number
  if (typeof body.ended_at === 'number') {
    newEndedAt = body.ended_at
  } else if (typeof body.duration_seconds === 'number') {
    newEndedAt = newStartedAt + body.duration_seconds
  } else {
    throw new ValidationError(
      'ended_at or duration_seconds (number) is required',
    )
  }
  if (newEndedAt <= newStartedAt) {
    throw new ValidationError('ended_at must be after started_at')
  }

  const item = itemStore.find(session.item_id)
  if (!item) {
    throw new NotFoundError(`Item ${session.item_id} not found`)
  }
  const category = categoryStore.findRaw(item.category_id)!

  const updated = sessionStore.updateEnd(
    session,
    category,
    newStartedAt,
    newEndedAt,
  )
  return c.json(updated)
})

// DELETE /api/sessions/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const session = sessionStore.find(id)
  if (!session) {
    throw new NotFoundError(`Session ${id} not found`)
  }

  const item = itemStore.find(session.item_id)
  if (!item) {
    throw new NotFoundError(`Item ${session.item_id} not found`)
  }
  const category = categoryStore.findRaw(item.category_id)!

  sessionStore.remove(session, category)
  return c.body(null, 204)
})
