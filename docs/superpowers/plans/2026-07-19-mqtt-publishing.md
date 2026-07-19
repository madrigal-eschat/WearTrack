# MQTT Config & Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MQTT broker configuration to the Settings panel and publish JSON messages to the broker on session start/end, rest start/end, and decay start/finish, plus optional Home Assistant MQTT discovery. This is PR 2 of 2 — it depends on PR 1 (`docs/superpowers/plans/2026-07-19-events-bus-and-notifications-refactor.md`), which must be merged first: it provides `src/backend/src/events/bus.ts` (`eventBus`, `EventName`, `EventPayloads`) and `src/backend/src/events/poller.ts` (`tick()`), both extended by this plan.

**Architecture:** New `src/backend/src/mqtt/` module: `config-store.ts` (single-row DB config), `client.ts` (persistent `mqtt` npm client, connect/publish/status), `events.ts` (pure JSON payload builders), `subscriber.ts` (bus listeners → publish), `discovery.ts` (Home Assistant discovery, driven by a new `poller_tick` bus event). `controllers/mqtt.ts` exposes `GET`/`PUT /api/mqtt/config`. Frontend gets a `useMqtt.ts` composable and a new MQTT section in `Settings.vue`, following the existing push-notification toggle pattern.

**Tech Stack:** TypeScript, Hono, better-sqlite3, Vitest, Vue 3, Konsta UI. New dependency: `mqtt` (npm).

## Global Constraints

- Depends on PR 1 being merged: `eventBus`/`EventName`/`EventPayloads` from `src/backend/src/events/bus.ts`, `tick()`/`startEventsPoller()` from `src/backend/src/events/poller.ts`.
- Plain `mqtt://` only — no TLS/`mqtts://` support in this PR.
- QoS 0, not retained for event messages. Home Assistant discovery config topics and the per-category `state` topic are retained (the one exception).
- The MQTT password field is write-only: `GET /api/mqtt/config` never returns the real password value.
- No item context (`item_id`/`item_name`/`difficulty_multiplier`) is available for category-scoped events (`rest_start`, `rest_end`, `decay_start`, `decay_finish`) — there is no "current item" during rest/decay, so these fields are `null` on those four event payloads. They are populated (via `itemStore.find`) on `session_start`/`session_end`, which carry a real `item_id` from the bus.
- Frontend composables in this codebase are unit-tested directly (no Vue component-mount tests exist for any form component); follow that convention — test `useMqtt.ts` as a plain function, not by mounting `Settings.vue`.

---

### Task 1: Add the `mqtt` dependency

**Files:**
- Modify: `src/backend/package.json`

- [ ] **Step 1: Install the dependency**

Run: `npm --prefix src/backend install mqtt@^5`
Expected: `package.json`'s `dependencies` gains `"mqtt": "^5.x.x"` and `package-lock.json` updates.

- [ ] **Step 2: Verify the install**

Run: `npm --prefix src/backend run build`
Expected: PASS — `tsc` finds the package's bundled type declarations with no error.

- [ ] **Step 3: Commit**

```bash
git add src/backend/package.json src/backend/package-lock.json
git commit -m "chore(backend): add mqtt client dependency"
```

---

### Task 2: Migration 010 — `mqtt_config` table

**Files:**
- Create: `src/backend/src/db/migrations/010_mqtt_config.ts`
- Modify: `src/backend/src/db/migrations/index.ts`
- Test: `src/backend/tests/db/migration-010.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/db/migration-010.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { dbExport } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrations/index.js';

beforeAll(() => {
  runMigrations();
});

describe('migration 010', () => {
  it('creates mqtt_config table with all columns', () => {
    const cols = (
      dbExport.prepare('PRAGMA table_info(mqtt_config)').all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id', 'enabled', 'host', 'port', 'username', 'password', 'topic_prefix', 'ha_discovery_enabled',
      ]),
    );
  });

  it('only allows a single row (id = 1)', () => {
    dbExport.prepare(
      `INSERT INTO mqtt_config (id, enabled, host, port, username, password, topic_prefix, ha_discovery_enabled)
       VALUES (1, 0, NULL, 1883, NULL, NULL, 'weartrack', 0)`,
    ).run();
    expect(() =>
      dbExport.prepare(
        `INSERT INTO mqtt_config (id, enabled, host, port, username, password, topic_prefix, ha_discovery_enabled)
         VALUES (2, 0, NULL, 1883, NULL, NULL, 'weartrack', 0)`,
      ).run(),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- migration-010`
Expected: FAIL — `no such table: mqtt_config`.

- [ ] **Step 3: Write the migration**

```typescript
// src/backend/src/db/migrations/010_mqtt_config.ts
import { dbExport } from '../index.js';

export default function runMigration010() {
  dbExport.exec(`
    CREATE TABLE mqtt_config (
      id                   INTEGER PRIMARY KEY CHECK (id = 1),
      enabled              INTEGER NOT NULL DEFAULT 0,
      host                 TEXT,
      port                 INTEGER NOT NULL DEFAULT 1883,
      username             TEXT,
      password             TEXT,
      topic_prefix         TEXT NOT NULL DEFAULT 'weartrack',
      ha_discovery_enabled INTEGER NOT NULL DEFAULT 0
    );
  `);
}
```

- [ ] **Step 4: Register the migration**

In `src/backend/src/db/migrations/index.ts`, add:

```typescript
import runMigration010 from './010_mqtt_config.js';
```

```typescript
  { version: 10, name: '010_mqtt_config', run: runMigration010 },
```

