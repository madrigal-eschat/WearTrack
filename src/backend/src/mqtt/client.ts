import mqtt, { type MqttClient } from 'mqtt';
import { mqttConfigStore } from './config-store.js';

export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectConfig {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

let client: MqttClient | null = null;
let status: ConnectionStatus = 'disconnected';

export function getStatus(): ConnectionStatus {
  return status;
}

export function disconnect(): void {
  if (client) {
    client.end(true);
    client = null;
  }
  status = 'disconnected';
}

export function connect(config: ConnectConfig): void {
  disconnect();
  status = 'connecting';
  const thisClient = mqtt.connect(`mqtt://${config.host}:${config.port}`, {
    username: config.username ?? undefined,
    password: config.password ?? undefined,
  });
  client = thisClient;
  thisClient.on('connect', () => {
    if (client === thisClient) {
      status = 'connected';
    }
  });
  thisClient.on('close', () => {
    if (client === thisClient) {
      status = 'disconnected';
    }
  });
  thisClient.on('error', () => {
    if (client === thisClient) {
      status = 'error';
    }
  });
}

export function publish(
  topic: string,
  payload: unknown,
  opts: { retain?: boolean } = {},
): void {
  if (!client) {
    return;
  }
  client.publish(topic, JSON.stringify(payload), {
    qos: 0,
    retain: opts.retain ?? false,
  });
}

export function reloadFromConfig(): void {
  const config = mqttConfigStore.get();
  if (config.enabled && config.host) {
    connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
    });
  } else {
    disconnect();
  }
}

export function initMqtt(): void {
  reloadFromConfig();
}
