import { describe, it, expect, vi } from 'vitest';
import { eventBus } from '../../src/events/bus.js';

describe('eventBus', () => {
  it('delivers an emitted payload to a registered listener', () => {
    const listener = vi.fn();
    eventBus.on('rest_start', listener);
    eventBus.emit('rest_start', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      rest_seconds: 3600,
    });
    expect(listener).toHaveBeenCalledWith({
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      rest_seconds: 3600,
    });
  });

  it('does not deliver to listeners of a different event', () => {
    const listener = vi.fn();
    eventBus.on('decay_finish', listener);
    eventBus.emit('rest_end', {
      category_id: 2,
      category_name: 'Gloves',
      timestamp: 2000,
      rest_seconds: 100,
      elapsed_rest_seconds: 100,
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
