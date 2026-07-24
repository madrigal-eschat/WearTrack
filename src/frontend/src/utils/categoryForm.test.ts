import { describe, it, expect } from 'vitest'
import {
  categoryToFormState,
  formStateToApiPayload,
  multiplierToHalfLifeDays,
  halfLifeDaysToMultiplier,
} from './categoryForm.js'
import type { CategoryApiShape } from './categoryForm.js'

const BASE_CATEGORY: CategoryApiShape = {
  id: 1,
  name: 'Earrings',
  icon: '💎',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 2,
  minimum_rest: 86400,
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Medium', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
  type: 'duration',
  consecutive_wear_days: 1,
}

describe('multiplierToHalfLifeDays / halfLifeDaysToMultiplier', () => {
  it('round-trips a multiplier through half-life and back', () => {
    const halfLife = multiplierToHalfLifeDays(0.91)
    expect(halfLifeDaysToMultiplier(halfLife)).toBeCloseTo(0.91)
  })

  it('a half-life of 1 day means multiplier 0.5', () => {
    expect(halfLifeDaysToMultiplier(1)).toBeCloseTo(0.5)
  })
})

describe('categoryToFormState', () => {
  it('maps target/max/min-rest/grace/decay', () => {
    const s = categoryToFormState(BASE_CATEGORY)
    expect(s.initialWearTargetSeconds).toBe(900)
    expect(s.initialWearMaxSeconds).toBe(1800)
    expect(s.minimumRestSeconds).toBe(86400)
    expect(s.breakGraceSeconds).toBe(86400)
    expect(s.breakDecayHalfLifeDays).toBeCloseTo(7.35, 1)
    expect(s.restMultiplier).toBe(2)
  })

  it('preserves a null maximum', () => {
    const s = categoryToFormState({
      ...BASE_CATEGORY,
      initial_max_wear_duration_seconds: null,
    })
    expect(s.initialWearMaxSeconds).toBeNull()
  })

  it('derives bandCount and crossoverPoints', () => {
    const s = categoryToFormState(BASE_CATEGORY)
    expect(s.bandCount).toBe(3)
    expect(s.crossoverPoints).toEqual([3600, 7200])
  })
})

describe('formStateToApiPayload', () => {
  it('maps all fields to snake_case incl. null max', () => {
    const payload = formStateToApiPayload({
      name: 'Test', icon: '🎯',
      initialWearTargetSeconds: 1800, initialWearMaxSeconds: null,
      restMultiplier: 1.5, minimumRestSeconds: 1200,
      breakGraceSeconds: 3600,
      breakDecayHalfLifeDays: multiplierToHalfLifeDays(0.8),
      bandCount: 2, crossoverPoints: [3600],
      type: 'duration', consecutiveWearDays: 1,
    })
    expect(payload.initial_target_wear_duration_seconds).toBe(1800)
    expect(payload.initial_max_wear_duration_seconds).toBeNull()
    expect(payload.minimum_rest).toBe(1200)
    expect(payload.break_grace_time).toBe(3600)
    expect(payload.break_decay_multiplier).toBeCloseTo(0.8)
    expect(payload.rest_multiplier).toBe(1.5)
    expect(payload.risk_levels).toEqual([
      { lower: null, upper: 3600, text: 'Low', severity: 1 },
      { lower: 3600, upper: null, text: 'High', severity: 2 },
    ])
  })

  it('round-trips', () => {
    const payload = formStateToApiPayload(categoryToFormState(BASE_CATEGORY))
    expect(payload.initial_target_wear_duration_seconds).toBe(900)
    expect(payload.initial_max_wear_duration_seconds).toBe(1800)
    expect(payload.break_grace_time).toBe(86400)
    expect(payload.break_decay_multiplier).toBeCloseTo(0.91)
  })
})

describe('rotation category mapping', () => {
  it('categoryToFormState maps type and consecutive_wear_days', () => {
    const state = categoryToFormState({
      name: 'Socks', icon: 'sock',
      initial_target_wear_duration_seconds: 57600,
      initial_max_wear_duration_seconds: null,
      rest_multiplier: 2, minimum_rest: 0,
      break_decay_multiplier: 0.91, break_grace_time: 86400,
      risk_levels: [{ lower: null, upper: null, text: 'x', severity: 1 }],
      type: 'rotation',
      consecutive_wear_days: 2,
    })
    expect(state.type).toBe('rotation')
    expect(state.consecutiveWearDays).toBe(2)
  })

  it('formStateToApiPayload maps type and consecutiveWearDays back', () => {
    const payload = formStateToApiPayload({
      name: 'Socks', icon: 'sock',
      initialWearTargetSeconds: 57600, initialWearMaxSeconds: null,
      minimumRestSeconds: 0,
      breakGraceSeconds: 86400,
      breakDecayMultiplier: 0.91,
      restMultiplier: 2, bandCount: 1, crossoverPoints: [],
      type: 'rotation', consecutiveWearDays: 2,
    })
    expect(payload.type).toBe('rotation')
    expect(payload.consecutive_wear_days).toBe(2)
  })
})
