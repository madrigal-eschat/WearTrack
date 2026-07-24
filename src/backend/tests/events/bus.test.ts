import { describe, it, expect, vi } from 'vitest'
import { eventBus } from '../../src/events/bus.js'

describe('eventBus', () => {
  it('delivers an emitted payload to a registered listener', () => {
    const listener = vi.fn()
    eventBus.on('rest_start', listener)
    eventBus.emit('rest_start', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      rest_seconds: 3600,
    })
    expect(listener).toHaveBeenCalledWith({
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      rest_seconds: 3600,
    })
  })

  it('does not deliver to listeners of a different event', () => {
    const listener = vi.fn()
    eventBus.on('decay_finish', listener)
    eventBus.emit('rest_end', {
      category_id: 2,
      category_name: 'Gloves',
      timestamp: 2000,
      rest_seconds: 100,
      elapsed_rest_seconds: 100,
    })
    expect(listener).not.toHaveBeenCalled()
  })

  it(
    'isolates listener exceptions: a throwing listener does not stop ' +
      'later listeners or propagate to emit()',
    () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      const throwingListener = vi.fn(() => {
        throw new Error('boom')
      })
      const secondListener = vi.fn()

      eventBus.on('decay_soon', throwingListener)
      eventBus.on('decay_soon', secondListener)

      const payload = {
        category_id: 3,
        category_name: 'Hats',
        timestamp: 3000,
      }

      expect(() => eventBus.emit('decay_soon', payload)).not.toThrow()

      expect(throwingListener).toHaveBeenCalledWith(payload)
      expect(secondListener).toHaveBeenCalledWith(payload)
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    },
  )
})