(After the `009_events_bus` entry from PR 1.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- migration-010`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/db/migrations/010_mqtt_config.ts src/backend/src/db/migrations/index.ts src/backend/tests/db/migration-010.test.ts
git commit -m "feat(backend): add mqtt_config table"
```

---

### Task 3: `mqtt/config-store.ts`

**Files:**
- Create: `src/backend/src/mqtt/config-store.ts`
- Test: `src/backend/tests/mqtt/config-store.test.ts`

**Interfaces:**
- Produces: `mqttConfigStore` (singleton) with `get(): MqttConfig` (creates and returns a default disabled row if none exists) and `update(data: MqttConfigUpdate): MqttConfig`. `MqttConfig`/`MqttConfigUpdate` types — consumed by `controllers/mqtt.ts` (Task 5), `client.ts` (Task 4), `subscriber.ts` (Task 7), `discovery.ts` (Task 9).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/mqtt/config-store.test.ts
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
      id: 1, enabled: 0, host: null, port: 1883, username: null, password: null,
      topic_prefix: 'weartrack', ha_discovery_enabled: 0,
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

  it('update() with an empty-string password leaves the stored password unchanged', () => {
    mqttConfigStore.get();
    mqttConfigStore.update({ password: 'secret' });
    mqttConfigStore.update({ password: '' });
    expect(mqttConfigStore.get().password).toBe('secret');
  });

  it('update() with a non-empty password overwrites the stored password', () => {
    mqttConfigStore.get();
    mqttConfigStore.update({ password: 'secret' });
    mqttConfigStore.update({ password: 'new-secret' });
    expect(mqttConfigStore.get().password).toBe('new-secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- mqtt/config-store`
Expected: FAIL — cannot find module `../../src/mqtt/config-store.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/mqtt/config-store.ts
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
  password?: string;
  topic_prefix?: string;
  ha_discovery_enabled?: boolean;
}

class MqttConfigStore {
  get(): MqttConfig {
    const row = db.prepare('SELECT * FROM mqtt_config WHERE id = 1').get() as MqttConfig | undefined;
    if (row) return row;
    db.prepare(
      `INSERT INTO mqtt_config (id, enabled, host, port, username, password, topic_prefix, ha_discovery_enabled)
       VALUES (1, 0, NULL, 1883, NULL, NULL, 'weartrack', 0)`,
    ).run();
    return db.prepare('SELECT * FROM mqtt_config WHERE id = 1').get() as MqttConfig;
  }

  update(data: MqttConfigUpdate): MqttConfig {
    this.get();
    const dbData: Record<string, unknown> = {};
    if (data.enabled !== undefined) dbData.enabled = data.enabled ? 1 : 0;
    if (data.host !== undefined) dbData.host = data.host;
    if (data.port !== undefined) dbData.port = data.port;
    if (data.username !== undefined) dbData.username = data.username;
    if (data.password !== undefined && data.password !== '') dbData.password = data.password;
    if (data.topic_prefix !== undefined) dbData.topic_prefix = data.topic_prefix;
    if (data.ha_discovery_enabled !== undefined) dbData.ha_discovery_enabled = data.ha_discovery_enabled ? 1 : 0;

    const entries = Object.entries(dbData);
    if (entries.length > 0) {
      const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE mqtt_config SET ${setClauses} WHERE id = 1`).run(...entries.map(([, v]) => v));
    }
    return this.get();
  }
}

export const mqttConfigStore = new MqttConfigStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- mqtt/config-store`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/mqtt/config-store.ts src/backend/tests/mqtt/config-store.test.ts
git commit -m "feat(backend): add mqtt_config single-row store"
```

---

### Task 4: `mqtt/client.ts`

**Files:**
- Create: `src/backend/src/mqtt/client.ts`
- Test: `src/backend/tests/mqtt/client.test.ts`

**Interfaces:**
- Consumes: the `mqtt` npm package (mocked in tests via `vi.mock('mqtt', ...)`).
- Produces: `connect(config)`, `disconnect()`, `publish(topic, payload, opts?)`, `getStatus(): ConnectionStatus`, `initMqtt()`, `reloadFromConfig()` — consumed by `controllers/mqtt.ts` (Task 5), `subscriber.ts` (Task 7), `discovery.ts` (Task 9), and `server.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/mqtt/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeClient = {
  on: vi.fn(),
  publish: vi.fn(),
  end: vi.fn(),
};

vi.mock('mqtt', () => ({
  default: { connect: vi.fn(() => fakeClient) },
}));

import mqtt from 'mqtt';
import { connect, disconnect, publish, getStatus } from '../../src/mqtt/client.js';

beforeEach(() => {
  vi.clearAllMocks();
  disconnect();
});

describe('mqtt client', () => {
  it('connects with the given host/port and sets status to connecting', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    expect(mqtt.connect).toHaveBeenCalledWith(
      'mqtt://broker.local:1883',
      expect.objectContaining({ username: undefined, password: undefined }),
    );
    expect(getStatus()).toBe('connecting');
  });

  it('passes username/password through when set', () => {
    connect({ host: 'broker.local', port: 1883, username: 'alice', password: 'secret' });
    expect(mqtt.connect).toHaveBeenCalledWith(
      'mqtt://broker.local:1883',
      expect.objectContaining({ username: 'alice', password: 'secret' }),
    );
  });

  it('updates status to connected when the client emits connect', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const connectHandler = fakeClient.on.mock.calls.find(([event]) => event === 'connect')![1];
    connectHandler();
    expect(getStatus()).toBe('connected');
  });

  it('updates status to error when the client emits error', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    const errorHandler = fakeClient.on.mock.calls.find(([event]) => event === 'error')![1];
    errorHandler(new Error('boom'));
    expect(getStatus()).toBe('error');
  });

  it('publish() sends JSON with qos 0 by default and does nothing before connect', () => {
    publish('weartrack/gloves/session_start', { event: 'session_start' });
    expect(fakeClient.publish).not.toHaveBeenCalled();

    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    publish('weartrack/gloves/session_start', { event: 'session_start' });
    expect(fakeClient.publish).toHaveBeenCalledWith(
      'weartrack/gloves/session_start',
      JSON.stringify({ event: 'session_start' }),
      { qos: 0, retain: false },
    );
  });

  it('publish() honors the retain option', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    publish('weartrack/gloves/state', { event: 'x' }, { retain: true });
    expect(fakeClient.publish).toHaveBeenCalledWith(
      'weartrack/gloves/state',
      JSON.stringify({ event: 'x' }),
      { qos: 0, retain: true },
    );
  });

  it('disconnect() ends the client and sets status to disconnected', () => {
    connect({ host: 'broker.local', port: 1883, username: null, password: null });
    disconnect();
    expect(fakeClient.end).toHaveBeenCalledWith(true);
    expect(getStatus()).toBe('disconnected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- mqtt/client`
