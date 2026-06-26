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
}

export interface PreviousSession {
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  ended_at: number;
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

/** Previous durations grown by one category increment, scaled by difficulty modifier. */
function growDurations(
  previous: PreviousSession,
  category: Category,
  dm: number,
): { target: number; max: number | null } {
  const maxIsSet = category.initial_max_wear_duration_seconds !== null;
  return {
    target: dm * (previous.target_wear_seconds + category.initial_target_wear_duration_seconds),
    max: maxIsSet
      ? dm * ((previous.max_wear_seconds ?? 0) + category.initial_max_wear_duration_seconds!)
      : null,
  };
}

/** Compound daily decay applied for each full day past the grace period. */
function applyBreakDecay(
  target: number,
  max: number | null,
  daysSinceGrace: number,
  decayMultiplier: number,
): { target: number; max: number | null } {
  const decay = decayMultiplier ** daysSinceGrace;
  return { target: target * decay, max: max === null ? null : max * decay };
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

  let { target, max } = startTime < earliestStart
    ? { target: previous.target_wear_seconds / 2, max: maxIsSet ? (previous.max_wear_seconds ?? 0) / 2 : null }
    : growDurations(previous, category, dm);

  if (startTime > latestStart) {
    const daysSinceGrace = Math.floor((startTime - latestStart) / 86400);
    ({ target, max } = applyBreakDecay(target, max, daysSinceGrace, category.break_decay_multiplier));
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
): { decay_start_time: number | null; decay_state: DecayState } {
  if (!previous) return { decay_start_time: null, decay_state: 'none' };

  const decayStartTime = previous.ended_at + previous.rest_seconds + category.break_grace_time;
  if (now <= decayStartTime) return { decay_start_time: decayStartTime, decay_state: 'none' };

  const daysSinceGrace = Math.floor((now - decayStartTime) / 86400);
  const decayFactor = category.break_decay_multiplier ** daysSinceGrace;
  const initial = category.initial_target_wear_duration_seconds;
  const decayed = (previous.target_wear_seconds + initial) * decayFactor;

  const decay_state: DecayState = decayed <= initial ? 'fully_decayed' : 'decaying';
  return { decay_start_time: decayStartTime, decay_state };
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
