import { describe, it, expect, beforeAll } from 'vitest'
import { runMigrations } from '../../src/db/migrations/index.js'
import {
  CreateCategoryCommand,
  UpdateCategoryCommand,
} from '../../src/commands/categories.js'
import { ValidationError } from '../../src/middleware/errors.js'

const validBody = {
  name: 'Rings',
  icon: 'ring',
  initial_target_wear_duration_seconds: 3600,
  initial_max_wear_duration_seconds: 7200,
  rest_multiplier: 2,
  minimum_rest: 1800,
  risk_levels: [{ lower: null, upper: null, text: 'Default', severity: 1 }],
  break_decay_multiplier: 0.9,
  break_grace_time: 3600,
}

beforeAll(() => {
  runMigrations()
})

describe('CreateCategoryCommand', () => {
  it('creates a category from a valid body', () => {
    const category = new CreateCategoryCommand({
      ...validBody,
      name: 'Command Test 1',
    }).run()
    expect(category.id).toBeTypeOf('number')
    expect(category.name).toBe('Command Test 1')
    expect(category.type).toBe('duration')
    expect(category.consecutive_wear_days).toBe(1)
  })

  it('throws ValidationError when name is missing', () => {
    expect(() =>
      new CreateCategoryCommand({ ...validBody, name: undefined }).run(),
    ).toThrow(ValidationError)
  })

  it('throws ValidationError when risk_levels is invalid', () => {
    expect(() =>
      new CreateCategoryCommand({ ...validBody, risk_levels: 'nope' }).run(),
    ).toThrow(ValidationError)
  })

  it('throws ValidationError when type is invalid', () => {
    expect(() =>
      new CreateCategoryCommand({ ...validBody, type: 'bogus' }).run(),
    ).toThrow(ValidationError)
  })

  it('accepts an explicit rotation type and consecutive_wear_days', () => {
    const category = new CreateCategoryCommand({
      ...validBody,
      name: 'Command Test Rotation',
      type: 'rotation',
      consecutive_wear_days: 3,
    }).run()
    expect(category.type).toBe('rotation')
    expect(category.consecutive_wear_days).toBe(3)
  })
})

describe('UpdateCategoryCommand', () => {
  it('applies only the fields present in the body', () => {
    const existing = new CreateCategoryCommand({
      ...validBody,
      name: 'Command Test 2',
    }).run()
    const updated = new UpdateCategoryCommand(existing, {
      name: 'Renamed',
    }).run()
    expect(updated.name).toBe('Renamed')
    expect(updated.icon).toBe(existing.icon)
  })

  it(
    'returns the existing category unchanged when the body has no ' +
      'recognised fields',
    () => {
      const existing = new CreateCategoryCommand({
        ...validBody,
        name: 'Command Test 3',
      }).run()
      const updated = new UpdateCategoryCommand(existing, {}).run()
      expect(updated).toEqual(existing)
    },
  )

  it('throws ValidationError when a present field is the wrong type', () => {
    const existing = new CreateCategoryCommand({
      ...validBody,
      name: 'Command Test 4',
    }).run()
    expect(() =>
      new UpdateCategoryCommand(existing, { rest_multiplier: 'nope' }).run(),
    ).toThrow(ValidationError)
  })
})
