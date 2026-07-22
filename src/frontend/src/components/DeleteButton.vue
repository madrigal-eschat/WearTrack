<template>
  <slot name="trigger" :open="open" />
  <k-dialog :opened="confirmOpen" @backdropclick="confirmOpen = false">
    <template #title>{{ title }}</template>
    <template #content>{{ message }}</template>
    <template #buttons>
      <k-dialog-button data-testid="delete-cancel" @click="confirmOpen = false">Cancel</k-dialog-button>
      <k-dialog-button strong data-testid="delete-confirm" @click="onConfirm">Delete</k-dialog-button>
    </template>
  </k-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { kDialog, kDialogButton } from 'konsta/vue';

defineProps<{ title: string; message: string }>();
const emit = defineEmits<{ confirm: [] }>();

const confirmOpen = ref(false);

function open() {
  confirmOpen.value = true;
}

function onConfirm() {
  confirmOpen.value = false;
  emit('confirm');
}

defineExpose({ open });
</script>