Expected: FAIL — cannot find module `../../src/mqtt/client.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/mqtt/client.ts
import mqtt, { type MqttClient } from 'mqtt';
import { mqttConfigStore } from './config-store.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

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
  client = mqtt.connect(`mqtt://${config.host}:${config.port}`, {
    username: config.username ?? undefined,
    password: config.password ?? undefined,
  });
  client.on('connect', () => {
    status = 'connected';
  });
  client.on('close', () => {
    status = 'disconnected';
  });
  client.on('error', () => {
    status = 'error';
  });
}

export function publish(topic: string, payload: unknown, opts: { retain?: boolean } = {}): void {
  if (!client) return;
  client.publish(topic, JSON.stringify(payload), { qos: 0, retain: opts.retain ?? false });
}

export function reloadFromConfig(): void {
  const config = mqttConfigStore.get();
  if (config.enabled && config.host) {
    connect({ host: config.host, port: config.port, username: config.username, password: config.password });
  } else {
    disconnect();
  }
}

export function initMqtt(): void {
  reloadFromConfig();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- mqtt/client`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/mqtt/client.ts src/backend/tests/mqtt/client.test.ts
git commit -m "feat(backend): add persistent mqtt client wrapper"
```

---

### Task 5: `controllers/mqtt.ts` + wire into `server.ts`

**Files:**
- Create: `src/backend/src/controllers/mqtt.ts`
- Modify: `src/backend/src/server.ts`
- Test: `src/backend/tests/mqtt/controller.test.ts`

**Interfaces:**
- Consumes: `mqttConfigStore` (Task 3), `getStatus`/`reloadFromConfig`/`initMqtt` (Task 4).
- Produces: `router` (Hono), mounted at `/api/mqtt`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/mqtt/controller.test.ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- mqtt/controller`
Expected: FAIL — 404 (route not mounted, module doesn't exist).

- [ ] **Step 3: Write `controllers/mqtt.ts`**

```typescript
// src/backend/src/controllers/mqtt.ts
import { Hono } from 'hono';
import { mqttConfigStore } from '../mqtt/config-store.js';
import { getStatus, reloadFromConfig } from '../mqtt/client.js';
import { ValidationError } from '../middleware/errors.js';

function toResponseBody(status: ReturnType<typeof getStatus>) {
  const config = mqttConfigStore.get();
  return {
    enabled: Boolean(config.enabled),
    host: config.host,
    port: config.port,
    username: config.username,
    hasPassword: config.password !== null && config.password !== '',
    topic_prefix: config.topic_prefix,
    ha_discovery_enabled: Boolean(config.ha_discovery_enabled),
    status,
  };
}

export const router = new Hono();

router.get('/config', (c) => {
  return c.json(toResponseBody(getStatus()));
});

router.put('/config', async (c) => {
  const body = await c.req.json();
  if (body.port !== undefined && typeof body.port !== 'number') {
    throw new ValidationError('port must be a number');
  }
  mqttConfigStore.update({
    enabled: body.enabled,
    host: body.host,
    port: body.port,
    username: body.username,
    password: body.password,
    topic_prefix: body.topic_prefix,
    ha_discovery_enabled: body.ha_discovery_enabled,
  });
  reloadFromConfig();
  return c.json(toResponseBody(getStatus()));
});
```

- [ ] **Step 4: Wire into `server.ts`**

In `src/backend/src/server.ts`, add the import alongside the other controllers:

```typescript
import { router as mqttRouter } from './controllers/mqtt.js';
```

Add the route mount alongside the others:

```typescript
app.route('/api/mqtt', mqttRouter);
```

Add the `initMqtt()` import and call alongside `startEventsPoller()` (from PR 1):

```typescript
import { initMqtt } from './mqtt/client.js';
```

```typescript
runMigrations();
startScheduler();
startEventsPoller();
initMqtt();
```

Add `mqtt_config` to the test-only `__reset` endpoint's `DELETE` list (so tests start from a clean config each run, matching every other table there):

```typescript
      DELETE FROM push_subscriptions;
      DELETE FROM event_poller_state;
      DELETE FROM mqtt_config;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- mqtt/controller`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/controllers/mqtt.ts src/backend/src/server.ts src/backend/tests/mqtt/controller.test.ts
git commit -m "feat(backend): add GET/PUT /api/mqtt/config, wire initMqtt into server boot"
```

---

### Task 6: `mqtt/events.ts` — payload builders

**Files:**
- Create: `src/backend/src/mqtt/events.ts`
- Test: `src/backend/tests/mqtt/events.test.ts`

**Interfaces:**
- Produces: `slugify(name: string): string`, `buildSessionStartPayload`, `buildSessionEndPayload`, `buildRestStartPayload`, `buildRestEndPayload`, `buildDecayStartPayload`, `buildDecayFinishPayload` — all pure, consumed by `subscriber.ts` (Task 7).

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/mqtt/events.test.ts
import { describe, it, expect } from 'vitest';
import {
  slugify, buildSessionStartPayload, buildSessionEndPayload, buildRestStartPayload,
  buildRestEndPayload, buildDecayStartPayload, buildDecayFinishPayload,
} from '../../src/mqtt/events.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Winter Gloves')).toBe('winter-gloves');
  });
  it('strips non-alphanumeric characters', () => {
    expect(slugify("Cat's & Co.")).toBe('cat-s-co');
  });
  it('trims leading/trailing hyphens', () => {
    expect(slugify('--Test--')).toBe('test');
  });
});

const baseCtx = {
  category_id: 1, category_name: 'Footwear', item_id: 2, item_name: 'Test Shoe',
  difficulty_multiplier: 1.0, target_wear_seconds: 900, max_wear_seconds: 1800, timestamp: 1_700_000_000,
};

