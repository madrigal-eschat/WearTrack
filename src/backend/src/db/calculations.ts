export interface RiskLevel {
  lower: number | null;
  upper: number | null;
  text: string;
  severity: number;
  rest_weight?: number;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  risk_levels: string | RiskLevel[];
  break_decay_multiplier: number;
  break_grace_time: number;
  type: 'duration' | 'rotation';
  consecutive_wear_days: number;
}

export interface PreviousSession {
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  ended_at: number;
  started_at: number;
  rest_seconds: number;
}

/** Normalised rest contribution for a 0-indexed band among `count` bands: 0 (lowest) .. 2 (highest). */
export function restWeight(index: number, count: number): number {
  return count > 1 ? 2 * (index / (count - 1)) : 0;
}

/** Parse risk_levels and attach rest_weight by ordered position. */
export function parseRiskLevels(category: Category): RiskLevel[] {
  const levels =
    typeof category.risk_levels === 'string'
      ? (JSON.parse(category.risk_levels) as RiskLevel[])
      : category.risk_levels;
  return levels.map((l, i) => ({ ...l, rest_weight: restWeight(i, levels.length) }));
}

/** Risk band whose [lower, upper) range contains `elapsed`, or null below the first threshold. */
export function riskLevelFor(elapsed: number, category: Category): RiskLevel | null {
  const levels = parseRiskLevels(category);
  for (const level of levels) {
    const aboveLower = level.lower === null || elapsed > level.lower;
    const belowUpper = level.upper === null || elapsed <= level.upper;
    if (aboveLower && belowUpper) return level;
  }
  return null;
}

/** Completed laps in a previous session: floor(elapsed / target). Only meaningful for null-max categories. */
export function lapCount(previous: PreviousSession): number {
  const elapsed = previous.ended_at - previous.started_at;
  return Math.floor(elapsed / previous.target_wear_seconds);
}

/**
 * Derived rotation availability: no stored cycle state. Walk `recentSessions`
 * in chronological order (oldest to newest, i.e. the reverse of the
 * newest-first input) and track which active items have been used in the
 * current, still-open cycle. The moment that tracking set covers every
 * active item, a full rotation just completed, so it resets to empty and a
 * new cycle begins. A repeat of an item already used in the current open
 * cycle (e.g. from a consecutive-wear-days lock) is a no-op: it doesn't
 * force a reset. Items not in `activeItemIds` (removed from the category)
 * are ignored entirely. The items available next are whatever active items
 * haven't been used yet in the current cycle.
 */
export function rotationAvailability(
  activeItemIds: number[],
  recentSessions: { item_id: number }[],
): Set<number> {
  const active = new Set(activeItemIds);
  let usedThisCycle = new Set<number>();

  for (const session of [...recentSessions].reverse()) {
    if (!active.has(session.item_id)) continue;
    usedThisCycle.add(session.item_id);
    if (usedThisCycle.size === active.size) usedThisCycle = new Set();
  }

  return new Set([...active].filter((id) => !usedThisCycle.has(id)));
}

/** Previous durations grown by one category increment, scaled by difficulty modifier. */
function growDurations(
  previous: PreviousSession,
  category: Category,
  dm: number,
): { target: number; max: number | null } {
  const maxIsSet = category.initial_max_wear_duration_seconds !== null;
  const lapBonus = maxIsSet ? 0 : Math.floor(lapCount(previous) / 2) * previous.target_wear_seconds;
  return {
    target: dm * (previous.target_wear_seconds + category.initial_target_wear_duration_seconds + lapBonus),
    max: maxIsSet
      ? dm * ((previous.max_wear_seconds ?? 0) + category.initial_max_wear_duration_seconds!)
      : null,
  };
}

/** One day's floored decay step: loses at least `floor` even if the percentage loss would be smaller. */
function decayOneDay(value: number, floor: number, lossFraction: number): number {
  const loss = Math.max(lossFraction * value, floor);
  return Math.max(value - loss, floor);
}

/** `value` decayed by `days` floored daily steps (see `decayOneDay`). */
function decayValue(value: number, floor: number, lossFraction: number, days: number): number {
  let v = value;
  for (let day = 0; day < days; day++) v = decayOneDay(v, floor, lossFraction);
  return v;
}

/** Day-by-day decay past grace: each day's loss is at least `floorTarget`/`floorMax`, so the value reaches the floor in a bounded number of days instead of trailing off asymptotically. */
function applyBreakDecay(
  target: number,
  max: number | null,
  daysSinceGrace: number,
  decayMultiplier: number,
  floorTarget: number,
  floorMax: number | null,
): { target: number; max: number | null } {
  const lossFraction = 1 - decayMultiplier;
  return {
    target: decayValue(target, floorTarget, lossFraction, daysSinceGrace),
    max: max === null || floorMax === null ? max : decayValue(max, floorMax, lossFraction, daysSinceGrace),
  };
}

