<template>
  <div>
    <FormSectionHeader
      title="Categories"
      :isOpen="showCatForm"
      :showToggle="true"
      @toggle="onToggleAddForm"
    />

    <CategoryForm
      v-if="showCatForm"
      submitLabel="Add"
      @submit="onAddCategory"
      @cancel="showCatForm = false"
    />

    <div v-if="loading" class="text-center py-4 text-gray-400">Loading…</div>
    <template v-else>
      <k-list v-if="categories.length > 0" inset class="!my-2">
        <template v-for="cat in categories" :key="cat.id">
          <k-list-item :title="cat.name">
            <template #media>
              <Icon
                v-if="cat.icon?.includes(':')"
                :icon="cat.icon"
                class="text-2xl w-8 h-8"
              />
              <span v-else class="text-2xl">{{ cat.icon }}</span>
            </template>
            <template #subtitle>
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-400">
                  {{ reminderCountLabel(cat.id) }}
                </span>
                <button
                  type="button"
                  class="text-xs text-blue-500 underline"
                  @click="remindersSheetCategoryId = cat.id"
                >Manage Reminders</button>
              </div>
            </template>
            <template #after>
              <div class="flex gap-1">
                <k-button
                  small
                  outline
                  type="button"
                  @click="onToggleEdit(cat.id)"
                >Edit</k-button>
                <DeleteButton
                  title="Delete this category and all its items?"
                  message="This cannot be undone."
                  @confirm="onConfirmDeleteCategory(cat.id)"
                >
                  <template #trigger="{ open }">
                    <k-button
                      small
                      outline
                      type="button"
                      @click="open"
                    >Delete</k-button>
                  </template>
                </DeleteButton>
              </div>
            </template>
          </k-list-item>
          <CategoryForm
            v-if="editingCategoryId === cat.id"
            :initialValues="categoryToFormState(cat)"
            submitLabel="Save"
            @submit="onSaveCategory(cat.id, $event)"
            @cancel="editingCategoryId = null"
          />
        </template>
      </k-list>
      <k-block v-else>
        <p class="text-center text-gray-400 text-sm">
          No categories yet. Use "+ Add" above to create one.
        </p>
      </k-block>
    </template>
    <ReminderSchedulesSheet
      ref="remindersSheetRef"
      v-if="remindersSheetCategoryId !== null"
      :categoryId="remindersSheetCategoryId"
      :categoryName="
        categories.find((c) => c.id === remindersSheetCategoryId)?.name ?? ''
      "
      :open="remindersSheetCategoryId !== null"
      @update:open="(v) => { if (!v) remindersSheetCategoryId = null }"
      @open-duration-picker="onOpenDurationPicker"
    />
    <DurationPickerSheet
      v-if="remindersSheetCategoryId !== null"
      :modelValue="reminderDurationPickerValue"
      :open="reminderDurationPickerOpen"
      @update:modelValue="onReminderDurationPicked"
      @update:open="reminderDurationPickerOpen = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import { kList, kListItem, kButton, kBlock } from 'konsta/vue'
import { useCategories } from '../composables/useCategories.js'
import { useItems } from '../composables/useItems.js'
import { useToast } from '../composables/useToast.js'
import {
  categoryToFormState,
  formStateToApiPayload,
} from '../utils/categoryForm.js'
import type { CategoryFormState } from './CategoryForm.vue'
import FormSectionHeader from './FormSectionHeader.vue'
import CategoryForm from './CategoryForm.vue'
import DeleteButton from './DeleteButton.vue'
import { useReminderSchedules } from '../composables/useReminderSchedules.js'
import ReminderSchedulesSheet from './ReminderSchedulesSheet.vue'
import DurationPickerSheet from './DurationPickerSheet.vue'

const {
  categories,
  loadCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = useCategories()
const { loadItems } = useItems()
const { showError } = useToast()
const { schedules, loadSchedules } = useReminderSchedules()

const loading = ref(true)
const showCatForm = ref(false)
const editingCategoryId = ref<number | null>(null)
const remindersSheetCategoryId = ref<number | null>(null)
const remindersSheetRef = ref<InstanceType<
  typeof ReminderSchedulesSheet
> | null>(null)
const reminderDurationPickerOpen = ref(false)
const reminderDurationPickerValue = ref(3600)

function reminderCountLabel(categoryId: number): string {
  const n = (schedules.value[categoryId] ?? []).length
  return `${n} reminder${n === 1 ? '' : 's'} scheduled`
}

function onOpenDurationPicker(current: number) {
  reminderDurationPickerValue.value = current
  reminderDurationPickerOpen.value = true
}

function onReminderDurationPicked(value: number) {
  reminderDurationPickerValue.value = value
  remindersSheetRef.value?.setPickedDuration(value)
}

onMounted(async () => {
  try {
    await loadCategories()
    await Promise.all(categories.value.map((c) => loadSchedules(c.id)))
  } finally {
    loading.value = false
  }
})


function onToggleAddForm() {
  showCatForm.value = !showCatForm.value
  if (showCatForm.value) {
    editingCategoryId.value = null
  }
}

function onToggleEdit(id: number) {
  if (editingCategoryId.value === id) {
    editingCategoryId.value = null
  } else {
    editingCategoryId.value = id
    showCatForm.value = false
  }
}

async function onAddCategory(data: CategoryFormState) {
  try {
    const created = await createCategory(formStateToApiPayload(data))
    await loadSchedules(created.id)
    showCatForm.value = false
  } catch (e) {
    showError(String(e))
  }
}

async function onSaveCategory(id: number, data: CategoryFormState) {
  try {
    await updateCategory(id, formStateToApiPayload(data))
    editingCategoryId.value = null
  } catch (e) {
    showError(String(e))
  }
}

async function onConfirmDeleteCategory(id: number) {
  try {
    await deleteCategory(id)
  } catch (e) {
    showError(String(e))
    return
  }
  await loadItems().catch(() => {})
}
</script>
