export interface MqttConfig {
  enabled: boolean;
  host: string | null;
  port: number;
  username: string | null;
  password: string | null;
  topic_prefix: string;
  ha_discovery_enabled: boolean;
}

class MqttConfigStore {
  get(): MqttConfig {
    const host = process.env.MQTT_HOST || null
    return {
      enabled: host !== null,
      host,
      port: Number(process.env.MQTT_PORT) || 1883,
      username: process.env.MQTT_USER || null,
      password: process.env.MQTT_PASS || null,
      topic_prefix: process.env.MQTT_TOPIC_PREFIX || 'weartrack',
      ha_discovery_enabled: process.env.MQTT_HOMEASSISTANT_DISCOVERY === 'true',
    }
  }
}

export const mqttConfigStore = new MqttConfigStore()
