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
  vi.spyOn(notificationStore, 'getSubscription').mockReturnValue(
    '{"endpoint":"https://x"}',
  );
});

describe('notifications runner (bus subscriber)', () => {
  it('sends a push notification when rest_end fires', async () => {
    startScheduler();
    eventBus.emit('rest_end', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 100,
      rest_seconds: 3600,
      elapsed_rest_seconds: 3600,
    });
    await new Promise((r) => setTimeout(r, 0)); // let the async listener settle
    expect(send).toHaveBeenCalledWith(
      '{"endpoint":"https://x"}',
      expect.objectContaining({ tag: 'category-1' }),
    );
  });

  it(
    'sends a push notification with a formatted time-to-decay ' +
      'when idle_halfway_reached fires',
    async () => {
      startScheduler();
      eventBus.emit('idle_halfway_reached', {
        category_id: 1,
        category_name: 'Footwear',
        timestamp: 100,
        decay_start_time: 100 + 7200,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(send).toHaveBeenCalledWith(
        '{"endpoint":"https://x"}',
        expect.objectContaining({
          body: 'Durations start decaying in 2 hours',
          tag: 'category-1',
        }),
      );
    });

  it(
    'sends nothing for decay_start (no notification defined for it)',
    async () => {
      startScheduler();
      eventBus.emit('decay_start', {
        category_id: 1,
        category_name: 'Footwear',
        timestamp: 100,
        decay_state: 'decaying',
        decay_full_time: 200,
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(send).not.toHaveBeenCalled();
    });

  it('does not send when there is no stored push subscription', async () => {
    vi.mocked(notificationStore.getSubscription).mockReturnValue(null);
    startScheduler();
    eventBus.emit('target_met', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 100,
      session_id: 5,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(send).not.toHaveBeenCalled();
  });

  it(
    'does not register duplicate listeners (and so does not ' +
      'double-send) when startScheduler is called twice',
    async () => {
      vi.resetModules();
      const senderMod = await import('../../src/notifications/sender.js');
      const busMod = await import('../../src/events/bus.js');
      const storeMod = await import('../../src/notifications/store.js');
      const runnerMod = await import('../../src/notifications/runner.js');

      vi.spyOn(storeMod.notificationStore, 'getSubscription').mockReturnValue(
        '{"endpoint":"https://x"}',
      );

      runnerMod.startScheduler();
      // second call must be a no-op, not a second registration
      runnerMod.startScheduler();

      busMod.eventBus.emit('rest_end', {
        category_id: 9,
        category_name: 'Footwear',
        timestamp: 100,
        rest_seconds: 3600,
        elapsed_rest_seconds: 3600,
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(senderMod.send).toHaveBeenCalledTimes(1);
    });
});
