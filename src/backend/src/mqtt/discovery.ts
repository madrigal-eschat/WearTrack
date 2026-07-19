import { eventBus } from '../events/bus.js';
import { categoryStore } from '../db/stores/category-store.js';
import { mqttConfigStore } from './config-store.js';
import { publish } from './client.js';
import { slugify } from './events.js';

function publishDiscovery(): void {
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
}

/** Republishes HA discovery configs immediately, e.g. right after the MQTT config is saved. */
export function publishDiscoveryNow(): void {
  publishDiscovery();
}

export function startDiscovery(): void {
  eventBus.on('poller_tick', () => {
    publishDiscovery();
  });
}