describe('buildSessionStartPayload', () => {
  it('includes common fields, session_id, and an ISO timestamp', () => {
    const payload = buildSessionStartPayload({ ...baseCtx, session_id: 42 });
    expect(payload).toMatchObject({
      event: 'session_start', category_id: 1, category_name: 'Footwear', item_id: 2, item_name: 'Test Shoe',
      difficulty_modifier: 1.0, target_wear_seconds: 900, max_wear_seconds: 1800, session_id: 42,
    });
    expect(payload.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
});

describe('buildSessionEndPayload', () => {
  it('includes actual_duration_seconds, rest_seconds, risk_level', () => {
    const payload = buildSessionEndPayload({
      ...baseCtx, session_id: 42, actual_duration_seconds: 1000, rest_seconds: 6000, risk_level: 'moderate',
    });
    expect(payload).toMatchObject({
      event: 'session_end', session_id: 42, actual_duration_seconds: 1000, rest_seconds: 6000, risk_level: 'moderate',
    });
  });
});

describe('buildRestStartPayload / buildRestEndPayload', () => {
  it('rest_start has rest_seconds and null item fields when the context has none', () => {
    const payload = buildRestStartPayload({
      ...baseCtx, item_id: null, item_name: null, difficulty_multiplier: null, rest_seconds: 6000,
    });
    expect(payload).toMatchObject({ event: 'rest_start', rest_seconds: 6000, item_id: null, item_name: null });
  });

  it('rest_end has rest_seconds and elapsed_rest_seconds', () => {
    const payload = buildRestEndPayload({
      ...baseCtx, item_id: null, item_name: null, difficulty_multiplier: null,
      rest_seconds: 6000, elapsed_rest_seconds: 6000,
    });
    expect(payload).toMatchObject({ event: 'rest_end', rest_seconds: 6000, elapsed_rest_seconds: 6000 });
  });
});

describe('buildDecayStartPayload / buildDecayFinishPayload', () => {
  it('decay_start has decay_state and an ISO decay_full_time', () => {
    const payload = buildDecayStartPayload({
      ...baseCtx, item_id: null, item_name: null, difficulty_multiplier: null,
      decay_state: 'decaying', decay_full_time: 1_700_100_000,
    });
    expect(payload.decay_state).toBe('decaying');
    expect(payload.decay_full_time).toBe(new Date(1_700_100_000 * 1000).toISOString());
  });

  it('decay_finish always reports fully_decayed and 100%', () => {
    const payload = buildDecayFinishPayload({
      ...baseCtx, item_id: null, item_name: null, difficulty_multiplier: null,
    });
    expect(payload.decay_state).toBe('fully_decayed');
    expect(payload.decay_percentage).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- mqtt/events`
Expected: FAIL — cannot find module `../../src/mqtt/events.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/mqtt/events.ts
export interface EventContext {
  category_id: number;
  category_name: string;
  item_id: number | null;
  item_name: string | null;
  difficulty_multiplier: number | null;
  target_wear_seconds: number | null;
  max_wear_seconds: number | null;
  timestamp: number;
}

function base(event: string, ctx: EventContext) {
  return {
    event,
    timestamp: new Date(ctx.timestamp * 1000).toISOString(),
    category_id: ctx.category_id,
    category_name: ctx.category_name,
    item_id: ctx.item_id,
    item_name: ctx.item_name,
    target_wear_seconds: ctx.target_wear_seconds,
    max_wear_seconds: ctx.max_wear_seconds,
    difficulty_modifier: ctx.difficulty_multiplier,
  };
}

export function buildSessionStartPayload(ctx: EventContext & { session_id: number }) {
  return { ...base('session_start', ctx), session_id: ctx.session_id };
}

export function buildSessionEndPayload(
  ctx: EventContext & {
    session_id: number;
    actual_duration_seconds: number;
    rest_seconds: number;
    risk_level: string | null;
  },
) {
  return {
    ...base('session_end', ctx),
    session_id: ctx.session_id,
    actual_duration_seconds: ctx.actual_duration_seconds,
    rest_seconds: ctx.rest_seconds,
    risk_level: ctx.risk_level,
  };
}

export function buildRestStartPayload(ctx: EventContext & { rest_seconds: number }) {
  return { ...base('rest_start', ctx), rest_seconds: ctx.rest_seconds };
}

export function buildRestEndPayload(
  ctx: EventContext & { rest_seconds: number; elapsed_rest_seconds: number },
) {
  return {
    ...base('rest_end', ctx),
    rest_seconds: ctx.rest_seconds,
    elapsed_rest_seconds: ctx.elapsed_rest_seconds,
  };
}

export function buildDecayStartPayload(
  ctx: EventContext & { decay_state: 'decaying' | 'fully_decayed'; decay_full_time: number },
) {
  return {
    ...base('decay_start', ctx),
    decay_state: ctx.decay_state,
    decay_full_time: new Date(ctx.decay_full_time * 1000).toISOString(),
  };
}

export function buildDecayFinishPayload(ctx: EventContext) {
  return { ...base('decay_finish', ctx), decay_state: 'fully_decayed' as const, decay_percentage: 100 };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- mqtt/events`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/backend/src/mqtt/events.ts src/backend/tests/mqtt/events.test.ts
git commit -m "feat(backend): add mqtt payload builders"
```

---

### Task 7: `mqtt/subscriber.ts` — bus listeners → publish

**Files:**
- Create: `src/backend/src/mqtt/subscriber.ts`
- Modify: `src/backend/src/server.ts`
- Test: `src/backend/tests/mqtt/subscriber.test.ts`

**Interfaces:**
- Consumes: `eventBus` (PR 1's `events/bus.js`), `itemStore.find` (`../db/stores/item-store.js`), `sessionStore.findLastEndedInCategory` (`../db/stores/session-store.js`), `mqttConfigStore.get` (Task 3), `publish` (Task 4), the six `build*Payload` functions + `slugify` (Task 6).
- Produces: `startMqttSubscriber(): void`, called from `server.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/mqtt/subscriber.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakePublish = vi.fn();
vi.mock('../../src/mqtt/client.js', () => ({ publish: fakePublish }));

import { eventBus } from '../../src/events/bus.js';
import { mqttConfigStore } from '../../src/mqtt/config-store.js';
import { itemStore } from '../../src/db/stores/item-store.js';
import { sessionStore } from '../../src/db/stores/session-store.js';
import { startMqttSubscriber } from '../../src/mqtt/subscriber.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
    id: 1, enabled: 1, host: 'broker.local', port: 1883, username: null, password: null,
    topic_prefix: 'weartrack', ha_discovery_enabled: 0,
  });
  vi.spyOn(itemStore, 'find').mockReturnValue({
    id: 2, category_id: 1, name: 'Test Shoe', color: '#fff', difficulty_multiplier: 1.0,
  });
  vi.spyOn(sessionStore, 'findLastEndedInCategory').mockReturnValue({
    target_wear_seconds: 900, max_wear_seconds: 1800, ended_at: 500, started_at: 0, rest_seconds: 6000,
  });
  startMqttSubscriber();
});

describe('mqtt subscriber', () => {
  it('publishes session_start to the event topic and the retained state topic', () => {
    eventBus.emit('session_start', {
      category_id: 1, category_name: 'Footwear', timestamp: 1000, session_id: 5,
      item_id: 2, target_wear_seconds: 900, max_wear_seconds: 1800,
    });
    expect(fakePublish).toHaveBeenCalledWith(
      'weartrack/footwear/session_start',
      expect.objectContaining({ event: 'session_start', item_name: 'Test Shoe' }),
      { retain: false },
    );
    expect(fakePublish).toHaveBeenCalledWith(
      'weartrack/footwear/state',
      expect.objectContaining({ event: 'session_start' }),
      { retain: true },
    );
  });

  it('publishes rest_start with null item fields', () => {
    eventBus.emit('rest_start', {
      category_id: 1, category_name: 'Footwear', timestamp: 1000, rest_seconds: 6000,
    });
    expect(fakePublish).toHaveBeenCalledWith(
      'weartrack/footwear/rest_start',
      expect.objectContaining({ event: 'rest_start', item_id: null, item_name: null }),
      { retain: false },
    );
  });

  it('does not publish when mqtt is disabled', () => {
    vi.mocked(mqttConfigStore.get).mockReturnValue({
      id: 1, enabled: 0, host: 'broker.local', port: 1883, username: null, password: null,
      topic_prefix: 'weartrack', ha_discovery_enabled: 0,
    });
    eventBus.emit('decay_finish', { category_id: 1, category_name: 'Footwear', timestamp: 1000 });
    expect(fakePublish).not.toHaveBeenCalled();
  });

  it('does not subscribe to notification-only events (target_met has no publish)', () => {
    eventBus.emit('target_met', { category_id: 1, category_name: 'Footwear', timestamp: 1000, session_id: 5 });
    expect(fakePublish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- mqtt/subscriber`
Expected: FAIL — cannot find module `../../src/mqtt/subscriber.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/mqtt/subscriber.ts
import { eventBus } from '../events/bus.js';
import { itemStore } from '../db/stores/item-store.js';
import { sessionStore } from '../db/stores/session-store.js';
import { mqttConfigStore } from './config-store.js';
import { publish } from './client.js';
import {
  buildSessionStartPayload,
  buildSessionEndPayload,
  buildRestStartPayload,
  buildRestEndPayload,
  buildDecayStartPayload,
  buildDecayFinishPayload,
  slugify,
} from './events.js';

function publishEvent(categoryName: string, event: string, payload: unknown): void {
  const config = mqttConfigStore.get();
  if (!config.enabled) return;
  const slug = slugify(categoryName);
  publish(`${config.topic_prefix}/${slug}/${event}`, payload, { retain: false });
  publish(`${config.topic_prefix}/${slug}/state`, payload, { retain: true });
}

export function startMqttSubscriber(): void {
  eventBus.on('session_start', (p) => {
    const item = itemStore.find(p.item_id);
    const payload = buildSessionStartPayload({
      category_id: p.category_id,
      category_name: p.category_name,
      item_id: p.item_id,
      item_name: item?.name ?? null,
      difficulty_multiplier: item?.difficulty_multiplier ?? null,
      target_wear_seconds: p.target_wear_seconds,
      max_wear_seconds: p.max_wear_seconds,
      timestamp: p.timestamp,
      session_id: p.session_id,
    });
    publishEvent(p.category_name, 'session_start', payload);
  });

  eventBus.on('session_end', (p) => {
    const item = itemStore.find(p.item_id);
    const payload = buildSessionEndPayload({
      category_id: p.category_id,
      category_name: p.category_name,
      item_id: p.item_id,
      item_name: item?.name ?? null,
      difficulty_multiplier: item?.difficulty_multiplier ?? null,
      target_wear_seconds: p.target_wear_seconds,
      max_wear_seconds: p.max_wear_seconds,
      timestamp: p.timestamp,
      session_id: p.session_id,
      actual_duration_seconds: p.actual_duration_seconds,
      rest_seconds: p.rest_seconds,
      risk_level: p.risk_level,
    });
    publishEvent(p.category_name, 'session_end', payload);
  });

  eventBus.on('rest_start', (p) => {
    const previous = sessionStore.findLastEndedInCategory(p.category_id);
    const payload = buildRestStartPayload({
      category_id: p.category_id,
      category_name: p.category_name,
      item_id: null,
      item_name: null,
      difficulty_multiplier: null,
      target_wear_seconds: previous?.target_wear_seconds ?? null,
      max_wear_seconds: previous?.max_wear_seconds ?? null,
      timestamp: p.timestamp,
      rest_seconds: p.rest_seconds,
    });
    publishEvent(p.category_name, 'rest_start', payload);
  });

  eventBus.on('rest_end', (p) => {
    const previous = sessionStore.findLastEndedInCategory(p.category_id);
    const payload = buildRestEndPayload({
      category_id: p.category_id,
      category_name: p.category_name,
      item_id: null,
      item_name: null,
      difficulty_multiplier: null,
      target_wear_seconds: previous?.target_wear_seconds ?? null,
      max_wear_seconds: previous?.max_wear_seconds ?? null,
      timestamp: p.timestamp,
      rest_seconds: p.rest_seconds,
      elapsed_rest_seconds: p.elapsed_rest_seconds,
    });
    publishEvent(p.category_name, 'rest_end', payload);
  });

  eventBus.on('decay_start', (p) => {
    const previous = sessionStore.findLastEndedInCategory(p.category_id);
    const payload = buildDecayStartPayload({
      category_id: p.category_id,
      category_name: p.category_name,
      item_id: null,
      item_name: null,
      difficulty_multiplier: null,
      target_wear_seconds: previous?.target_wear_seconds ?? null,
      max_wear_seconds: previous?.max_wear_seconds ?? null,
      timestamp: p.timestamp,
      decay_state: p.decay_state,
      decay_full_time: p.decay_full_time,
    });
    publishEvent(p.category_name, 'decay_start', payload);
  });

  eventBus.on('decay_finish', (p) => {
    const previous = sessionStore.findLastEndedInCategory(p.category_id);
    const payload = buildDecayFinishPayload({
      category_id: p.category_id,
      category_name: p.category_name,
      item_id: null,
      item_name: null,
      difficulty_multiplier: null,
      target_wear_seconds: previous?.target_wear_seconds ?? null,
      max_wear_seconds: previous?.max_wear_seconds ?? null,
      timestamp: p.timestamp,
    });
    publishEvent(p.category_name, 'decay_finish', payload);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- mqtt/subscriber`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire into `server.ts`**

Add the import and call, alongside `initMqtt()`:

```typescript
import { startMqttSubscriber } from './mqtt/subscriber.js';
```

```typescript
initMqtt();
startMqttSubscriber();
```

- [ ] **Step 6: Run the full backend suite**

Run: `npm --prefix src/backend run test:ci`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/backend/src/mqtt/subscriber.ts src/backend/src/server.ts src/backend/tests/mqtt/subscriber.test.ts
git commit -m "feat(backend): publish mqtt messages on session/rest/decay bus events"
```

---

### Task 8: Extend the bus with `poller_tick`

**Files:**
- Modify: `src/backend/src/events/bus.ts`
- Modify: `src/backend/src/events/poller.ts`
- Test: `src/backend/tests/events/poller.test.ts` (add one case)

This gives `mqtt/discovery.ts` (Task 9) a way to republish Home Assistant discovery configs every tick without `events/poller.ts` importing anything from the `mqtt/` module — the poller only emits a generic "a tick completed" event; `mqtt/discovery.ts` subscribes to it.

**Interfaces:**
- Produces: a 13th bus event `poller_tick: { timestamp: number }`, emitted once per `tick()` call after all categories are processed.

- [ ] **Step 1: Write the failing test**

Add to `src/backend/tests/events/poller.test.ts`:

```typescript
  it('emits poller_tick once per tick(), after category processing', async () => {
    await setupCategoryAndItem();
    const listener = vi.fn();
    eventBus.on('poller_tick', listener);
    tick(500);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ timestamp: 500 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- events/poller`
Expected: FAIL — `eventBus.on('poller_tick', ...)` — type error / event never fires (undefined event name).

- [ ] **Step 3: Add the event to the bus**

In `src/backend/src/events/bus.ts`, add the payload type:

```typescript
export interface PollerTickEvent {
  timestamp: number;
}
```

And add it to `EventPayloads`:

```typescript
export interface EventPayloads {
  session_start: SessionStartEvent;
  session_end: SessionEndEvent;
  rest_start: RestStartEvent;
  rest_end: RestEndEvent;
  decay_start: DecayStartEvent;
  decay_finish: DecayFinishEvent;
  halfway_reached: HalfwayReachedEvent;
  decay_soon: DecaySoonEvent;
  target_met: SessionThresholdEvent;
  overtime_warning_30: SessionThresholdEvent;
  overtime_warning_5: SessionThresholdEvent;
  overtime: SessionThresholdEvent;
  poller_tick: PollerTickEvent;
}
```

- [ ] **Step 4: Emit it at the end of `tick()`**

In `src/backend/src/events/poller.ts`, at the end of the `tick()` function body (after the `for (const category of categories)` loop, before the closing brace):

```typescript
  eventBus.emit('poller_tick', { timestamp: now });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- events/poller`
Expected: PASS (4 tests, including the new one)

- [ ] **Step 6: Commit**

```bash
git add src/backend/src/events/bus.ts src/backend/src/events/poller.ts src/backend/tests/events/poller.test.ts
git commit -m "feat(backend): add poller_tick bus event for tick-driven subscribers"
```

---

### Task 9: `mqtt/discovery.ts` — Home Assistant discovery

**Files:**
- Create: `src/backend/src/mqtt/discovery.ts`
- Modify: `src/backend/src/server.ts`
- Test: `src/backend/tests/mqtt/discovery.test.ts`

**Interfaces:**
- Consumes: `eventBus` (`poller_tick`), `categoryStore.findAll()` (`../db/stores/category-store.js`), `mqttConfigStore.get()` (Task 3), `publish` (Task 4), `slugify` (Task 6).
- Produces: `startDiscovery(): void`, called from `server.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/backend/tests/mqtt/discovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakePublish = vi.fn();
vi.mock('../../src/mqtt/client.js', () => ({ publish: fakePublish }));

import { eventBus } from '../../src/events/bus.js';
import { mqttConfigStore } from '../../src/mqtt/config-store.js';
import { categoryStore } from '../../src/db/stores/category-store.js';
import { startDiscovery } from '../../src/mqtt/discovery.js';

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
    expect(fakePublish).toHaveBeenCalledWith(
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
    expect(fakePublish).not.toHaveBeenCalled();
  });

  it('publishes nothing when mqtt itself is disabled', () => {
    vi.spyOn(mqttConfigStore, 'get').mockReturnValue({
      id: 1, enabled: 0, host: 'broker.local', port: 1883, username: null, password: null,
      topic_prefix: 'weartrack', ha_discovery_enabled: 1,
    });
    eventBus.emit('poller_tick', { timestamp: 1000 });
    expect(fakePublish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/backend run test -- mqtt/discovery`
Expected: FAIL — cannot find module `../../src/mqtt/discovery.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/backend/src/mqtt/discovery.ts
import { eventBus } from '../events/bus.js';
import { categoryStore } from '../db/stores/category-store.js';
import { mqttConfigStore } from './config-store.js';
import { publish } from './client.js';
import { slugify } from './events.js';

export function startDiscovery(): void {
  eventBus.on('poller_tick', () => {
    const config = mqttConfigStore.get();
    if (!config.enabled || !config.ha_discovery_enabled) return;

    for (const category of categoryStore.findAll()) {
      const slug = slugify(category.name);
      const stateTopic = `${config.topic_prefix}/${slug}/state`;
      publish(
        `homeassistant/sensor/weartrack_${category.id}/config`,
        {
          name: `${category.name} status`,
          unique_id: `weartrack_${category.id}_status`,
          state_topic: stateTopic,
          json_attributes_topic: stateTopic,
          value_template: '{{ value_json.event }}',
        },
        { retain: true },
      );
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/backend run test -- mqtt/discovery`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into `server.ts`**

```typescript
import { startDiscovery } from './mqtt/discovery.js';
```

```typescript
startMqttSubscriber();
startDiscovery();
```

- [ ] **Step 6: Run the full backend suite**

Run: `npm --prefix src/backend run test:ci`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/backend/src/mqtt/discovery.ts src/backend/src/server.ts src/backend/tests/mqtt/discovery.test.ts
git commit -m "feat(backend): publish Home Assistant discovery configs on poller tick"
```

---

### Task 10: `TextField.vue` — add a `type` prop for the password field

**Files:**
- Modify: `src/frontend/src/components/TextField.vue`

The MQTT settings form (Task 12) needs a password input; `TextField.vue` currently hardcodes `type="text"`.

- [ ] **Step 1: Modify the component**

```vue
<!-- src/frontend/src/components/TextField.vue -->
<template>
  <div>
    <label v-if="label" :for="id" class="block text-sm font-medium text-gray-700 mb-1">{{ label }}</label>
    <input
      :id="id"
      :value="modelValue"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{ id?: string; label?: string; modelValue: string; placeholder?: string; type?: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
```

- [ ] **Step 2: Verify existing usages are unaffected**

Run: `npm --prefix src/frontend run build`
Expected: PASS — `type` is optional, every existing `<TextField>` usage (e.g. `CategoryForm.vue`) omits it and still defaults to `'text'`.

- [ ] **Step 3: Commit**

```bash
git add src/frontend/src/components/TextField.vue
git commit -m "feat(frontend): add optional type prop to TextField for password inputs"
```

---

### Task 11: `useMqtt.ts` composable

**Files:**
- Create: `src/frontend/src/composables/useMqtt.ts`
- Test: `src/frontend/src/composables/useMqtt.test.ts`

**Interfaces:**
- Consumes: `apiFetch` from `../utils/apiFetch.js`.
- Produces: `useMqtt()` returning `{ config, status, loading, init, save }` — consumed by `Settings.vue` (Task 12).

- [ ] **Step 1: Write the failing test**

```typescript
// src/frontend/src/composables/useMqtt.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMqtt } from './useMqtt.js';

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

const DEFAULT_CONFIG = {
  enabled: false, host: null, port: 1883, username: null, hasPassword: false,
  topic_prefix: 'weartrack', ha_discovery_enabled: false, status: 'disconnected',
};

describe('useMqtt', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('init() loads config from GET /api/mqtt/config', async () => {
    mockFetchOnce(DEFAULT_CONFIG);
    const { config, init } = useMqtt();
    await init();
    expect(config.value).toEqual(DEFAULT_CONFIG);
    expect(global.fetch).toHaveBeenCalledWith('/api/mqtt/config', { redirect: 'manual' });
  });

  it('save() PUTs the current config and updates state from the response', async () => {
    mockFetchOnce(DEFAULT_CONFIG);
    const { config, init, save } = useMqtt();
    await init();

    config.value.enabled = true;
    config.value.host = 'broker.local';
    mockFetchOnce({ ...DEFAULT_CONFIG, enabled: true, host: 'broker.local', status: 'connecting' });
    await save();

    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/mqtt/config',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'manual',
      }),
    );
    expect(config.value.status).toBe('connecting');
  });

  it('save() sends the password field only when the user typed one', async () => {
    mockFetchOnce(DEFAULT_CONFIG);
    const { config, init, save, password } = useMqtt();
    await init();

    password.value = 'my-secret';
    mockFetchOnce({ ...DEFAULT_CONFIG, hasPassword: true });
    await save();

    const [, requestInit] = vi.mocked(global.fetch).mock.calls[1];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.password).toBe('my-secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/frontend run test -- useMqtt`
Expected: FAIL — cannot find module `./useMqtt.js`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/frontend/src/composables/useMqtt.ts
import { ref } from 'vue';
import { apiFetch } from '../utils/apiFetch.js';

export interface MqttConfigState {
  enabled: boolean;
  host: string | null;
  port: number;
  username: string | null;
  hasPassword: boolean;
  topic_prefix: string;
  ha_discovery_enabled: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
}

const DEFAULT_CONFIG: MqttConfigState = {
  enabled: false, host: null, port: 1883, username: null, hasPassword: false,
  topic_prefix: 'weartrack', ha_discovery_enabled: false, status: 'disconnected',
};

export function useMqtt() {
  const config = ref<MqttConfigState>({ ...DEFAULT_CONFIG });
  const password = ref('');
  const loading = ref(false);

  async function init(): Promise<void> {
    loading.value = true;
    try {
      const res = await apiFetch('/api/mqtt/config');
      if (res.ok) config.value = (await res.json()) as MqttConfigState;
    } finally {
      loading.value = false;
    }
  }

  async function save(): Promise<void> {
    loading.value = true;
    try {
      const body: Record<string, unknown> = {
        enabled: config.value.enabled,
        host: config.value.host,
        port: config.value.port,
        username: config.value.username,
        topic_prefix: config.value.topic_prefix,
        ha_discovery_enabled: config.value.ha_discovery_enabled,
      };
      if (password.value !== '') body.password = password.value;

      const res = await apiFetch('/api/mqtt/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        config.value = (await res.json()) as MqttConfigState;
        password.value = '';
      }
    } finally {
      loading.value = false;
    }
  }

  return { config, password, loading, init, save };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/frontend run test -- useMqtt`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/frontend/src/composables/useMqtt.ts src/frontend/src/composables/useMqtt.test.ts
git commit -m "feat(frontend): add useMqtt composable for the settings panel"
```

---

### Task 12: MQTT section in `Settings.vue`

**Files:**
- Modify: `src/frontend/src/views/Settings.vue`

**Interfaces:**
- Consumes: `useMqtt()` (Task 11), `TextField` (Task 10), `NumberField` (existing), `FormCard` (existing), `kToggle`/`kList`/`kListItem` (Konsta UI, already imported elsewhere in this file).

- [ ] **Step 1: Modify the file**

```vue
<!-- src/frontend/src/views/Settings.vue -->
<template>
  <k-page style="padding-bottom: 56px">
    <PageHeader title="Settings" showBack @back="router.push('/')" />
    <div class="px-4 py-4">
      <p class="text-sm text-gray-500 text-center">
        Manage categories and items from the <strong>Items</strong> tab.
      </p>

      <div class="mt-4">
        <p v-if="!isSupported" class="text-sm text-gray-400 text-center">
          Push notifications are not supported in this browser.
        </p>
        <p v-else-if="!isConfigured" class="text-sm text-amber-600 text-center">
          Push notifications are not configured on the server.
        </p>
        <k-list v-else>
          <k-list-item
            title="Push notifications"
            :after="isSubscribed ? 'On' : 'Off'"
          >
            <template #after>
              <k-toggle :checked="isSubscribed" @change="onToggle" />
            </template>
          </k-list-item>
        </k-list>
      </div>

      <div class="mt-6">
        <h2 class="text-sm font-semibold text-gray-700 px-1 mb-1">MQTT</h2>
        <FormCard>
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700">Enable MQTT</span>
            <k-toggle :checked="mqttConfig.enabled" @change="mqttConfig.enabled = !mqttConfig.enabled" />
          </div>

          <TextField id="mqtt-host" label="Host" v-model="mqttHost" placeholder="broker.local" />
          <NumberField id="mqtt-port" label="Port" v-model="mqttConfig.port" :min="1" :max="65535" :default="1883" />
          <TextField id="mqtt-username" label="Username (optional)" v-model="mqttUsername" />
          <TextField id="mqtt-password" label="Password (optional)" type="password" v-model="mqttPassword" />
          <TextField id="mqtt-prefix" label="Topic prefix" v-model="mqttConfig.topic_prefix" />

          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-700">Home Assistant discovery</span>
            <k-toggle
              :checked="mqttConfig.ha_discovery_enabled"
              @change="mqttConfig.ha_discovery_enabled = !mqttConfig.ha_discovery_enabled"
            />
          </div>

          <p class="text-xs text-gray-400">
            Status: <span :class="statusColor">{{ mqttConfig.status }}</span>
          </p>

          <button
            type="button"
            data-testid="mqtt-save"
            class="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white"
            @click="onSaveMqtt"
          >Save</button>
        </FormCard>
      </div>
    </div>
  </k-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { kPage, kList, kListItem, kToggle } from 'konsta/vue';
import { useNotifications } from '../composables/useNotifications.js';
import { useMqtt } from '../composables/useMqtt.js';
import PageHeader from '../components/PageHeader.vue';
import FormCard from '../components/FormCard.vue';
import TextField from '../components/TextField.vue';
import NumberField from '../components/NumberField.vue';

const router = useRouter();
const { isSupported, isConfigured, isSubscribed, enable, disable } = useNotifications();
const { config: mqttConfig, password: mqttPassword, init: initMqtt, save: saveMqtt } = useMqtt();

void initMqtt();

const mqttHost = computed({
  get: () => mqttConfig.value.host ?? '',
  set: (v: string) => { mqttConfig.value.host = v === '' ? null : v; },
});
const mqttUsername = computed({
  get: () => mqttConfig.value.username ?? '',
  set: (v: string) => { mqttConfig.value.username = v === '' ? null : v; },
});

const statusColor = computed(() => ({
  'text-green-600': mqttConfig.value.status === 'connected',
  'text-red-600': mqttConfig.value.status === 'error',
  'text-gray-400': mqttConfig.value.status === 'disconnected' || mqttConfig.value.status === 'connecting',
}));

async function onToggle() {
  if (isSubscribed.value) {
    await disable();
  } else {
    await enable();
  }
}

async function onSaveMqtt() {
  await saveMqtt();
}
</script>
```

- [ ] **Step 2: Run frontend unit tests and build**

Run: `npm --prefix src/frontend run test:ci && npm --prefix src/frontend run build`
Expected: PASS.

- [ ] **Step 3: Manual verification in the browser**

Run: `npm run dev` (repo root), open the app, navigate to Settings. Confirm: the MQTT section renders with all fields, toggling "Enable MQTT" and clicking Save calls `PUT /api/mqtt/config` (check the Network tab), and reloading the page shows the saved host/port/prefix persisted (password field stays blank, per the write-only convention).

- [ ] **Step 4: Commit**

```bash
git add src/frontend/src/views/Settings.vue
git commit -m "feat(frontend): add MQTT configuration section to Settings"
```

---

### Task 13: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the complete test suite (both workspaces)**

Run: `npm run test:ci` (repo root `package.json` script runs lint + build + both backend/frontend `test:ci`)
Expected: PASS, 0 failures.

- [ ] **Step 2: Manual end-to-end smoke test with a real broker (optional but recommended)**

If a local Mosquitto (or similar) broker is available: run `npm run dev`, set host/port in Settings with MQTT enabled, subscribe to `weartrack/#` with `mosquitto_sub -t 'weartrack/#' -v`, start and end a session in the app, and confirm `session_start`/`session_end` messages arrive with the expected JSON shape from the spec's "Message payloads" table.

- [ ] **Step 3: Commit (if step 1 or 2 required any fixups; otherwise skip)**

```bash
git add -A
git commit -m "chore(backend,frontend): fix regressions from mqtt publishing feature"
```
