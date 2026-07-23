export interface LastEdited {
  sessionId: number;
  originalEndedAt: number;
}

/**
 * Client-side-only editing policy (never enforced by the API): a session may
 * only shrink its end time, UNLESS it's the single most-recently-edited
 * session in this page load, in which case it can move anywhere back up to
 * its pre-edit original end — one chance to undo a mis-edit. Editing a
 * different session, or a page reload, loses that chance permanently.
 */
export function computeEditableRange(
  session: { id: number; started_at: number; ended_at: number },
  lastEdited: LastEdited | null,
): { min: number; max: number } {
  const isLastEdited = lastEdited?.sessionId === session.id;
  return {
    min: session.started_at,
    max: isLastEdited && lastEdited
      ? lastEdited.originalEndedAt
      : session.ended_at,
  };
}
