import db from '../db/index.js';

export interface MqttConfig {
  id: 1;
  enabled: number;
  host: string | null;
  port: number;
  username: string | null;
  password: string | null;
  topic_prefix: string;
  ha_discovery_enabled: number;
}

export interface MqttConfigUpdate {
  enabled?: boolean;
  host?: string | null;
  port?: number;
  username?: string | null;
  password?: string | undefined;
  topic_prefix?: string;
  ha_discovery_enabled?: boolean;
}

class MqttConfigStore {
  get(): MqttConfig {
    const row = db.prepare('SELECT * FROM mqtt_config WHERE id = 1').get() as
      MqttConfig | undefined;
    if (row) {
      return row;
    }
    db.prepare(
      `INSERT INTO mqtt_config
         (id, enabled, host, port, username, password, topic_prefix,
          ha_discovery_enabled)
       VALUES (1, 0, NULL, 1883, NULL, NULL, 'weartrack', 0)`,
    ).run();
    return db
      .prepare('SELECT * FROM mqtt_config WHERE id = 1')
      .get() as MqttConfig;
  }

  update(data: MqttConfigUpdate): MqttConfig {
    this.get();
    const dbData: Record<string, unknown> = {};
    if (data.enabled !== undefined) {
      dbData.enabled = data.enabled ? 1 : 0;
    }
    if (data.host !== undefined) {
      dbData.host = data.host;
    }
    if (data.port !== undefined) {
      dbData.port = data.port;
    }
    if (data.username !== undefined) {
      dbData.username = data.username;
    }
    if (
      data.password !== undefined &&
      data.password !== null &&
      data.password !== ''
    ) {
      dbData.password = data.password;
    }
    if (data.topic_prefix !== undefined) {
      dbData.topic_prefix = data.topic_prefix;
    }
    if (data.ha_discovery_enabled !== undefined) {
      dbData.ha_discovery_enabled = data.ha_discovery_enabled ? 1 : 0;
    }

    const entries = Object.entries(dbData);
    if (entries.length > 0) {
      const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE mqtt_config SET ${setClauses} WHERE id = 1`).run(
        ...entries.map(([, v]) => v),
      );
    }
    return this.get();
  }
}

export const mqttConfigStore = new MqttConfigStore();
