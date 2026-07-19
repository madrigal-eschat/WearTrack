import { EventEmitter } from 'node:events';

export interface CategoryContext {
  category_id: number;
  category_name: string;
  timestamp: number;
}

export interface SessionStartEvent extends CategoryContext {
  session_id: number;
  item_id: number;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
}

export interface SessionEndEvent extends CategoryContext {
  session_id: number;
  item_id: number;
  target_wear_seconds: number;
  max_wear_seconds: number | null;
  actual_duration_seconds: number;
  rest_seconds: number;
  risk_level: string | null;
}

export interface RestStartEvent extends CategoryContext {
  rest_seconds: number;
}

export interface RestEndEvent extends CategoryContext {
  rest_seconds: number;
  elapsed_rest_seconds: number;
}

export interface DecayStartEvent extends CategoryContext {
  decay_state: 'decaying' | 'fully_decayed';
  decay_full_time: number;
}

export interface DecayFinishEvent extends CategoryContext {
  decay_state: 'fully_decayed';
}

export type HalfwayReachedEvent = CategoryContext;
export type DecaySoonEvent = CategoryContext;

export interface SessionThresholdEvent extends CategoryContext {
  session_id: number;
}

export interface PollerTickEvent {
  timestamp: number;
}

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

export type EventName = keyof EventPayloads;

class TypedEventBus {
  private emitter = new EventEmitter();

  emit<E extends EventName>(event: E, payload: EventPayloads[E]): void {
    for (const listener of this.emitter.listeners(event)) {
      try {
        (listener as (payload: EventPayloads[E]) => void)(payload);
      } catch (error) {
        console.error(`[eventBus] listener for event "${event}" threw an error:`, error);
      }
    }
  }

  on<E extends EventName>(event: E, listener: (payload: EventPayloads[E]) => void): void {
    this.emitter.on(event, listener);
  }
}

export const eventBus = new TypedEventBus();
