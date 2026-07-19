import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/notifications/sender.js', () => ({
  isConfigured: true,
  send: vi.fn().mockResolvedValue(undefined),
}));

import { eventBus } from '../../src/events/bus.js';
import { notificationStore } from '../../src/notifications/store.js';
import { send } from '../../src/notifications/sender.js';
import { startScheduler } from '../../src/notifications/runner.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(notificationStore, 'getSubscription').mockReturnValue('{"endpoint":"https://x"}');
});

describe('notifications runner (bus subscriber)', () => {
  it('sends a push notification when rest_end fires', async () => {
    startScheduler();
    eventBus.emit('rest_end', {
      category_id: 1, category_name: 'Footwear', timestamp: 100, rest_seconds: 3600, elapsed_rest_seconds: 3600,
    });
    await new Promise((r) => setTimeout(r, 0)); // let the async listener settle
    expect(send).toHaveBeenCalledWith(
      '{"endpoint":"https://x"}',
      expect.objectContaining({ tag: 'category-1' }),
    );
  });

  it('sends nothing for decay_start (no notification defined for it)', async () => {
    startScheduler();
    eventBus.emit('decay_start', {
      category_id: 1, category_name: 'Footwear', timestamp: 100, decay_state: 'decaying', decay_full_time: 200,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send when there is no stored push subscription', async () => {
    vi.mocked(notificationStore.getSubscription).mockReturnValue(null);
    startScheduler();
    eventBus.emit('target_met', { category_id: 1, category_name: 'Footwear', timestamp: 100, session_id: 5 });
    await new Promise((r) => setTimeout(r, 0));
    expect(send).not.toHaveBeenCalled();
  });
});
