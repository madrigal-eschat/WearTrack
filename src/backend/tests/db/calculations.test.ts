import { describe, it, expect } from 'vitest';
import {
  restWeight,
  riskLevelFor,
  computeSessionStart,
  computeRest,
  type Category,
} from '../../src/db/calculations.js';

const cat: Category = {
  id: 1,
  name: 'Test',
  icon: 'x',
  initial_target_wear_duration_seconds: 900,
  initial_max_wear_duration_seconds: 1800,
  rest_multiplier: 2,
  minimum_rest: 86400,
  risk_levels: [
    { lower: null, upper: 3600, text: 'Low', severity: 1 },
    { lower: 3600, upper: 7200, text: 'Med', severity: 2 },
    { lower: 7200, upper: null, text: 'High', severity: 3 },
  ],
  break_decay_multiplier: 0.91,
  break_grace_time: 86400,
};
const item = { difficulty_multiplier: 1 };

describe('restWeight', () => {
  it('is 0 for a single band', () => expect(restWeight(0, 1)).toBe(0));
  it('runs 0..2 across bands', () => {
    expect(restWeight(0, 3)).toBe(0);
    expect(restWeight(1, 3)).toBe(1);
    expect(restWeight(2, 3)).toBe(2);
  });
});

describe('riskLevelFor', () => {
  it('finds the band for an elapsed time', () => {
    expect(riskLevelFor(1800, cat)?.text).toBe('Low');
    expect(riskLevelFor(5000, cat)?.text).toBe('Med');
    expect(riskLevelFor(9000, cat)?.text).toBe('High');
  });
  it('attaches rest_weight by position', () => {
    expect(riskLevelFor(1800, cat)?.rest_weight).toBe(0);
    expect(riskLevelFor(9000, cat)?.rest_weight).toBe(2);
  });
});

describe('computeSessionStart', () => {
  it('first session uses difficulty * initial', () => {
    expect(computeSessionStart(cat, item, null, 0, false)).toEqual({ target: 900, max: 1800 });
  });

  it('first session applies difficulty modifier (1/1.5)', () => {
    const r = computeSessionStart(cat, { difficulty_multiplier: 1.5 }, null, 0, false);
    expect(r.target).toBe(Math.floor(900 / 1.5));
    expect(r.max).toBe(Math.floor(1800 / 1.5));
  });

  it('after rest, grows by difficulty * (prev + initial)', () => {
    const prev = { target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 0, started_at: -100, rest_seconds: 100 };
    // earliest_start = 100; start at 200 (>= earliest, <= latest 100+86400)
    const r = computeSessionStart(cat, item, prev, 200, false);
    expect(r).toEqual({ target: 1800, max: 3600 });
  });

  it('inside rest period halves prev target/max', () => {
    // prev values high enough that halved result (1000, 2000) stays above initial (900, 1800)
    const prev = { target_wear_seconds: 2000, max_wear_seconds: 4000, ended_at: 0, started_at: -100, rest_seconds: 500 };
    const r = computeSessionStart(cat, item, prev, 100, false); // start < earliest_start(500)
    expect(r).toEqual({ target: 1000, max: 2000 });
  });

  it('past grace applies daily decay', () => {
    const prev = { target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 0, started_at: -100, rest_seconds: 0 };
    // latest_start = 0 + 0 + 86400. Start 2 days past latest_start => days_since_grace = 2
    const start = 86400 + 2 * 86400;
    const r = computeSessionStart(cat, item, prev, start, false);
    const grown = 900 + 900; // difficulty 1 * (prev.target + initial)
    expect(r.target).toBe(Math.floor(grown * 0.91 ** 2));
  });

  it('active injury halves the result', () => {
    const r = computeSessionStart(cat, item, null, 0, true);
    expect(r).toEqual({ target: 450, max: 900 });
  });

  it('null category max yields null max throughout', () => {
    const noMax = { ...cat, initial_max_wear_duration_seconds: null };
    expect(computeSessionStart(noMax, item, null, 0, false)).toEqual({ target: 900, max: null });
  });

  it('floors target and max at initial values when halving inside rest period would go below', () => {
    // prev target/max well below initial (e.g. after heavy decay or repeated halving)
    const prev = { target_wear_seconds: 100, max_wear_seconds: 200, ended_at: 0, started_at: -100, rest_seconds: 500 };
    // start inside rest period → halved: target=50, max=100 — both below initial (900/1800)
    const r = computeSessionStart(cat, item, prev, 100, false);
    expect(r.target).toBe(900);
    expect(r.max).toBe(1800);
  });
});

describe('computeRest', () => {
  it('elapsed * (1 + rest_weight) * rest_multiplier, floored to minimum_rest', () => {
    // Low band (weight 0): 1800 * 1 * 2 = 3600, floored to 86400
    expect(computeRest(1800, 1800, cat, riskLevelFor(1800, cat), false)).toBe(86400);
  });

  it('high band raises the multiplier', () => {
    // High band weight 2: 9000 * 3 * 2 = 54000, still floored to 86400
    expect(computeRest(9000, 18000, cat, riskLevelFor(9000, cat), false)).toBe(86400);
  });

  it('adds 2x penalty for time over max', () => {
    // elapsed 100000 over max 1800: base = 100000*3*2=600000 (high band), +(100000-1800)*2
    const rest = computeRest(100000, 1800, cat, riskLevelFor(100000, cat), false);
    expect(rest).toBe(600000 + (100000 - 1800) * 2);
  });

  it('no minimum-rest floor when max is null', () => {
    const noMax = { ...cat, initial_max_wear_duration_seconds: null };
    // 10 * (1+0) * 2 = 20, no floor applied
    expect(computeRest(10, null, noMax, riskLevelFor(10, noMax), false)).toBe(20);
  });

  it('multiplies by 1.5 when injured', () => {
    expect(computeRest(1800, 1800, cat, riskLevelFor(1800, cat), true)).toBe(Math.floor(86400 * 1.5));
  });
});
