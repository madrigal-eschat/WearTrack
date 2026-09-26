import { describe, it, expect } from 'vitest'
import { toLocalInput, fromLocalInput } from './datetimeLocal'

describe('toLocalInput', () => {
  it('formats a unix timestamp as local YYYY-MM-DDTHH:mm', () => {
    const ts = new Date(2025, 2, 10, 14, 5, 42).getTime() / 1000
    expect(toLocalInput(ts)).toBe('2025-03-10T14:05')
  })

  it('zero-pads single-digit fields', () => {
    const ts = new Date(2025, 0, 2, 3, 4).getTime() / 1000
    expect(toLocalInput(ts)).toBe('2025-01-02T03:04')
  })
})

describe('fromLocalInput', () => {
  it('parses a local datetime-local value to unix seconds', () => {
    const expected = new Date(2025, 2, 10, 14, 5).getTime() / 1000
    expect(fromLocalInput('2025-03-10T14:05')).toBe(expected)
  })

  it('round-trips a whole-minute timestamp', () => {
    const ts = new Date(2025, 6, 1, 23, 59).getTime() / 1000
    expect(fromLocalInput(toLocalInput(ts))).toBe(ts)
  })

  it('returns null for an empty or invalid value', () => {
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('nope')).toBeNull()
  })
})
