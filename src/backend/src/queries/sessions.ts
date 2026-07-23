import { categoryStore, type Category } from '../db/stores/category-store.js';
import { itemStore } from '../db/stores/item-store.js';
import {
  sessionStore,
  type ItemWithLastSession,
  type OpenSessionWithItem,
} from '../db/stores/session-store.js';
import { injuryStore } from '../db/stores/injury-store.js';
import { statsStore } from '../db/stores/stats-store.js';
import {
  computeSessionStart,
  computeDecay,
  rotationAvailability,
  startOfTodayLocal,
  startOfNextLocalMidnight,
  type PreviousSession,
} from '../db/calculations.js';
import { nowSeconds } from '../utils/time.js';

interface ItemWithExpected extends ItemWithLastSession {
  expected_target: number;
  expected_max: number | null;
  rotation_available: boolean;
}

export interface CurrentSessionEntry {
  category: Category;
  item: {
    id: number;
    category_id: number;
    name: string;
    color: string;
    difficulty_multiplier: number;
  } | null;
  session: {
    id: number;
    item_id: number;
    started_at: number;
    ended_at: number | null;
    target_wear_seconds: number;
    max_wear_seconds: number | null;
    rest_seconds: number | null;
    ended_in_injury: number;
  } | null;
  items: ItemWithExpected[];
  decay_start_time: number | null;
  decay_state: 'none' | 'decaying' | 'fully_decayed';
  decay_full_time: number | null;
  streak_count: number;
  resting_until: number | null;
}

function enrichItemsWithExpected(
  items: ItemWithLastSession[],
  category: Category,
  previous: PreviousSession | null,
  now: number,
  injuryActive: boolean,
  rotationAvailableIds: Set<number>,
): ItemWithExpected[] {
  return items.map((it) => {
    const { target, max } = computeSessionStart(
      category,
      { difficulty_multiplier: it.difficulty_multiplier },
      previous,
      now,
      injuryActive,
    );
    return {
      ...it,
      expected_target: target,
      expected_max: max,
      rotation_available: rotationAvailableIds.has(it.item_id),
    };
  });
}

export class CurrentSessionsQuery {
  run(): CurrentSessionEntry[] {
    const categories = categoryStore.findAll();
    const openSessions = sessionStore.findOpenWithItemData();
    const allItems = sessionStore.findAllLastSessions();
    const now = nowSeconds();

    const sessionByCategory = new Map(
      openSessions.map((s) => [s.category_id, s]),
    );
    const itemsByCategory = new Map<number, ItemWithLastSession[]>();
    for (const item of allItems) {
      if (!itemsByCategory.has(item.category_id))
        itemsByCategory.set(item.category_id, []);
      itemsByCategory.get(item.category_id)!.push(item);
    }

    return categories.map((cat) =>
      this.buildEntry(
        cat,
        sessionByCategory.get(cat.id),
        itemsByCategory.get(cat.id) ?? [],
        now,
      ),
    );
  }

  private buildEntry(
    cat: Category,
    openSession: OpenSessionWithItem | undefined,
    categoryItems: ItemWithLastSession[],
    now: number,
  ): CurrentSessionEntry {
    const previous = sessionStore.findLastEndedInCategory(cat.id) ?? null;
    const injuryActive = injuryStore.hasActiveInCategory(cat.id);
    const { decay_start_time, decay_state, decay_full_time } =
      cat.type === 'duration'
        ? computeDecay(previous, cat, now)
        : {
            decay_start_time: null,
            decay_state: 'none' as const,
            decay_full_time: null,
          };
    const streak_count = statsStore.findForCategory(cat.id)?.streak_count ?? 0;

    const rotationAvailableIds =
      cat.type === 'rotation'
        ? rotationAvailability(
            itemStore.findAll(cat.id).map((i) => i.id),
            sessionStore.findRecentInCategory(cat.id, 100),
          )
        : new Set(categoryItems.map((i) => i.item_id));

    const restingUntil =
      cat.type === 'rotation' &&
      sessionStore.findSessionStartedTodayInCategory(
        cat.id,
        startOfTodayLocal(now),
      )
        ? startOfNextLocalMidnight(now)
        : null;

    const items = enrichItemsWithExpected(
      categoryItems,
      cat,
      previous,
      now,
      injuryActive,
      rotationAvailableIds,
    );

    const entry: CurrentSessionEntry = {
      category: cat,
      item: null,
      session: null,
      items,
      decay_start_time,
      decay_state,
      decay_full_time,
      streak_count,
      resting_until: restingUntil,
    };

    if (openSession) {
      entry.item = {
        id: openSession.item_id,
        category_id: openSession.category_id,
        name: openSession.item_name,
        color: openSession.item_color,
        difficulty_multiplier: openSession.item_difficulty_multiplier,
      };
      entry.session = {
        id: openSession.id,
        item_id: openSession.item_id,
        started_at: openSession.started_at,
        ended_at: openSession.ended_at,
        target_wear_seconds: openSession.target_wear_seconds,
        max_wear_seconds: openSession.max_wear_seconds,
        rest_seconds: openSession.rest_seconds,
        ended_in_injury: openSession.ended_in_injury,
      };
    }

    return entry;
  }
}
