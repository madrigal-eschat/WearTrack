<!-- src/frontend/src/components/ReminderSchedulesSheet.vue -->
<template>
  <k-sheet
    v-if="open"
    :opened="open"
    @backdropclick="close"
    class="
      pb-safe bg-white dark:bg-gray-900 flex flex-col overflow-hidden h-[70vh]
    "
  >
    <k-toolbar innerClass="!h-6 !w-full">
      <div class="relative flex w-full items-center justify-center">
        <button
          type="button"
          class="
            absolute left-0 flex items-center justify-center w-8 h-full
            text-primary text-xl
          "
          @click="close"
        >✕</button>
        <SectionTitle variant="sheet"
          >Reminders — {{ categoryName }}</SectionTitle
        >
      </div>
    </k-toolbar>

    <div class="overflow-y-auto flex-1 px-4 py-2 space-y-2">
      <div
        v-if="
          !notifications.isSubscribed.value &&
          notifications.isConfigured.value
        "
        class="
          rounded-lg bg-blue-50 dark:bg-blue-950 p-3 text-sm space-y-2
        "
      >
        <p>Enable notifications to receive maintenance reminders.</p>
        <button
          type="button"
          class="
            px-3 py-1 rounded-lg text-sm font-medium bg-blue-500 text-white
          "
          @click="notifications.enable"
        >Enable notifications</button>
      </div>

      <div
        v-for="schedule in schedules.schedules.value[categoryId] ?? []"
        :key="schedule.id"
        class="
          flex items-center justify-between border border-gray-200
          rounded-lg px-3 py-2
        "
      >
        <div>
          <p class="text-sm font-medium">{{ schedule.text }}</p>
          <p class="text-xs text-gray-400">
            every {{ shortDuration(schedule.remind_each_seconds) }}
          </p>
        </div>
        <DeleteButton
          title="Delete this reminder?"
          message="This cannot be undone."
          @confirm="onDelete(schedule.id)"
        >
          <template #trigger="{ open: openConfirm }">
            <button
              type="button"
              class="text-xs text-red-500 underline"
              @click="openConfirm"
            >Delete</button>
          </template>
        </DeleteButton>
      </div>

      <div
        v-if="showAddForm"
        class="border border-gray-200 rounded-lg p-3 space-y-2"
      >
        <DurationTrigger
          label="Remind every"
          :displayValue="shortDuration(newIntervalSeconds)"
          @click="emit('open-duration-picker', newIntervalSeconds)"
        />
        <TextField
          id="reminder-text"
          label="Reminder text"
          v-model="newText"
        />
        <div class="flex gap-2">
          <button
            type="button"
            class="
              px-3 py-1 rounded-lg text-sm font-medium bg-blue-500 text-white
              disabled:opacity-40
            "
            :disabled="!newText || newIntervalSeconds < 60"
            @click="onAdd"
          >Save</button>
          <button
            type="button"
            class="
              px-3 py-1 rounded-lg text-sm font-medium border
              border-gray-300
            "
            @click="showAddForm = false"
          >Cancel</button>
        </div>
      </div>
      <button
        v-else
        type="button"
        class="
          w-full px-3 py-2 rounded-lg text-sm font-medium border
          border-gray-300
        "
        @click="showAddForm = true"
      >+ Add reminder</button>
    </div>
  </k-sheet>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { kSheet, kToolbar } from 'konsta/vue'
import SectionTitle from './SectionTitle.vue'
import DurationTrigger from './DurationTrigger.vue'
import TextField from './TextField.vue'
import DeleteButton from './DeleteButton.vue'
import { shortDuration } from '../utils/formatDuration.js'
import { useReminderSchedules } from '../composables/useReminderSchedules.js'
import { useNotifications } from '../composables/useNotifications.js'
import { useToast } from '../composables/useToast.js'

const props = defineProps<{
  categoryId: number;
  categoryName: string;
  open: boolean;
}>()
const emit = defineEmits<{
  'update:open': [value: boolean];
  'open-duration-picker': [current: number];
}>()

defineExpose({ setPickedDuration })

const schedules = useReminderSchedules()
const notifications = useNotifications()
const { showError } = useToast()

const showAddForm = ref(false)
const newIntervalSeconds = ref(3600)
const newText = ref('')

function close() {
  emit('update:open', false)
}

function setPickedDuration(value: number) {
  newIntervalSeconds.value = value
}

async function onAdd() {
  try {
    await schedules.createSchedule({
      category_id: props.categoryId,
      remind_each_seconds: newIntervalSeconds.value,
      text: newText.value,
    })
    newText.value = ''
    newIntervalSeconds.value = 3600
    showAddForm.value = false
  } catch (e) {
    showError(String(e))
  }
}

async function onDelete(id: number) {
  try {
    await schedules.deleteSchedule(props.categoryId, id)
  } catch (e) {
    showError(String(e))
  }
}
</script>
