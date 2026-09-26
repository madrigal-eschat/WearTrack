import { describe, it, expect } from 'vitest'
import { formatDuration, shortDuration } from './formatDuration'

describe('formatDuration', () => {
  it('returns "0s" for zero or negative', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(-5)).toBe('0s')
  })

  it('returns seconds only when under a minute', () => {
    expect(formatDuration(45)).toBe('45s')
  })

  it('returns minutes and seconds when under an hour', () => {
    expect(formatDuration(125)).toBe('2m 5s')
  })

  it('returns hours and minutes when at least an hour', () => {
    expect(formatDuration(3723)).toBe('1h 2m')
  })

  it('returns days and hours when at least a day', () => {
    expect(formatDuration(86400)).toBe('1d 0h')
    expect(formatDuration(90000)).toBe('1d 1h')
    expect(formatDuration(604800)).toBe('7d 0h')
  })
})

describe('shortDuration', () => {
  it('returns "0m" for zero or negative', () => {
    expect(shortDuration(0)).toBe('0m')
    expect(shortDuration(-60)).toBe('0m')
  })

  it('returns minutes only when under an hour', () => {
    expect(shortDuration(125)).toBe('2m')
  })

  it('returns hours only when whole hours', () => {
    expect(shortDuration(3600)).toBe('1h')
    expect(shortDuration(7200)).toBe('2h')
  })

  it('returns hours and minutes when not a whole hour', () => {
    expect(shortDuration(3723)).toBe('1h 2m')
    expect(shortDuration(5400)).toBe('1h 30m')
    // Regression: 18300 s = 305 min = 5h 5m — must not display as "305m"
    expect(shortDuration(18300)).toBe('5h 5m')
  })

  it('returns days only when whole days', () => {
    expect(shortDuration(86400)).toBe('1d')
    expect(shortDuration(604800)).toBe('7d')
  })

  it('returns days and hours when not a whole day', () => {
    expect(shortDuration(90000)).toBe('1d 1h')
    expect(shortDuration(108000)).toBe('1d 6h')
  })
})
