import { describe, it, expect } from 'vitest';
import { clampNumber } from './clampNumber.js';

describe('clampNumber', () => {
  it('returns default for empty string', () => {
    expect(clampNumber('', { default: 2 })).toBe(2);
  });

  it('returns default for NaN input', () => {
    expect(clampNumber('abc', { default: 2 })).toBe(2);
  });

  it('clamps below min up to min', () => {
    expect(clampNumber('-5', { min: 0, default: 2 })).toBe(0);
  });

  it('clamps above max down to max', () => {
    expect(clampNumber('5', { max: 0.99, default: 0.91 })).toBe(0.99);
  });

  it('passes through in-range values unchanged', () => {
    expect(clampNumber('0.5', { min: 0, max: 0.99, default: 0.91 })).toBe(0.5);
  });

  it('passes through when no min/max given', () => {
    expect(clampNumber('7', { default: 1 })).toBe(7);
  });
});
