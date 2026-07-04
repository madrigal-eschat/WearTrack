import { describe, it, expect } from 'vitest';
import { computeEditableRange } from './sessionEditPolicy';

const session = { id: 1, started_at: 1000, ended_at: 2000 };

describe('computeEditableRange', () => {
  it('with no prior edit, allows shrinking down to just after start, up to current end', () => {
    const range = computeEditableRange(session, null);
    expect(range).toEqual({ min: 1000, max: 2000 });
  });

  it('when a different session was last edited, still shrink-only from current end', () => {
    const range = computeEditableRange(session, { sessionId: 2, originalEndedAt: 5000 });
    expect(range).toEqual({ min: 1000, max: 2000 });
  });

  it('when this session is the last-edited one, widens max to the original pre-edit end', () => {
    const range = computeEditableRange(session, { sessionId: 1, originalEndedAt: 3000 });
    expect(range).toEqual({ min: 1000, max: 3000 });
  });
});
