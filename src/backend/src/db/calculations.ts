export interface RiskLevel {
  lower: number | null;
  upper: number | null;
  text: string;
  severity: number;
}

export interface Category {
  id: number;
  name: string;
  icon: string;
  initial_wear: number;
  rest_multiplier: number;
  rest_constant: number;
  risk_levels: string | RiskLevel[];
  break_decay_multiplier: number;
  break_penalty_period: number;
}

function parseRiskLevels(category: Category): RiskLevel[] {
  return typeof category.risk_levels === 'string'
    ? (JSON.parse(category.risk_levels) as RiskLevel[])
    : category.risk_levels;
}

/**
 * rest = rest_multiplier * wearSeconds + rest_constant
 * Adjusted by 1.5× if another item in the same category is currently injured.
 */
export function calculateRest(wearSeconds: number, category: Category, injuryActive = false): number {
  const base = Math.floor(category.rest_multiplier * wearSeconds + category.rest_constant);
  return injuryActive ? Math.floor(base * 1.5) : base;
}

/**
 * Find which risk_level band the current cumulative wear falls into.
 * Returns null if below the first threshold (safe zone).
 */
export function getRiskLevel(wearSeconds: number, category: Category): RiskLevel | null {
  const levels = parseRiskLevels(category);
  for (const level of levels) {
    const aboveLower = level.lower === null || wearSeconds > level.lower;
    const belowUpper = level.upper === null || wearSeconds <= level.upper;
    if (aboveLower && belowUpper) return level;
  }
  return null;
}

/**
 * Calculate decay factor for break periods beyond the rest period.
 * decay = break_decay_multiplier ^ (breakHours / break_penalty_period)
 */
export function calculateBreakDecay(breakHours: number, category: Category): number {
  return category.break_decay_multiplier ** (breakHours / category.break_penalty_period);
}

/**
 * How much wear credit remains after a break.
 * previousWear × decayFactor, floored to zero.
 */
export function calculatePostBreakWear(previousWearSeconds: number, breakHours: number, category: Category): number {
  const decay = calculateBreakDecay(breakHours, category);
  return Math.max(0, Math.floor(previousWearSeconds * decay));
}
