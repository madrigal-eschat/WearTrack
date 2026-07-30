import { eventBus } from '../events/bus.js'
import { categoryStore } from '../db/stores/category-store.js'
import { statsStore } from '../db/stores/stats-store.js'
import { mqttConfigStore } from './config-store.js'
import { publish } from './client.js'
import { slugify } from './events.js'

function publishStatsSensor(
  topicPrefix: string,
  slug: string,
  categoryId: number,
  categoryName: string,
  suffix: string,
  friendlyName: string,
  valueTemplate: string,
  extra: Record<string, unknown> = {},
): void {
  const statsTopic = `${topicPrefix}/${slug}/stats`
  publish(
    `homeassistant/sensor/weartrack_${categoryId}_${suffix}/config`,
    {
      name: `${categoryName} ${friendlyName}`,
      unique_id: `weartrack_${categoryId}_${suffix}`,
      state_topic: statsTopic,
      json_attributes_topic: statsTopic,
      value_template: valueTemplate,
      ...extra,
    },
    { retain: true },
  )
}

function publishDiscovery(): void {
  const config = mqttConfigStore.get()
  if (!config.enabled || !config.ha_discovery_enabled) {
    return
  }

  for (const category of categoryStore.findAll()) {
    const slug = slugify(category.name)
    const stateTopic = `${config.topic_prefix}/${slug}/state`
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
    )

    const stats = statsStore.findForCategory(category.id) ?? {
      total_wear_seconds: 0,
      streak_count: 0,
      streak_wear_seconds: 0,
      best_streak_count: 0,
      best_streak_wear_seconds: 0,
    }

    publishStatsSensor(
      config.topic_prefix,
      slug,
      category.id,
      category.name,
      'current_streak',
      'current streak',
      '{{ value_json.streak_count }}',
    )
    publishStatsSensor(
      config.topic_prefix,
      slug,
      category.id,
      category.name,
      'longest_streak',
      'longest streak',
      '{{ value_json.best_streak_count }}',
    )
    publishStatsSensor(
      config.topic_prefix,
      slug,
      category.id,
      category.name,
      'longest_streak_time',
      'longest streak time',
      '{{ value_json.best_streak_wear_seconds }}',
      { device_class: 'duration', unit_of_measurement: 's' },
    )
    publishStatsSensor(
      config.topic_prefix,
      slug,
      category.id,
      category.name,
      'total_worn',
      'total worn',
      '{{ value_json.total_wear_seconds }}',
      { device_class: 'duration', unit_of_measurement: 's' },
    )

    publish(
      `${config.topic_prefix}/${slug}/stats`,
      {
        streak_count: stats.streak_count,
        streak_wear_seconds: stats.streak_wear_seconds,
        best_streak_count: stats.best_streak_count,
        best_streak_wear_seconds: stats.best_streak_wear_seconds,
        total_wear_seconds: stats.total_wear_seconds,
      },
      { retain: true },
    )
  }
}

export function startDiscovery(): void {
  eventBus.on('poller_tick', () => {
    publishDiscovery()
  })
}
