import { describe, it, expect } from 'vitest';
import {
  restWeight,
  riskLevelFor,
  computeSessionStart,
  computeRest,
  computeDecay,
  lapCount,
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

  it('past grace applies floored daily decay', () => {
    const prev = { target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 0, started_at: -100, rest_seconds: 0 };
    // latest_start = 0 + 0 + 86400. Start 2 days past latest_start => days_since_grace = 2
    const start = 86400 + 2 * 86400;
    const r = computeSessionStart(cat, item, prev, start, false);
    // grown target=1800, max=3600 (dm=1 * (prev + initial)). Each day's loss is
    // floored at initial (900/1800), so both reach the floor on day 1 already:
    // day1: target loss = max(0.09*1800, 900) = 900 -> target 900
    // day1: max loss    = max(0.09*3600, 1800) = 1800 -> max 1800
    expect(r.target).toBe(900);
    expect(r.max).toBe(1800);
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

describe('computeSessionStart — floored break decay reaches floor in bounded days', () => {
  const noMaxCat: Category = { ...cat, initial_max_wear_duration_seconds: null };

  it('matches the day-by-day worked example (5000 -> 900 over 5 days)', () => {
    const prev = { target_wear_seconds: 4100, max_wear_seconds: null, ended_at: 0, started_at: -100, rest_seconds: 0 };
    const start = 86400 + 5 * 86400; // 5 days past grace
    const r = computeSessionStart(noMaxCat, item, prev, start, false);
    // grown target = 1 * (4100 + 900) = 5000
    // day1: loss=max(450,900)=900 -> 4100
    // day2: loss=max(369,900)=900 -> 3200
    // day3: loss=max(288,900)=900 -> 2300
    // day4: loss=max(207,900)=900 -> 1400
    // day5: loss=max(126,900)=900 -> 900 (floor)
    expect(r.target).toBe(900);
  });

  it('never overshoots below the floor for very long gaps', () => {
    const prev = { target_wear_seconds: 4100, max_wear_seconds: null, ended_at: 0, started_at: -100, rest_seconds: 0 };
    const start = 86400 + 1000 * 86400; // 1000 days past grace
    const r = computeSessionStart(noMaxCat, item, prev, start, false);
    expect(r.target).toBe(900);
  });

  it('applies the same floored decay to max independently, for categories with a maximum', () => {
    const prev = { target_wear_seconds: 4100, max_wear_seconds: 8200, ended_at: 0, started_at: -100, rest_seconds: 0 };
    const start = 86400 + 5 * 86400;
    const r = computeSessionStart(cat, item, prev, start, false);
    // grown target = 4100+900 = 5000 -> floors to 900 by day 5 (see worked example above)
    // grown max = 8200+1800 = 10000 -> day1:8200 day2:6400 day3:4600 day4:2800 day5: floor 1800
    expect(r.target).toBe(900);
    expect(r.max).toBe(1800);
  });
});

describe('lapCount', () => {
  it('floors elapsed/target', () => {
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 350, started_at: 0, rest_seconds: 0 };
    expect(lapCount(prev)).toBe(3);
  });

  it('is 0 when elapsed is less than one target', () => {
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 50, started_at: 0, rest_seconds: 0 };
    expect(lapCount(prev)).toBe(0);
  });
});

describe('computeSessionStart — lap carry-over (null-max categories only)', () => {
  const noMaxCat: Category = { ...cat, initial_max_wear_duration_seconds: null, initial_target_wear_duration_seconds: 50 };

  it('adds floor(lapCount/2) * previous.target on the normal-growth branch', () => {
    // previous session: target 100, elapsed 350 (1000 - 650) => lapCount = 3, floor(3/2) = 1
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 1000, started_at: 650, rest_seconds: 0 };
    // earliest_start = 1000; start at 1000 (>= earliest, <= latest 1000+86400) => normal-growth branch
    const r = computeSessionStart(noMaxCat, item, prev, 1000, false);
    // target = 1 * (100 + 50 + 1*100) = 250
    expect(r).toEqual({ target: 250, max: null });
  });

  it('adds the same carry-over on the early-restart branch, scaled by difficulty/2', () => {
    // previous session: target 100, elapsed 450 (1000 - 550) => lapCount = 4, floor(4/2) = 2
    const prev = { target_wear_seconds: 100, max_wear_seconds: null, ended_at: 1000, started_at: 550, rest_seconds: 500 };
    // earliest_start = 1500; start at 1000 (< earliest_start) => early-restart branch
    const r = computeSessionStart(noMaxCat, item, prev, 1000, false);
    // target = (1/2) * (100 + 2*100) = 150
    expect(r).toEqual({ target: 150, max: null });
  });

  it('never applies a lap carry-over to max-set categories', () => {
    // same shape as the normal-growth test above, but on `cat` (max is set)
    const prev = { target_wear_seconds: 100, max_wear_seconds: 1800, ended_at: 1000, started_at: 650, rest_seconds: 0 };
    const r = computeSessionStart(cat, item, prev, 1000, false);
    // unaffected by lapCount(=3) despite elapsed(350) > target(100) — `cat` has a max set
    expect(r).toEqual({ target: 1000, max: 3600 });
  });
});

describe('computeSessionStart — difficulty modifier now applied on the early-restart branch', () => {
  it('scales the halved target by the item difficulty modifier (bug fix)', () => {
    const prev = { target_wear_seconds: 2000, max_wear_seconds: 4000, ended_at: 0, started_at: -100, rest_seconds: 500 };
    const hardItem = { difficulty_multiplier: 2 }; // dm = 1/2 = 0.5
    const r = computeSessionStart(cat, hardItem, prev, 100, false); // start(100) < earliest_start(500)
    // target = (dm/2) * (2000 + 0) = 500
    expect(r.target).toBe(500);
    // max is untouched by this fix: previous.max/2 = 2000 (no difficulty modifier applied to max)
    expect(r.max).toBe(2000);
  });
});

describe('computeDecay', () => {
  const decayCat = { break_grace_time: 100, break_decay_multiplier: 0.91, initial_target_wear_duration_seconds: 900 };

  it('returns none/null when there is no previous session', () => {
    expect(computeDecay(null, decayCat, 10000)).toEqual({
      decay_start_time: null,
      decay_state: 'none',
      decay_full_time: null,
    });
  });

  it('computes decay_start_time and decay_full_time from the previous session', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 900 };
    const r = computeDecay(previous, decayCat, 0);
    const decayStart = 0 + 50 + 100; // 150
    expect(r.decay_start_time).toBe(decayStart);
    // (900+900)*0.91^days <= 900  =>  days >= ln(0.5)/ln(0.91) ≈ 7.35  =>  8
    expect(r.decay_full_time).toBe(decayStart + 8 * 86400);
    expect(r.decay_state).toBe('none');
  });

  it('is "decaying" once past decay_start_time but before decay_full_time', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 900 };
    const decayStart = 150;
    const r = computeDecay(previous, decayCat, decayStart + 86400); // 1 day into decay
    expect(r.decay_state).toBe('decaying');
  });

  it('is "fully_decayed" at decay_full_time', () => {
    const previous = { ended_at: 0, rest_seconds: 50, target_wear_seconds: 900 };
    const decayStart = 150;
    const r = computeDecay(previous, decayCat, decayStart + 8 * 86400);
    expect(r.decay_state).toBe('fully_decayed');
    expect(r.decay_full_time).toBe(decayStart + 8 * 86400);
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
