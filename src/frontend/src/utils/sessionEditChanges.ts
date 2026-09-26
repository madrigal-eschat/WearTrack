export interface SessionEditChanges {
  started_at?: number;
  ended_at?: number;
}

/**
 * Only the times the user actually changed. Unchanged fields are omitted so
 * a second-precision timestamp isn't rewritten by the minute-resolution
 * datetime inputs.
 */
export function buildEditChanges(
  original: { started_at: number; ended_at: number },
  startedAt: number,
  endedAt: number,
): SessionEditChanges {
  const changes: SessionEditChanges = {}
  if (startedAt !== original.started_at) {
    changes.started_at = startedAt
  }
  if (endedAt !== original.ended_at) {
    changes.ended_at = endedAt
  }
  return changes
}
