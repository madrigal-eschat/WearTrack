export function targetWearSeconds(session: { target_wear_seconds: number }): number {
  return session.target_wear_seconds;
}

export function maxWearSeconds(session: { max_wear_seconds: number | null }): number | null {
  return session.max_wear_seconds;
}

/** Elapsed wear for a session: now (seconds) minus start; freezes at ended_at once ended. */
export function currentWear(session: { started_at: number; ended_at: number | null }, now: number): number {
  const end = session.ended_at ?? now;
  return Math.max(0, end - session.started_at);
}

/**
 * Seconds left in an active session: counts down to target first, then to
 * max (if set). Returns null once there's nothing left to count down —
 * max reached, or target reached with no max set.
 */
export function remainingWearSeconds(
  session: { started_at: number; ended_at: number | null; target_wear_seconds: number; max_wear_seconds: number | null },
  now: number
): number | null {
  const elapsed = currentWear(session, now);
  if (elapsed < session.target_wear_seconds) {
    return session.target_wear_seconds - elapsed;
  }
  if (session.max_wear_seconds !== null && elapsed < session.max_wear_seconds) {
    return session.max_wear_seconds - elapsed;
  }
  return null;
}
