import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/mqtt/client.js', () => ({ publish: vi.fn() }));

import { eventBus } from '../../src/events/bus.js';
import { mqttConfigStore } from '../../src/mqtt/config-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { startDiscovery } from '../../src/mqtt/discovery.js';
import { publish } from '../../src/mqtt/client.js';

const mockPublish = vi.mocked(publish);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(categoryStore, 'findAll').mockReturnValue([
    { id: 1, name: 'Winter Gloves', icon: 'icon', initial_target_wear_duration_seconds: 900,
      initial_max_wear_duration_seconds: 1800, rest_multiplier: 2, minimum_rest: 86400,
      risk_levels: [], break_decay_multiplier: 0.91, break_grace_time: 86400 },
  ]);
  startDiscovery();
});

describe('mqtt discovery', () => {
  it('publishes a retained discovery config per category on poller_tick when enabled', () => {
    vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
      id: 1, enabled: 1, host: 'broker.local', port: 1883, username: null, password: null,
      topic_prefix: 'weartrack', ha_discovery_enabled: 1,
    });
    eventBus.emit('poller_tick', { timestamp: 1000 });
    expect(mockPublish).toHaveBeenCalledWith(
      'homeassistant/sensor/weartrack_1/config',
      expect.objectContaining({
        unique_id: 'weartrack_1_status',
        state_topic: 'weartrack/winter-gloves/state',
        json_attributes_topic: 'weartrack/winter-gloves/state',
      }),
      { retain: true },
    );
  });

  it('publishes nothing when ha_discovery_enabled is false', () => {
    vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
      id: 1, enabled: 1, host: 'broker.local', port: 1883, username: null, password: null,
      topic_prefix: 'weartrack', ha_discovery_enabled: 0,
    });
    eventBus.emit('poller_tick', { timestamp: 1000 });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('publishes nothing when mqtt itself is disabled', () => {
    vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
      id: 1, enabled: 0, host: 'broker.local', port: 1883, username: null, password: null,
      topic_prefix: 'weartrack', ha_discovery_enabled: 1,
    });
    eventBus.emit('poller_tick', { timestamp: 1000 });
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
