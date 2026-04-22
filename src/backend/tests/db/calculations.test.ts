import { describe, it, expect } from 'vitest';
import {
  calculateRest,
  getRiskLevel,
  calculateBreakDecay,
  calculatePostBreakWear,
  type Category,
} from '../../src/db/calculations.js';

const mockCategory: Category = {
  id: 1,
  name: 'Test',
  icon: 'figure.walk',
  initial_wear: 900,
  rest_multiplier: 6,
  rest_constant: 86400,
  risk_levels: JSON.stringify([
    { lower: null, upper: 14400, text: 'safe', severity: 1 },
    { lower: 14400, upper: 28800, text: 'moderate', severity: 2 },
    { lower: 28800, upper: null, text: 'high', severity: 3 },
  ]),
  break_decay_multiplier: 0.75,
  break_penalty_period: 168, // 1 week in hours
};

describe('calculateRest', () => {
  it('returns rest_multiplier * wear + rest_constant', () => {
    // 1 hour wear: 6 * 3600 + 86400 = 108000
    expect(calculateRest(3600, mockCategory)).toBe(108000);
  });

  it('applies 1.5× multiplier when injury is active', () => {
    expect(calculateRest(3600, mockCategory, true)).toBe(Math.floor(108000 * 1.5));
  });
});

describe('getRiskLevel', () => {
  it('returns safe for wear below first threshold', () => {
    const level = getRiskLevel(7200, mockCategory); // 2h, below 4h
    expect(level?.text).toBe('safe');
    expect(level?.severity).toBe(1);
  });

  it('returns moderate for wear in 4-8h band', () => {
    const level = getRiskLevel(18000, mockCategory); // 5h
    expect(level?.text).toBe('moderate');
    expect(level?.severity).toBe(2);
  });

  it('returns high for wear above 8h', () => {
    const level = getRiskLevel(36000, mockCategory); // 10h
    expect(level?.text).toBe('high');
    expect(level?.severity).toBe(3);
  });
});

describe('calculateBreakDecay', () => {
  it('returns 1.0 for zero break', () => {
    expect(calculateBreakDecay(0, mockCategory)).toBe(1);
  });

  it('returns break_decay_multiplier after one full penalty period', () => {
    expect(calculateBreakDecay(168, mockCategory)).toBeCloseTo(0.75);
  });
});

describe('calculatePostBreakWear', () => {
  it('reduces wear by decay factor', () => {
    const result = calculatePostBreakWear(10000, 168, mockCategory);
    expect(result).toBe(Math.floor(10000 * 0.75));
  });

  it('never returns negative', () => {
    expect(calculatePostBreakWear(0, 9999, mockCategory)).toBe(0);
  });
});
