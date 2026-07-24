import {
  categoryStore,
  type Category,
  type CategoryCreate,
  type CategoryUpdate,
} from '../db/stores/category-store.js'
import { ValidationError } from '../middleware/errors.js'
import type { RiskLevel } from '../db/calculations.js'

function validateName(value: unknown): string {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('name is required')
  }
  return value
}

function validateIcon(value: unknown): string {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('icon is required')
  }
  return value
}

function validateTargetDuration(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ValidationError(
      'initial_target_wear_duration_seconds must be a number',
    )
  }
  return value
}

function validateMaxDuration(value: unknown): number | null {
  if (value !== null && typeof value !== 'number') {
    throw new ValidationError(
      'initial_max_wear_duration_seconds must be a number or null',
    )
  }
  return value
}

function validateRestMultiplier(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ValidationError('rest_multiplier must be a number')
  }
  return value
}

function validateMinimumRest(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ValidationError('minimum_rest must be a number')
  }
  return value
}

function validateRiskLevels(value: unknown): RiskLevel[] {
  const valid =
    Array.isArray(value) &&
    value.every(
      (l) =>
        typeof l === 'object' &&
        l !== null &&
        (l.lower === null || typeof l.lower === 'number') &&
        (l.upper === null || typeof l.upper === 'number') &&
        typeof l.text === 'string' &&
        typeof l.severity === 'number',
    )
  if (!valid) {
    throw new ValidationError(
      'risk_levels must be an array of valid risk level objects',
    )
  }
  return value as RiskLevel[]
}

function validateBreakDecayMultiplier(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ValidationError('break_decay_multiplier must be a number')
  }
  return value
}

function validateBreakGraceTime(value: unknown): number {
  if (typeof value !== 'number') {
    throw new ValidationError('break_grace_time must be a number')
  }
  return value
}

function validateType(value: unknown): 'duration' | 'rotation' {
  if (value !== 'duration' && value !== 'rotation') {
    throw new ValidationError("type must be 'duration' or 'rotation'")
  }
  return value
}

function validateConsecutiveWearDays(value: unknown): number {
  if (typeof value !== 'number' || value < 1) {
    throw new ValidationError(
      'consecutive_wear_days must be a positive number',
    )
  }
  return value
}

export class CreateCategoryCommand {
  constructor(private readonly body: Record<string, unknown>) {}

  private validate(): CategoryCreate {
    const data: CategoryCreate = {
      name: validateName(this.body.name),
      icon: validateIcon(this.body.icon),
      initial_target_wear_duration_seconds: validateTargetDuration(
        this.body.initial_target_wear_duration_seconds,
      ),
      initial_max_wear_duration_seconds: validateMaxDuration(
        this.body.initial_max_wear_duration_seconds,
      ),
      rest_multiplier: validateRestMultiplier(this.body.rest_multiplier),
      minimum_rest: validateMinimumRest(this.body.minimum_rest),
      risk_levels: validateRiskLevels(this.body.risk_levels),
      break_decay_multiplier: validateBreakDecayMultiplier(
        this.body.break_decay_multiplier,
      ),
      break_grace_time: validateBreakGraceTime(this.body.break_grace_time),
    }
    if (this.body.type !== undefined) {
      data.type = validateType(this.body.type)
    }
    if (this.body.consecutive_wear_days !== undefined) {
      data.consecutive_wear_days = validateConsecutiveWearDays(
        this.body.consecutive_wear_days,
      )
    }
    return data
  }

  run(): Category {
    return categoryStore.create(this.validate())
  }
}

export class UpdateCategoryCommand {
  constructor(
    private readonly existing: Category,
    private readonly body: Record<string, unknown>,
  ) {}

  private buildUpdates(): CategoryUpdate {
    const updates: CategoryUpdate = {}
    if ('name' in this.body) {
      updates.name = validateName(this.body.name)
    }
    if ('icon' in this.body) {
      updates.icon = validateIcon(this.body.icon)
    }
    if ('initial_target_wear_duration_seconds' in this.body) {
      updates.initial_target_wear_duration_seconds = validateTargetDuration(
        this.body.initial_target_wear_duration_seconds,
      )
    }
    if ('initial_max_wear_duration_seconds' in this.body) {
      updates.initial_max_wear_duration_seconds = validateMaxDuration(
        this.body.initial_max_wear_duration_seconds,
      )
    }
    if ('rest_multiplier' in this.body) {
      updates.rest_multiplier = validateRestMultiplier(
        this.body.rest_multiplier,
      )
    }
    if ('minimum_rest' in this.body) {
      updates.minimum_rest = validateMinimumRest(this.body.minimum_rest)
    }
    if ('risk_levels' in this.body) {
      updates.risk_levels = validateRiskLevels(this.body.risk_levels)
    }
    if ('break_decay_multiplier' in this.body) {
      updates.break_decay_multiplier = validateBreakDecayMultiplier(
        this.body.break_decay_multiplier,
      )
    }
    if ('break_grace_time' in this.body) {
      updates.break_grace_time = validateBreakGraceTime(
        this.body.break_grace_time,
      )
    }
    if ('type' in this.body) {
      updates.type = validateType(this.body.type)
    }
    if ('consecutive_wear_days' in this.body) {
      updates.consecutive_wear_days = validateConsecutiveWearDays(
        this.body.consecutive_wear_days,
      )
    }
    return updates
  }

  run(): Category {
    const updates = this.buildUpdates()
    if (Object.keys(updates).length === 0) {
      return this.existing
    }
    return categoryStore.update(this.existing.id, updates)
  }
}
