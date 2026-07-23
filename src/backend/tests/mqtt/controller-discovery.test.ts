import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('../../src/mqtt/client.js', () => ({
  getStatus: vi.fn(() => 'disconnected'),
  reloadFromConfig: vi.fn(),
  initMqtt: vi.fn(),
  publish: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
}));

import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { publish } from '../../src/mqtt/client.js';

const mockPublish = vi.mocked(publish);
const MQTT = '/api/mqtt';

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  vi.clearAllMocks();
  dbExport.exec('DELETE FROM mqtt_config; DELETE FROM categories;');
});

describe('PUT /api/mqtt/config discovery republish', () => {
  it(
    'republishes HA discovery immediately after the config is saved',
    async () => {
    const category = categoryStore.create({
      name: 'Winter Gloves',
      icon: 'icon',
      initial_target_wear_duration_seconds: 900,
      initial_max_wear_duration_seconds: 1800,
      rest_multiplier: 2,
      minimum_rest: 86400,
      risk_levels: [],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
    });

    const res = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        host: 'broker.local',
        port: 1883,
        topic_prefix: 'weartrack',
        ha_discovery_enabled: true,
      }),
    });
    expect(res.status).toBe(200);

    expect(mockPublish).toHaveBeenCalledWith(
      `homeassistant/sensor/weartrack_${category.id}/config`,
      expect.objectContaining({ unique_id: `weartrack_${category.id}_status` }),
      { retain: true },
    );
  });

  it(
    'does not republish discovery when the saved config disables it',
    async () => {
    categoryStore.create({
      name: 'Boots',
      icon: 'icon',
      initial_target_wear_duration_seconds: 900,
      initial_max_wear_duration_seconds: 1800,
      rest_multiplier: 2,
      minimum_rest: 86400,
      risk_levels: [],
      break_decay_multiplier: 0.91,
      break_grace_time: 86400,
    });

    const res = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        host: 'broker.local',
        port: 1883,
        ha_discovery_enabled: false,
      }),
    });
    expect(res.status).toBe(200);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
