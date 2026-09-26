<template>
  <!-- Kebab action sheet -->
  <Actions :opened="actionsOpen" @backdropclick="actionsOpen = false">
    <ActionsGroup>
      <ActionsButton @click="startEdit()">Edit</ActionsButton>
      <ActionsButton
        class="text-red-600"
        @click="openDeleteConfirmation"
      >Delete</ActionsButton>
    </ActionsGroup>
    <ActionsGroup>
      <ActionsButton bold @click="actionsOpen = false">Cancel</ActionsButton>
    </ActionsGroup>
  </Actions>

  <DeleteButton
    v-if="activeEntry"
    ref="deleteButton"
    title="Delete session?"
    message="This cannot be undone."
    @confirm="performDelete"
  />

  <EditSessionDialog
    v-if="activeEntry"
    :open="editOpen"
    @update:open="editOpen = $event"
    :started-at="editStartedAt"
    @update:started-at="editStartedAt = $event"
    :ended-at="editEndedAt"
    @update:ended-at="editEndedAt = $event"
    :error="editError"
    @save="saveEdit"
  />
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { Actions, ActionsGroup, ActionsButton } from 'konsta/vue'
import DeleteButton from './DeleteButton.vue'
import EditSessionDialog from './EditSessionDialog.vue'
import {
  useSessionLog, type SessionLogEntry,
} from '../composables/useSessionLog.js'
import { buildEditChanges } from '../utils/sessionEditChanges.js'

const { editSession, deleteSession } = useSessionLog()

const actionsOpen = ref(false)
const activeEntry = ref<SessionLogEntry | null>(null)
const deleteButton = ref<{ open: () => void } | null>(null)

const editOpen = ref(false)
const editStartedAt = ref(0)
const editEndedAt = ref(0)
const editError = ref<string | null>(null)

/** Open the action sheet for a log entry. */
function open(entry: SessionLogEntry): void {
  activeEntry.value = entry
  actionsOpen.value = true
}
defineExpose({ open })

function startEdit(): void {
  actionsOpen.value = false
  const entry = activeEntry.value
  if (!entry || entry.ended_at === null) {
    return
  }
  editStartedAt.value = entry.started_at
  editEndedAt.value = entry.ended_at
  editError.value = null
  editOpen.value = true
}

async function openDeleteConfirmation(): Promise<void> {
  actionsOpen.value = false
  await nextTick()
  deleteButton.value?.open()
}

async function saveEdit(): Promise<void> {
  const target = activeEntry.value
  if (!target || target.ended_at === null) {
    return
  }
  const changes = buildEditChanges(
    { started_at: target.started_at, ended_at: target.ended_at },
    editStartedAt.value,
    editEndedAt.value,
  )
  if (Object.keys(changes).length === 0) {
    editOpen.value = false
    return
  }
  try {
    await editSession(target, changes)
    editOpen.value = false
  } catch (e) {
    editError.value = e instanceof Error ? e.message : 'Could not save edit'
  }
}

async function performDelete(): Promise<void> {
  if (activeEntry.value) {
    await deleteSession(activeEntry.value)
  }
}
</script>
