/**
 * Mapping helpers between the API's Category shape and the form's CategoryFormState.
 * Kept pure so they can be unit-tested independently of the Vue components.
 */

import { buildRiskLevels } from './riskLevels.js';
import type { CategoryFormState } from '../components/CategoryForm.vue';
import type { RiskLevel } from './riskLevels.js';

export interface CategoryApiShape {
  name: string;
  icon: string;
  initial_wear_duration_seconds: number;
  rest_multiplier: number;
  risk_levels: RiskLevel[];
  [key: string]: unknown;
}

/** Convert an API Category into form state (for pre-filling the edit form). */
export function categoryToFormState(cat: CategoryApiShape): CategoryFormState {
  return {
    name: cat.name,
    icon: cat.icon,
    initialWearSeconds: cat.initial_wear_duration_seconds,
    restMultiplier: cat.rest_multiplier,
    bandCount: cat.risk_levels.length,
    crossoverPoints: cat.risk_levels
      .slice(0, -1)
      .map((l) => l.upper as number),
  };
}

/** Convert form state into the partial API payload sent on create or PATCH. */
export function formStateToApiPayload(data: CategoryFormState): {
  name: string;
  icon: string;
  initial_wear_duration_seconds: number;
  rest_multiplier: number;
  risk_levels: RiskLevel[];
} {
  return {
    name: data.name,
    icon: data.icon,
    initial_wear_duration_seconds: data.initialWearSeconds,
    rest_multiplier: data.restMultiplier,
    risk_levels: buildRiskLevels(data.bandCount, data.crossoverPoints),
  };
}
