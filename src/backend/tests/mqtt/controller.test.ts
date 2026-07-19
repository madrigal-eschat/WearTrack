import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import app from '../../src/server.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { dbExport } from '../../src/db/index.js';

const MQTT = '/api/mqtt';

beforeAll(() => {
  runMigrations();
});

beforeEach(() => {
  dbExport.exec('DELETE FROM mqtt_config;');
});

describe('GET /api/mqtt/config', () => {
  it('returns the default disabled config with hasPassword false', async () => {
    const res = await app.request(`${MQTT}/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      enabled: false, host: null, port: 1883, username: null,
      hasPassword: false, topic_prefix: 'weartrack', ha_discovery_enabled: false,
    });
    expect(body).not.toHaveProperty('password');
  });
});

describe('PUT /api/mqtt/config', () => {
  it('saves the provided fields and returns them back', async () => {
    const res = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, host: 'broker.local', port: 1884, topic_prefix: 'home' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enabled: true, host: 'broker.local', port: 1884, topic_prefix: 'home' });
  });

  it('reports hasPassword true after a password is saved, without echoing it', async () => {
    await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    });
    const res = await app.request(`${MQTT}/config`);
    const body = await res.json();
    expect(body.hasPassword).toBe(true);
    expect(body).not.toHaveProperty('password');
  });

  it('returns 400 when port is not a number', async () => {
    const res = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 'not-a-number' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when port is outside the valid TCP port range', async () => {
    const tooLow = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 0 }),
    });
    expect(tooLow.status).toBe(400);

    const tooHigh = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 70000 }),
    });
    expect(tooHigh.status).toBe(400);
  });

  it('returns 400 when topic_prefix is an empty string', async () => {
    const res = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_prefix: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('leaves the stored password unchanged when password is explicitly null', async () => {
    await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    });
    const res = await app.request(`${MQTT}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: null }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasPassword).toBe(true);
  });
});
