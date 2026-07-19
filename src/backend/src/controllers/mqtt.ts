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
