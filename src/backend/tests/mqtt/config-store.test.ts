import { describe, it, expect, afterEach } from 'vitest'
import { mqttConfigStore } from '../../src/mqtt/config-store.js'

const ENV_KEYS = [
  'MQTT_HOST',
  'MQTT_PORT',
  'MQTT_USER',
  'MQTT_PASS',
  'MQTT_TOPIC_PREFIX',
  'MQTT_HOMEASSISTANT_DISCOVERY',
] as const

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

describe('mqttConfigStore', () => {
  it('is disabled with defaults when no MQTT_* env vars are set', () => {
    expect(mqttConfigStore.get()).toEqual({
      enabled: false,
      host: null,
      port: 1883,
      username: null,
      password: null,
      topic_prefix: 'weartrack',
      ha_discovery_enabled: false,
    })
  })

  it('reads config from environment variables when set', () => {
    process.env.MQTT_HOST = '192.168.66.31'
    process.env.MQTT_PORT = '1884'
    process.env.MQTT_USER = 'weartrack'
    process.env.MQTT_PASS = 'secret'
    process.env.MQTT_TOPIC_PREFIX = 'home'
    process.env.MQTT_HOMEASSISTANT_DISCOVERY = 'true'

    expect(mqttConfigStore.get()).toEqual({
      enabled: true,
      host: '192.168.66.31',
      port: 1884,
      username: 'weartrack',
      password: 'secret',
      topic_prefix: 'home',
      ha_discovery_enabled: true,
    })
  })

  it('is enabled once MQTT_HOST is set, even with no other vars', () => {
    process.env.MQTT_HOST = 'broker.local'
    expect(mqttConfigStore.get().enabled).toBe(true)
  })
})
