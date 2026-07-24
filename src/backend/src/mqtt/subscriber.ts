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

function publishEvent(
  categoryName: string,
  event: string,
  payload: unknown,
): void {
  const config = mqttConfigStore.get();
  if (!config.enabled) {
    return;
  }
  const slug = slugify(categoryName);
  publish(`${config.topic_prefix}/${slug}/${event}`, payload, {
    retain: false,
  });
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
