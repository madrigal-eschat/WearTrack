import { buildRiskLevels } from './riskLevels.js';
import type { CategoryFormState } from '../components/CategoryForm.vue';
import type { RiskLevel } from './riskLevels.js';

export interface CategoryApiShape {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  break_decay_multiplier: number;
  break_grace_time: number;
  risk_levels: RiskLevel[];
  [key: string]: unknown;
}

/** Days for a value decaying at `multiplier` retained per day to halve. */
export function multiplierToHalfLifeDays(multiplier: number): number {
  return Math.log(0.5) / Math.log(multiplier);
}

/** The daily retain-fraction that gives a value the given half-life in days. */
export function halfLifeDaysToMultiplier(halfLifeDays: number): number {
  return 0.5 ** (1 / halfLifeDays);
}

export function categoryToFormState(cat: CategoryApiShape): CategoryFormState {
  return {
    name: cat.name,
    icon: cat.icon,
    initialWearTargetSeconds: cat.initial_target_wear_duration_seconds,
    initialWearMaxSeconds: cat.initial_max_wear_duration_seconds,
    minimumRestSeconds: cat.minimum_rest,
    breakGraceSeconds: cat.break_grace_time,
    breakDecayHalfLifeDays: multiplierToHalfLifeDays(cat.break_decay_multiplier),
    restMultiplier: cat.rest_multiplier,
    bandCount: cat.risk_levels.length,
    crossoverPoints: cat.risk_levels.slice(0, -1).map((l) => l.upper as number),
  };
}

export function formStateToApiPayload(data: CategoryFormState): {
  name: string;
  icon: string;
  initial_target_wear_duration_seconds: number;
  initial_max_wear_duration_seconds: number | null;
  rest_multiplier: number;
  minimum_rest: number;
  break_decay_multiplier: number;
  break_grace_time: number;
  risk_levels: RiskLevel[];
} {
  return {
    name: data.name,
    icon: data.icon,
    initial_target_wear_duration_seconds: data.initialWearTargetSeconds,
    initial_max_wear_duration_seconds: data.initialWearMaxSeconds,
    rest_multiplier: data.restMultiplier,
    minimum_rest: data.minimumRestSeconds,
    break_decay_multiplier: halfLifeDaysToMultiplier(data.breakDecayHalfLifeDays),
    break_grace_time: data.breakGraceSeconds,
    risk_levels: buildRiskLevels(data.bandCount, data.crossoverPoints),
  };
}
