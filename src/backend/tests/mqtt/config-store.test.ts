import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';
import { mqttConfigStore } from '../../src/mqtt/config-store.js';

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  dbExport.exec('DELETE FROM mqtt_config;');
});

describe('mqttConfigStore', () => {
  it('creates and returns a default disabled row on first get()', () => {
    const config = mqttConfigStore.get();
    expect(config).toMatchObject({
      id: 1,
      enabled: 0,
      host: null,
      port: 1883,
      username: null,
      password: null,
      topic_prefix: 'weartrack',
      ha_discovery_enabled: 0,
    });
  });

  it('update() sets provided fields and leaves others unchanged', () => {
    mqttConfigStore.get();
    mqttConfigStore.update({ enabled: true, host: 'broker.local', port: 1884 });
    const config = mqttConfigStore.get();
    expect(config.enabled).toBe(1);
    expect(config.host).toBe('broker.local');
    expect(config.port).toBe(1884);
    expect(config.topic_prefix).toBe('weartrack');
  });

  it(
    'update() with an empty-string password leaves the stored ' +
      'password unchanged',
    () => {
      mqttConfigStore.get();
      mqttConfigStore.update({ password: 'secret' });
      mqttConfigStore.update({ password: '' });
      expect(mqttConfigStore.get().password).toBe('secret');
    },
  );

  it(
    'update() with a non-empty password overwrites the stored password',
    () => {
    mqttConfigStore.get();
    mqttConfigStore.update({ password: 'secret' });
    mqttConfigStore.update({ password: 'new-secret' });
    expect(mqttConfigStore.get().password).toBe('new-secret');
    },
  );

  it(
    'update() with a null password leaves the stored password unchanged',
    () => {
    mqttConfigStore.get();
    mqttConfigStore.update({ password: 'secret' });
    // @ts-expect-error -- exercising a runtime guard against a value the HTTP
    // boundary isn't statically typed against
    mqttConfigStore.update({ password: null });
    expect(mqttConfigStore.get().password).toBe('secret');
    },
  );
});
