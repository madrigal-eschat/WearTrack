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
