import { describe, it, expect } from 'vitest'
import {
  slugify,
  buildSessionStartPayload,
  buildSessionEndPayload,
  buildRestStartPayload,
  buildRestEndPayload,
  buildDecayStartPayload,
  buildDecayFinishPayload,
} from '../../src/mqtt/events.js'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Winter Gloves')).toBe('winter-gloves')
  })
  it('strips non-alphanumeric characters', () => {
    expect(slugify("Cat's & Co.")).toBe('cat-s-co')
  })
  it('trims leading/trailing hyphens', () => {
    expect(slugify('--Test--')).toBe('test')
  })
})

const baseCtx = {
  category_id: 1,
  category_name: 'Footwear',
  item_id: 2,
  item_name: 'Test Shoe',
  difficulty_multiplier: 1.0,
  target_wear_seconds: 900,
  max_wear_seconds: 1800,
  timestamp: 1_700_000_000,
}

describe('buildSessionStartPayload', () => {
  it('includes common fields, session_id, and an ISO timestamp', () => {
    const payload = buildSessionStartPayload({ ...baseCtx, session_id: 42 })
    expect(payload).toMatchObject({
      event: 'session_start',
      category_id: 1,
      category_name: 'Footwear',
      item_id: 2,
      item_name: 'Test Shoe',
      difficulty_modifier: 1.0,
      target_wear_seconds: 900,
      max_wear_seconds: 1800,
      session_id: 42,
    })
    expect(payload.timestamp).toBe(
      new Date(1_700_000_000 * 1000).toISOString(),
    )
  })
})

describe('buildSessionEndPayload', () => {
  it('includes actual_duration_seconds, rest_seconds, risk_level', () => {
    const payload = buildSessionEndPayload({
      ...baseCtx,
      session_id: 42,
      actual_duration_seconds: 1000,
      rest_seconds: 6000,
      risk_level: 'moderate',
    })
    expect(payload).toMatchObject({
      event: 'session_end',
      session_id: 42,
      actual_duration_seconds: 1000,
      rest_seconds: 6000,
      risk_level: 'moderate',
    })
  })
})

describe('buildRestStartPayload / buildRestEndPayload', () => {
  it(
    'rest_start has rest_seconds and null item fields when the ' +
      'context has none',
    () => {
      const payload = buildRestStartPayload({
        ...baseCtx,
        item_id: null,
        item_name: null,
        difficulty_multiplier: null,
        rest_seconds: 6000,
      })
      expect(payload).toMatchObject({
        event: 'rest_start',
        rest_seconds: 6000,
        item_id: null,
        item_name: null,
      })
    },
  )

  it('rest_end has rest_seconds and elapsed_rest_seconds', () => {
    const payload = buildRestEndPayload({
      ...baseCtx,
      item_id: null,
      item_name: null,
      difficulty_multiplier: null,
      rest_seconds: 6000,
      elapsed_rest_seconds: 6000,
    })
    expect(payload).toMatchObject({
      event: 'rest_end',
      rest_seconds: 6000,
      elapsed_rest_seconds: 6000,
    })
  })
})

describe('buildDecayStartPayload / buildDecayFinishPayload', () => {
  it('decay_start has decay_state and an ISO decay_full_time', () => {
    const payload = buildDecayStartPayload({
      ...baseCtx,
      item_id: null,
      item_name: null,
      difficulty_multiplier: null,
      decay_state: 'decaying',
      decay_full_time: 1_700_100_000,
    })
    expect(payload.decay_state).toBe('decaying')
    expect(payload.decay_full_time).toBe(
      new Date(1_700_100_000 * 1000).toISOString(),
    )
  })

  it('decay_finish always reports fully_decayed and 100%', () => {
    const payload = buildDecayFinishPayload({
      ...baseCtx,
      item_id: null,
      item_name: null,
      difficulty_multiplier: null,
    })
    expect(payload.decay_state).toBe('fully_decayed')
    expect(payload.decay_percentage).toBe(100)
  })
})
