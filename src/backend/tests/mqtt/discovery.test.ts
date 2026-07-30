import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/mqtt/client.js', () => ({ publish: vi.fn() }))

import { eventBus } from '../../src/events/bus.js'
import { mqttConfigStore } from '../../src/mqtt/config-store.js'
import { categoryStore } from '../../src/db/stores/category-store.js'
import { statsStore } from '../../src/db/stores/stats-store.js'
import { startDiscovery } from '../../src/mqtt/discovery.js'
import { publish } from '../../src/mqtt/client.js'

const mockPublish = vi.mocked(publish)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(categoryStore, 'findAll').mockReturnValue([
    {
      id: 1,
      name: 'Winter Gloves',
      icon: 'icon',
      initial_target_wear_duration_seconds: 900,
      initial_max_wear_duration_seconds: 1800,
      rest_multiplier: 2,
      minimum_rest: 86400,
      risk_levels: [],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
    },
  ])
  vi.spyOn(statsStore, 'findForCategory').mockReturnValue({
    category_id: 1,
    total_wear_seconds: 7200,
    session_count: 5,
    max_single_session_wear_seconds: 1800,
    streak_wear_seconds: 1800,
    streak_count: 2,
    best_streak_wear_seconds: 3600,
    best_streak_count: 4,
    item_count: 1,
  })
  startDiscovery()
})

describe('mqtt discovery', () => {
  it(
    'publishes a retained discovery config per category on ' +
      'poller_tick when enabled',
    () => {
      vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
        enabled: true,
        host: 'broker.local',
        port: 1883,
        username: null,
        password: null,
        topic_prefix: 'weartrack',
        ha_discovery_enabled: true,
      })
      eventBus.emit('poller_tick', { timestamp: 1000 })
      expect(mockPublish).toHaveBeenCalledWith(
        'homeassistant/sensor/weartrack_1/config',
        expect.objectContaining({
          unique_id: 'weartrack_1_status',
          state_topic: 'weartrack/winter-gloves/state',
          json_attributes_topic: 'weartrack/winter-gloves/state',
        }),
        { retain: true },
      )
    },
  )

  it(
    'publishes current streak, longest streak (count + time) and ' +
      'total worn sensors plus a retained stats payload',
    () => {
      vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
        enabled: true,
        host: 'broker.local',
        port: 1883,
        username: null,
        password: null,
        topic_prefix: 'weartrack',
        ha_discovery_enabled: true,
      })
      eventBus.emit('poller_tick', { timestamp: 1000 })

      expect(mockPublish).toHaveBeenCalledWith(
        'homeassistant/sensor/weartrack_1_current_streak/config',
        expect.objectContaining({
          unique_id: 'weartrack_1_current_streak',
          state_topic: 'weartrack/winter-gloves/stats',
          value_template: '{{ value_json.streak_count }}',
          state_class: 'total',
        }),
        { retain: true },
      )
      expect(mockPublish).toHaveBeenCalledWith(
        'homeassistant/sensor/weartrack_1_longest_streak/config',
        expect.objectContaining({
          unique_id: 'weartrack_1_longest_streak',
          value_template: '{{ value_json.best_streak_count }}',
          state_class: 'total',
        }),
        { retain: true },
      )
      expect(mockPublish).toHaveBeenCalledWith(
        'homeassistant/sensor/weartrack_1_longest_streak_time/config',
        expect.objectContaining({
          unique_id: 'weartrack_1_longest_streak_time',
          value_template: '{{ value_json.best_streak_wear_seconds }}',
          device_class: 'duration',
          unit_of_measurement: 's',
        }),
        { retain: true },
      )
      expect(mockPublish).toHaveBeenCalledWith(
        'homeassistant/sensor/weartrack_1_total_worn/config',
        expect.objectContaining({
          unique_id: 'weartrack_1_total_worn',
          value_template: '{{ value_json.total_wear_seconds }}',
          device_class: 'duration',
          unit_of_measurement: 's',
        }),
        { retain: true },
      )
      expect(mockPublish).toHaveBeenCalledWith(
        'weartrack/winter-gloves/stats',
        {
          streak_count: 2,
          streak_wear_seconds: 1800,
          best_streak_count: 4,
          best_streak_wear_seconds: 3600,
          total_wear_seconds: 7200,
        },
        { retain: true },
      )
    },
  )

  it('publishes nothing when ha_discovery_enabled is false', () => {
    vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
      enabled: true,
      host: 'broker.local',
      port: 1883,
      username: null,
      password: null,
      topic_prefix: 'weartrack',
      ha_discovery_enabled: false,
    })
    eventBus.emit('poller_tick', { timestamp: 1000 })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('publishes nothing when mqtt itself is disabled', () => {
    vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
      enabled: false,
      host: 'broker.local',
      port: 1883,
      username: null,
      password: null,
      topic_prefix: 'weartrack',
      ha_discovery_enabled: true,
    })
    eventBus.emit('poller_tick', { timestamp: 1000 })
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
