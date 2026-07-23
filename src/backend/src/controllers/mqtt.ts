import { Hono } from 'hono';
import { mqttConfigStore } from '../mqtt/config-store.js';
import { getStatus, reloadFromConfig } from '../mqtt/client.js';
import { publishDiscoveryNow } from '../mqtt/discovery.js';
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
  if (body.port !== undefined && (body.port < 1 || body.port > 65535)) {
    throw new ValidationError('port must be between 1 and 65535');
  }
  if (
    body.topic_prefix !== undefined &&
    (typeof body.topic_prefix !== 'string' || body.topic_prefix.trim() === '')
  ) {
    throw new ValidationError('topic_prefix must be a non-empty string');
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
  publishDiscoveryNow();
  return c.json(toResponseBody(getStatus()));
});
