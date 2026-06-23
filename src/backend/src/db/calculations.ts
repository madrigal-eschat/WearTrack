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

/** Session-Start formula from docs/design/duration-formula.md. */
export function computeSessionStart(
  category: Category,
  item: { difficulty_multiplier: number },
  previous: PreviousSession | null,
  startTime: number,
  injuryActive: boolean,
): { target: number; max: number | null } {
  const dm = 1 / item.difficulty_multiplier;
  const maxIsSet = category.initial_max_wear_duration_seconds !== null;

  let target: number;
  let max: number | null;

  if (previous) {
    const earliestStart = previous.ended_at + previous.rest_seconds;
    const latestStart = earliestStart + category.break_grace_time;

    if (startTime < earliestStart) {
      target = previous.target_wear_seconds / 2;
      max = maxIsSet ? (previous.max_wear_seconds ?? 0) / 2 : null;
    } else {
      target = dm * (previous.target_wear_seconds + category.initial_target_wear_duration_seconds);
      max = maxIsSet
        ? dm * ((previous.max_wear_seconds ?? 0) + category.initial_max_wear_duration_seconds!)
        : null;
    }

    if (startTime > latestStart) {
      const daysSinceGrace = Math.floor((startTime - latestStart) / 86400);
      const decay = category.break_decay_multiplier ** daysSinceGrace;
      target *= decay;
      if (max !== null) max *= decay;
    }
  } else {
    target = dm * category.initial_target_wear_duration_seconds;
    max = maxIsSet ? dm * category.initial_max_wear_duration_seconds! : null;
  }

  if (injuryActive) {
    target /= 2;
    if (max !== null) max /= 2;
  }

  return { target: Math.floor(target), max: max === null ? null : Math.floor(max) };
}

/** Session-End rest formula from docs/design/duration-formula.md. */
export function computeRest(
  elapsed: number,
  sessionMax: number | null,
  category: Category,
  riskLevel: RiskLevel | null,
  injuryActive: boolean,
): number {
  const weight = riskLevel?.rest_weight ?? 0;
  const combined = (1 + weight) * category.rest_multiplier;
  let rest = elapsed * combined;

  if (sessionMax !== null && elapsed > sessionMax) {
    rest += (elapsed - sessionMax) * 2;
  }

  const maxIsSet = category.initial_max_wear_duration_seconds !== null;
  rest = Math.max(rest, maxIsSet ? category.minimum_rest : 0);

  if (injuryActive) rest *= 1.5;

  return Math.floor(rest);
}
