import { Hono } from 'hono'
import { sessionStore, type Session } from '../db/stores/session-store.js'
import { itemStore } from '../db/stores/item-store.js'
import { categoryStore } from '../db/stores/category-store.js'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../middleware/errors.js'
import { nowSeconds } from '../utils/time.js'
import { StartSessionCommand } from '../commands/sessions.js'
import { CurrentSessionsQuery } from '../queries/sessions.js'

export const router = new Hono()

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

  const body = (await c.req.json().catch(() => ({}))) as { ended_at?: number }
  if (body.ended_at !== undefined && typeof body.ended_at !== 'number') {
    throw new ValidationError('ended_at must be a Unix timestamp (number)')
  }

  const item = itemStore.find(session.item_id)
  if (!item) {
    throw new NotFoundError(`Item ${session.item_id} not found`)
  }

  const category = categoryStore.findRaw(item.category_id)!
  const endTs =
    typeof body.ended_at === 'number' ? body.ended_at : nowSeconds()

  const updated = sessionStore.end(session, category, endTs)
  return c.json(updated)
})

interface EditBody {
  started_at?: number;
  ended_at?: number;
  duration_seconds?: number;
}

function resolveEditedTimes(
  session: Session & { ended_at: number },
  body: EditBody,
): { startedAt: number; endedAt: number } {
  if (body.started_at !== undefined && typeof body.started_at !== 'number') {
    throw new ValidationError('started_at must be a Unix timestamp (number)')
  }
  const startedAt = body.started_at ?? session.started_at

  let endedAt: number
  if (typeof body.ended_at === 'number') {
    endedAt = body.ended_at
  } else if (typeof body.duration_seconds === 'number') {
    endedAt = startedAt + body.duration_seconds
  } else if (body.started_at !== undefined) {
    endedAt = session.ended_at
  } else {
    throw new ValidationError(
      'started_at, ended_at or duration_seconds (number) is required',
    )
  }
  if (endedAt <= startedAt) {
    throw new ValidationError('ended_at must be after started_at')
  }
  return { startedAt, endedAt }
}

// Only the newly covered time can introduce a collision; shrinking is
// always allowed, and pre-existing overlaps don't block unrelated edits.
function assertNoNewOverlap(
  session: Session & { ended_at: number },
  categoryId: number,
  startedAt: number,
  endedAt: number,
): void {
  const added: [number, number][] = [
    [startedAt, Math.min(endedAt, session.started_at)],
    [Math.max(startedAt, session.ended_at), endedAt],
  ]
  for (const [from, to] of added) {
    if (from >= to) {
      continue
    }
    const clash = sessionStore.findOverlappingInCategory(
      categoryId,
      session.id,
      from,
      to,
    )
    if (clash) {
      throw new ConflictError(
        `Overlaps a session on item "${clash.item_name}" ` +
          `(id ${clash.item_id}) in this category`,
        {
          conflicting_session: {
            id: clash.session_id,
            item: { id: clash.item_id, name: clash.item_name },
          },
        },
      )
    }
  }
}

// PATCH /api/sessions/:id — correct a completed session's start and/or end
// time (or its duration, keeping the start fixed)
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const session = sessionStore.find(id)
  if (!session) {
    throw new NotFoundError(`Session ${id} not found`)
  }
  if (session.ended_at === null) {
    throw new ValidationError(`Session ${id} has not ended yet`)
  }
  const ended = { ...session, ended_at: session.ended_at }

  const body = (await c.req.json().catch(() => ({}))) as EditBody
  const { startedAt, endedAt } = resolveEditedTimes(ended, body)

  const item = itemStore.find(session.item_id)
  if (!item) {
    throw new NotFoundError(`Item ${session.item_id} not found`)
  }
  const category = categoryStore.findRaw(item.category_id)!
  assertNoNewOverlap(ended, category.id, startedAt, endedAt)

  const updated = sessionStore.updateTimes(
    session,
    category,
    startedAt,
    endedAt,
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
