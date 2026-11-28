import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/notifications/sender.js', () => ({
  isConfigured: true,
  send: vi.fn().mockResolvedValue(201),
}))

import { eventBus } from '../../src/events/bus.js'
import { notificationStore } from '../../src/notifications/store.js'
import { send } from '../../src/notifications/sender.js'
import { startScheduler } from '../../src/notifications/runner.js'

const subscription = { id: 1, subscription_json: '{"endpoint":"https://x"}' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(notificationStore, 'getSubscriptions')
    .mockReturnValue([subscription])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('notifications runner (bus subscriber)', () => {
  it('sends a push notification when rest_end fires', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    startScheduler()
    eventBus.emit('rest_end', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 100,
      rest_seconds: 3600,
      elapsed_rest_seconds: 3600,
    })
    await new Promise((r) => setTimeout(r, 0)) // let the async listener settle
    expect(send).toHaveBeenCalledWith(
      '{"endpoint":"https://x"}',
      expect.objectContaining({ tag: 'category-1' }),
    )
    const context = { event: 'rest_end', categoryId: 1, subscriptionId: 1 }
    expect(info).toHaveBeenNthCalledWith(
      1, '[notifications] Sending push', context,
    )
    expect(info).toHaveBeenNthCalledWith(
      2, '[notifications] Push accepted',
      { ...context, statusCode: 201 },
    )
  })

  it.each([403, 404, 410, undefined])(
    'logs a sanitized send failure with status %s',
    async (statusCode) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(console, 'info').mockImplementation(() => {})
      const second = { id: 2, subscription_json: '{"endpoint":"https://y"}' }
      vi.mocked(notificationStore.getSubscriptions)
        .mockReturnValue([subscription, second])
      const remove = vi.spyOn(notificationStore, 'deleteExpiredSubscription')
        .mockImplementation(() => {})
      vi.mocked(send).mockRejectedValueOnce({
        statusCode, endpoint: 'https://push.example/private', body: 'private',
      })
      startScheduler()
      eventBus.emit('target_met', {
        category_id: 1,
        category_name: 'Footwear',
        timestamp: 100,
        session_id: 5,
      })
      await new Promise((r) => setTimeout(r, 0))
      expect(error).toHaveBeenCalledExactlyOnceWith(
        '[notifications] Push failed',
        { event: 'target_met', categoryId: 1, subscriptionId: 1, statusCode },
      )
      expect(vi.mocked(send).mock.calls.map(([json]) => json))
        .toEqual([subscription.subscription_json, second.subscription_json])
      const expired = statusCode === 404 || statusCode === 410
      expect(remove.mock.calls).toEqual(expired ? [[subscription]] : [])
    },
  )

  it(
    'sends a push notification with a formatted time-to-decay ' +
      'when idle_halfway_reached fires',
    async () => {
      startScheduler()
      eventBus.emit('idle_halfway_reached', {
        category_id: 1,
        category_name: 'Footwear',
        timestamp: 100,
        decay_start_time: 100 + 7200,
      })
      await new Promise((r) => setTimeout(r, 0))
      expect(send).toHaveBeenCalledWith(
        '{"endpoint":"https://x"}',
        expect.objectContaining({
          body: 'Durations start decaying in 2 hours',
          tag: 'category-1',
        }),
      )
    })

  it(
    'sends nothing for decay_start (no notification defined for it)',
    async () => {
      startScheduler()
      eventBus.emit('decay_start', {
        category_id: 1,
        category_name: 'Footwear',
        timestamp: 100,
        decay_state: 'decaying',
        decay_full_time: 200,
      })
      await new Promise((r) => setTimeout(r, 0))
      expect(send).not.toHaveBeenCalled()
    })

  it('does not send when there is no stored push subscription', async () => {
    vi.mocked(notificationStore.getSubscriptions).mockReturnValue([])
    startScheduler()
    eventBus.emit('target_met', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 100,
      session_id: 5,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(send).not.toHaveBeenCalled()
  })

  it(
    'does not register duplicate listeners (and so does not ' +
      'double-send) when startScheduler is called twice',
    async () => {
      vi.resetModules()
      const senderMod = await import('../../src/notifications/sender.js')
      const busMod = await import('../../src/events/bus.js')
      const storeMod = await import('../../src/notifications/store.js')
      const runnerMod = await import('../../src/notifications/runner.js')

      vi.spyOn(storeMod.notificationStore, 'getSubscriptions').mockReturnValue(
        [subscription],
      )

      runnerMod.startScheduler()
      // second call must be a no-op, not a second registration
      runnerMod.startScheduler()

      busMod.eventBus.emit('rest_end', {
        category_id: 9,
        category_name: 'Footwear',
        timestamp: 100,
        rest_seconds: 3600,
        elapsed_rest_seconds: 3600,
      })
      await new Promise((r) => setTimeout(r, 0))

      expect(senderMod.send).toHaveBeenCalledTimes(1)
    })

  it('sends a push notification when reminder_due fires', async () => {
    startScheduler()
    eventBus.emit('reminder_due', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 100,
      session_id: 42,
      schedule_id: 7,
      text: 'Change your wrist strap',
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(send).toHaveBeenCalledWith(
      '{"endpoint":"https://x"}',
      expect.objectContaining({
        title: 'Maintenance for Footwear',
        body: 'Change your wrist strap',
        tag: 'category-1-reminder-7',
      }),
    )
  })
})
