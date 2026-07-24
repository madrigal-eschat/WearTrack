import { Hono } from 'hono'
import { itemStore } from '../db/stores/item-store.js'
import { categoryStore } from '../db/stores/category-store.js'
import { statsStore } from '../db/stores/stats-store.js'
import { NotFoundError, ValidationError } from '../middleware/errors.js'

export const router = new Hono()

// Helper validation functions for PATCH /:id
function validateName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('name must be a string')
  }
  return value
}

function validateCategoryId(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ValidationError('category_id must be a number')
  }
  if (!categoryStore.find(value)) {
    throw new ValidationError(`Category ${value} does not exist`)
  }
  return value
}

function validateColor(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('color must be a string')
  }
  return value
}

function validateDifficultyMultiplier(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ValidationError('difficulty_multiplier must be a number')
  }
  return value
}

function buildUpdates(
  body: Record<string, unknown>,
): Parameters<typeof itemStore.update>[1] {
  const updates: Parameters<typeof itemStore.update>[1] = {}
  if ('name' in body) {
    updates.name = validateName(body.name)
  }
  if ('category_id' in body) {
    updates.category_id = validateCategoryId(body.category_id)
  }
  if ('color' in body) {
    updates.color = validateColor(body.color)
  }
  if ('difficulty_multiplier' in body) {
    updates.difficulty_multiplier = validateDifficultyMultiplier(
      body.difficulty_multiplier,
    )
  }
  return updates
}

// GET /api/items
router.get('/', (c) => {
  const categoryId = c.req.query('category_id')
  return c.json(
    itemStore.findAll(
      categoryId !== undefined ? Number(categoryId) : undefined,
    ),
  )
})

// GET /api/items/:id/stats/history — must be before /:id/stats and /:id to
// avoid shadowing
router.get('/:id/stats/history', (c) => {
  const id = Number(c.req.param('id'))
  if (!itemStore.find(id)) {
    throw new NotFoundError(`Item ${id} not found`)
  }

  const unit = c.req.query('unit') ?? 'month'
  if (unit !== 'month' && unit !== 'week') {
    throw new ValidationError('unit must be "month" or "week"')
  }

  return c.json(statsStore.history(id, unit))
})

// GET /api/items/:id/stats — must be before /:id to avoid shadowing
router.get('/:id/stats', (c) => {
  const id = Number(c.req.param('id'))
  if (!itemStore.find(id)) {
    throw new NotFoundError(`Item ${id} not found`)
  }

  const stats = statsStore.findForItem(id)
  return c.json(
    stats ?? {
      item_id: id,
      total_wear_seconds: 0,
      session_count: 0,
      max_single_session_wear_seconds: 0,
    },
  )
})

// GET /api/items/:id
router.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const item = itemStore.find(id)
  if (!item) {
    throw new NotFoundError(`Item ${id} not found`)
  }
  return c.json(item)
})

// POST /api/items
router.post('/', async (c) => {
  const body = await c.req.json()
  const { name, category_id, color, difficulty_multiplier } = body

  if (!name || typeof name !== 'string') {
    throw new ValidationError('name is required')
  }
  if (typeof category_id !== 'number') {
    throw new ValidationError('category_id must be a number')
  }
  if (!color || typeof color !== 'string') {
    throw new ValidationError('color is required')
  }

  if (!categoryStore.find(category_id)) {
    throw new ValidationError(`Category ${category_id} does not exist`)
  }

  // itemStore.create() also initialises the stats row for this item
  const item = itemStore.create({
    name,
    category_id,
    color,
    difficulty_multiplier:
      typeof difficulty_multiplier === 'number'
        ? difficulty_multiplier
        : undefined,
  })

  return c.json(item, 201)
})

// PATCH /api/items/:id
router.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = itemStore.find(id)
  if (!existing) {
    throw new NotFoundError(`Item ${id} not found`)
  }

  const body = await c.req.json()
  const updates = buildUpdates(body)

  if (Object.keys(updates).length === 0) {
    return c.json(existing)
  }

  return c.json(itemStore.update(id, updates))
})

// DELETE /api/items/:id
router.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const existing = itemStore.find(id)
  if (!existing) {
    throw new NotFoundError(`Item ${id} not found`)
  }
  itemStore.delete(id)
  return c.body(null, 204)
})
