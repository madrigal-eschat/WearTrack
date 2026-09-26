import { describe, it, expect } from 'vitest'
import { buildEditChanges } from './sessionEditChanges'

const original = { started_at: 1000, ended_at: 2000 }

describe('buildEditChanges', () => {
  it('returns nothing when neither time changed', () => {
    expect(buildEditChanges(original, 1000, 2000)).toEqual({})
  })

  it('returns only the start when only the start changed', () => {
    expect(buildEditChanges(original, 900, 2000)).toEqual({ started_at: 900 })
  })

  it('returns only the end when only the end changed', () => {
    expect(buildEditChanges(original, 1000, 2500)).toEqual({ ended_at: 2500 })
  })

  it('returns both when both changed', () => {
    expect(buildEditChanges(original, 900, 2500)).toEqual({
      started_at: 900,
      ended_at: 2500,
    })
  })
})
