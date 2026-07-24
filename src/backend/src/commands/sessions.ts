import { sessionStore, type Session } from '../db/stores/session-store.js'
import { itemStore, type Item } from '../db/stores/item-store.js'
import { categoryStore } from '../db/stores/category-store.js'
import {
  rotationAvailability,
  isConsecutiveLockEligible,
  startOfTodayLocal,
  type Category,
} from '../db/calculations.js'
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from '../middleware/errors.js'
import { nowSeconds } from '../utils/time.js'

export class StartSessionCommand {
  constructor(private readonly body: Record<string, unknown>) {}

  private validateInput(): { itemId: number; startedAt: number | undefined } {
    const { item_id, started_at } = this.body
    if (typeof item_id !== 'number') {
      throw new ValidationError('item_id must be a number')
    }
    if (started_at !== undefined && typeof started_at !== 'number') {
      throw new ValidationError('started_at must be a Unix timestamp (number)')
    }
    return { itemId: item_id, startedAt: started_at as number | undefined }
  }

  private checkRotationEligibility(
    item: Item,
    category: Category,
    itemId: number,
  ): void {
    if (category.type !== 'rotation') {
      return
    }

    const dayStart = startOfTodayLocal(nowSeconds())
    if (
      sessionStore.findSessionStartedTodayInCategory(item.category_id, dayStart)
    ) {
      throw new ValidationError('Category has already had a session today')
    }

    const activeItemIds = itemStore.findAll(item.category_id).map((i) => i.id)
    const recent = sessionStore.findRecentInCategory(item.category_id, 100)
    const available = rotationAvailability(activeItemIds, recent)
    const consecutiveLockEligible = isConsecutiveLockEligible(
      recent,
      itemId,
      category.consecutive_wear_days,
    )
    if (!available.has(itemId) && !consecutiveLockEligible) {
      throw new ValidationError(
        `Item ${itemId} is not available yet — it's another item's turn ` +
          `in the rotation`,
      )
    }
  }

  run(): Session {
    const { itemId, startedAt } = this.validateInput()

    const item = itemStore.find(itemId)
    if (!item) {
      throw new NotFoundError(`Item ${itemId} not found`)
    }

    const conflict = sessionStore.findOpenInCategory(item.category_id)
    if (conflict) {
      throw new ConflictError(
        `Category already has an open session on item ` +
          `"${conflict.item_name}" (id ${conflict.item_id})`,
        {
          conflicting_item: { id: conflict.item_id, name: conflict.item_name },
        },
      )
    }

    const category = categoryStore.findRaw(item.category_id)!
    this.checkRotationEligibility(item, category, itemId)

    const startTs = startedAt ?? nowSeconds()
    return sessionStore.start(itemId, category, item, startTs)
  }
}
