import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/mqtt/client.js', () => ({ publish: vi.fn() }));

import { eventBus } from '../../src/events/bus.js';
import { mqttConfigStore } from '../../src/mqtt/config-store.js';
import { itemStore } from '../../src/db/stores/item-store.js';
import { sessionStore } from '../../src/db/stores/session-store.js';
import { startMqttSubscriber } from '../../src/mqtt/subscriber.js';
import { publish } from '../../src/mqtt/client.js';

const mockPublish = vi.mocked(publish);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
    id: 1,
    enabled: 1,
    host: 'broker.local',
    port: 1883,
    username: null,
    password: null,
    topic_prefix: 'weartrack',
    ha_discovery_enabled: 0,
  });
  vi.spyOn(itemStore, 'find').mockReturnValue({
    id: 2,
    category_id: 1,
    name: 'Test Shoe',
    color: '#fff',
    difficulty_multiplier: 1.0,
  });
  vi.spyOn(sessionStore, 'findLastEndedInCategory').mockReturnValue({
    target_wear_seconds: 900,
    max_wear_seconds: 1800,
    ended_at: 500,
    started_at: 0,
    rest_seconds: 6000,
  });
  startMqttSubscriber();
});

describe('mqtt subscriber', () => {
  it(
    'publishes session_start to the event topic and the ' +
    'retained state topic',
    () => {
    eventBus.emit('session_start', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      session_id: 5,
      item_id: 2,
      target_wear_seconds: 900,
      max_wear_seconds: 1800,
    });
    expect(mockPublish).toHaveBeenCalledWith(
      'weartrack/footwear/session_start',
      expect.objectContaining({
        event: 'session_start',
        item_name: 'Test Shoe',
      }),
      { retain: false },
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'weartrack/footwear/state',
      expect.objectContaining({ event: 'session_start' }),
      { retain: true },
    );
  });

  it('publishes rest_start with null item fields', () => {
    eventBus.emit('rest_start', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      rest_seconds: 6000,
    });
    expect(mockPublish).toHaveBeenCalledWith(
      'weartrack/footwear/rest_start',
      expect.objectContaining({
        event: 'rest_start',
        item_id: null,
        item_name: null,
      }),
      { retain: false },
    );
  });

  it('does not publish when mqtt is disabled', () => {
    vi.mocked(mqttConfigStore.get).mockReturnValue({
      id: 1,
      enabled: 0,
      host: 'broker.local',
      port: 1883,
      username: null,
      password: null,
      topic_prefix: 'weartrack',
      ha_discovery_enabled: 0,
    });
    eventBus.emit('decay_finish', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it(
    'does not subscribe to notification-only events ' +
    '(target_met has no publish)',
    () => {
    eventBus.emit('target_met', {
      category_id: 1,
      category_name: 'Footwear',
      timestamp: 1000,
      session_id: 5,
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
