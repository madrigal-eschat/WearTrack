// src/backend/tests/db/item-store.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import { itemStore } from '../../src/db/stores/item-store.js'
import { categoryStore } from '../../src/db/stores/category-store.js'

let categoryId: number
let category2Id: number

beforeAll(() => {
  runMigrations()
  const cat1 = categoryStore.create({
    name: 'Rings',
    icon: 'ring',
    initial_target_wear_duration_seconds: 3600,
    initial_max_wear_duration_seconds: 7200,
    rest_multiplier: 2,
    minimum_rest: 3600,
    risk_levels: [{ lower: null, upper: null, text: 'Only', severity: 1 }],
    break_decay_multiplier: 0.9,
    break_grace_time: 3600,
  })
  categoryId = cat1.id

  const cat2 = categoryStore.create({
    name: 'Earrings',
    icon: 'ear',
    initial_target_wear_duration_seconds: 1800,
    initial_max_wear_duration_seconds: null,
    rest_multiplier: 1,
    minimum_rest: 0,
    risk_levels: [{ lower: null, upper: null, text: 'Low', severity: 0 }],
    break_decay_multiplier: 0.5,
    break_grace_time: 0,
  })
  category2Id = cat2.id
})

describe('itemStore.create', () => {
  it('creates an item with default difficulty_multiplier of 1', () => {
    const item = itemStore.create({
      name: 'Gold Ring',
      category_id: categoryId,
      color: '#ffd700',
    })
    expect(item.id).toBeTypeOf('number')
    expect(item.name).toBe('Gold Ring')
    expect(item.category_id).toBe(categoryId)
    expect(item.color).toBe('#ffd700')
    expect(item.difficulty_multiplier).toBe(1)
  })

  it('creates an item with a custom difficulty_multiplier', () => {
    const item = itemStore.create({
      name: 'Heavy Ring',
      category_id: categoryId,
      color: '#888',
      difficulty_multiplier: 2.5,
    })
    expect(item.difficulty_multiplier).toBe(2.5)
  })
})

describe('itemStore.find', () => {
  it('returns the item for a valid id', () => {
    const created = itemStore.create({
      name: 'Silver Ring',
      category_id: categoryId,
      color: '#c0c0c0',
    })
    const found = itemStore.find(created.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe('Silver Ring')
  })

  it('returns undefined for a non-existent id', () => {
    expect(itemStore.find(99999)).toBeUndefined()
  })
})

describe('itemStore.findAll', () => {
  it('returns all items when no categoryId is given', () => {
    const all = itemStore.findAll()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('filters by categoryId when provided', () => {
    const studsInCat2 = itemStore.create({
      name: 'Diamond Stud',
      category_id: category2Id,
      color: '#fff',
    })
    const cat2Items = itemStore.findAll(category2Id)
    expect(cat2Items.every((i) => i.category_id === category2Id)).toBe(true)
    expect(cat2Items.find((i) => i.id === studsInCat2.id)).toBeDefined()
  })

  it('does not include items from other categories when filtering', () => {
    const cat1Items = itemStore.findAll(categoryId)
    expect(cat1Items.every((i) => i.category_id === categoryId)).toBe(true)
  })
})

describe('itemStore.update', () => {
  it('updates the name field', () => {
    const item = itemStore.create({
      name: 'Old Name',
      category_id: categoryId,
      color: '#aaa',
    })
    const updated = itemStore.update(item.id, { name: 'New Name' })
    expect(updated.name).toBe('New Name')
    expect(updated.color).toBe('#aaa') // unchanged
  })

  it('updates the color field', () => {
    const item = itemStore.create({
      name: 'Color Item',
      category_id: categoryId,
      color: '#000',
    })
    const updated = itemStore.update(item.id, { color: '#fff' })
    expect(updated.color).toBe('#fff')
  })

  it('updates difficulty_multiplier', () => {
    const item = itemStore.create({
      name: 'DM Item',
      category_id: categoryId,
      color: '#abc',
    })
    const updated = itemStore.update(item.id, { difficulty_multiplier: 3.0 })
    expect(updated.difficulty_multiplier).toBe(3.0)
  })
})

describe('itemStore.delete', () => {
  it('removes the item from the DB', () => {
    const item = itemStore.create({
      name: 'Temp Item',
      category_id: categoryId,
      color: '#fff',
    })
    expect(itemStore.find(item.id)).toBeDefined()
    itemStore.delete(item.id)
    expect(itemStore.find(item.id)).toBeUndefined()
  })
})