/** Raw durations for the three start situations: first session, inside rest (halve), or post-rest (grow + optional decay). */
function rawDurations(
  previous: PreviousSession | null,
  category: Category,
  dm: number,
  startTime: number,
): { target: number; max: number | null } {
  const maxIsSet = category.initial_max_wear_duration_seconds !== null;

  if (!previous) {
    return {
      target: dm * category.initial_target_wear_duration_seconds,
      max: maxIsSet ? dm * category.initial_max_wear_duration_seconds! : null,
    };
  }

  const earliestStart = previous.ended_at + previous.rest_seconds;
  const latestStart = earliestStart + category.break_grace_time;

  let target: number;
  let max: number | null;

  if (startTime < earliestStart) {
    const lapBonus = maxIsSet ? 0 : Math.floor(lapCount(previous) / 2) * previous.target_wear_seconds;
    target = (dm / 2) * (previous.target_wear_seconds + lapBonus);
    max = maxIsSet ? (previous.max_wear_seconds ?? 0) / 2 : null;
  } else {
    ({ target, max } = growDurations(previous, category, dm));
  }

  if (startTime > latestStart) {
    const daysSinceGrace = Math.floor((startTime - latestStart) / 86400);
    ({ target, max } = applyBreakDecay(
      target,
      max,
      daysSinceGrace,
      category.break_decay_multiplier,
      dm * category.initial_target_wear_duration_seconds,
      maxIsSet ? dm * category.initial_max_wear_duration_seconds! : null,
    ));
  }

  return { target, max };
}

/** Halve durations when an injury is active. */
function applyInjury(
  target: number,
  max: number | null,
): { target: number; max: number | null } {
  return { target: target / 2, max: max === null ? null : max / 2 };
}

/** Session-Start formula from docs/design/duration-formula.md. */
export function computeSessionStart(
  category: Category,
  item: { difficulty_multiplier: number },
  previous: PreviousSession | null,
  startTime: number,
  injuryActive: boolean,
): { target: number; max: number | null } {
  const dm = 1 / item.difficulty_multiplier;

  let { target, max } = rawDurations(previous, category, dm, startTime);

  // Never go below what the first session would give (with the same difficulty modifier).
  target = Math.max(target, dm * category.initial_target_wear_duration_seconds);
  if (max !== null) max = Math.max(max, dm * category.initial_max_wear_duration_seconds!);

  if (injuryActive) ({ target, max } = applyInjury(target, max));

  return { target: Math.floor(target), max: max === null ? null : Math.floor(max) };
}

/** Base rest before any penalty or floor: elapsed scaled by risk level and category multiplier. */
function baseRestSeconds(elapsed: number, riskLevel: RiskLevel | null, category: Category): number {
  const weight = riskLevel?.rest_weight ?? 0;
  return elapsed * (1 + weight) * category.rest_multiplier;
}

/** Extra rest added when elapsed exceeds the session max: 2 seconds per second over. */
function overMaxPenaltySeconds(elapsed: number, sessionMax: number): number {
  return (elapsed - sessionMax) * 2;
}

// ─── Decay ────────────────────────────────────────────────────────────────────

export type DecayState = 'none' | 'decaying' | 'fully_decayed';

export function computeDecay(
  previous: { ended_at: number; rest_seconds: number; target_wear_seconds: number } | null,
  category: { break_grace_time: number; break_decay_multiplier: number; initial_target_wear_duration_seconds: number },
  now: number,
): { decay_start_time: number | null; decay_state: DecayState; decay_full_time: number | null } {
  if (!previous) return { decay_start_time: null, decay_state: 'none', decay_full_time: null };

  const decayStartTime = previous.ended_at + previous.rest_seconds + category.break_grace_time;
  const initial = category.initial_target_wear_duration_seconds;
  const daysToFull = daysUntilFullyDecayed(previous.target_wear_seconds, initial, category.break_decay_multiplier);
  const decayFullTime = decayStartTime + daysToFull * 86400;

  if (now <= decayStartTime) {
    return { decay_start_time: decayStartTime, decay_state: 'none', decay_full_time: decayFullTime };
  }

  const daysSinceGrace = Math.floor((now - decayStartTime) / 86400);
  const lossFraction = 1 - category.break_decay_multiplier;
  const decayed = decayValue(previous.target_wear_seconds + initial, initial, lossFraction, daysSinceGrace);

  const decay_state: DecayState = decayed <= initial ? 'fully_decayed' : 'decaying';
  return { decay_start_time: decayStartTime, decay_state, decay_full_time: decayFullTime };
}

/** Full days of floored decay (see `decayOneDay`) until (previousTarget + initial) reaches initial. */
function daysUntilFullyDecayed(previousTarget: number, initial: number, multiplier: number): number {
  if (previousTarget <= 0 || multiplier <= 0 || multiplier >= 1) return 0;
  const lossFraction = 1 - multiplier;
  let target = previousTarget + initial;
  let days = 0;
  while (target > initial) {
    target = decayOneDay(target, initial, lossFraction);
    days++;
  }
  return days;
}

/** Session-End rest formula from docs/design/duration-formula.md. */
export function computeRest(
  elapsed: number,
  sessionMax: number | null,
  category: Category,
  riskLevel: RiskLevel | null,
  injuryActive: boolean,
): number {
  let rest = baseRestSeconds(elapsed, riskLevel, category);

  if (sessionMax !== null && elapsed > sessionMax) {
    rest += overMaxPenaltySeconds(elapsed, sessionMax);
  }

  const maxIsSet = category.initial_max_wear_duration_seconds !== null;
  rest = Math.max(rest, maxIsSet ? category.minimum_rest : 0);

  if (injuryActive) rest *= 1.5;

  return Math.floor(rest);
}
