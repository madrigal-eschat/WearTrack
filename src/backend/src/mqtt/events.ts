export interface EventContext {
  category_id: number;
  category_name: string;
  item_id: number | null;
  item_name: string | null;
  difficulty_multiplier: number | null;
  target_wear_seconds: number | null;
  max_wear_seconds: number | null;
  timestamp: number;
}

function base(event: string, ctx: EventContext) {
  return {
    event,
    timestamp: new Date(ctx.timestamp * 1000).toISOString(),
    category_id: ctx.category_id,
    category_name: ctx.category_name,
    item_id: ctx.item_id,
    item_name: ctx.item_name,
    target_wear_seconds: ctx.target_wear_seconds,
    max_wear_seconds: ctx.max_wear_seconds,
    difficulty_modifier: ctx.difficulty_multiplier,
  };
}

export function buildSessionStartPayload(
  ctx: EventContext & { session_id: number },
) {
  return { ...base('session_start', ctx), session_id: ctx.session_id };
}

export function buildSessionEndPayload(
  ctx: EventContext & {
    session_id: number;
    actual_duration_seconds: number;
    rest_seconds: number;
    risk_level: string | null;
  },
) {
  return {
    ...base('session_end', ctx),
    session_id: ctx.session_id,
    actual_duration_seconds: ctx.actual_duration_seconds,
    rest_seconds: ctx.rest_seconds,
    risk_level: ctx.risk_level,
  };
}

export function buildRestStartPayload(
  ctx: EventContext & { rest_seconds: number },
) {
  return { ...base('rest_start', ctx), rest_seconds: ctx.rest_seconds };
}

export function buildRestEndPayload(
  ctx: EventContext & { rest_seconds: number; elapsed_rest_seconds: number },
) {
  return {
    ...base('rest_end', ctx),
    rest_seconds: ctx.rest_seconds,
    elapsed_rest_seconds: ctx.elapsed_rest_seconds,
  };
}

export function buildDecayStartPayload(
  ctx: EventContext & {
    decay_state: 'decaying' | 'fully_decayed';
    decay_full_time: number;
  },
) {
  return {
    ...base('decay_start', ctx),
    decay_state: ctx.decay_state,
    decay_full_time: new Date(ctx.decay_full_time * 1000).toISOString(),
  };
}

export function buildDecayFinishPayload(ctx: EventContext) {
  return {
    ...base('decay_finish', ctx),
    decay_state: 'fully_decayed' as const,
    decay_percentage: 100,
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
