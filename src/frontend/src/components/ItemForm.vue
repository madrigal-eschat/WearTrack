<template>
  <FormCard>
    <TextField :id="`${idPrefix}-name`" label="Name" v-model="form.name" />
    <div class="flex gap-2 items-end">
      <ColorPicker v-model="form.color" />
      <template v-if="selectedCategory?.icon">
        <Icon
          v-if="selectedCategory.icon.includes(':')"
          :icon="selectedCategory.icon"
          class="w-6 h-6 self-center shrink-0"
          :style="{ color: form.color }"
        />
        <span
          v-else
          class="text-xl self-center shrink-0"
        >{{ selectedCategory.icon }}</span>
      </template>
      <div class="flex-1 min-w-[10ch]">
        <SelectField
          :id="`${idPrefix}-category`"
          label=""
          :modelValue="form.category_id"
          @update:modelValue="form.category_id = $event"
        >
          <option v-if="showPlaceholderOption" value="" disabled>
            Select…
          </option>
          <option
            v-for="cat in categories"
            :key="cat.id"
            :value="String(cat.id)"
          >{{ cat.name }}</option>
        </SelectField>
      </div>
    </div>
    <div class="flex gap-4 items-end">
      <NumberField
        :id="`${idPrefix}-difficulty`"
        label="Difficulty"
        v-model="form.difficulty_multiplier"
        :min="0.1"
        :default="1.0"
        :step="0.1"
      />
      <div class="flex gap-2 ml-auto">
        <k-button
          v-if="showCancel"
          small
          outline
          type="button"
          @click="$emit('cancel')"
        >Cancel</k-button>
        <k-button
          :small="showCancel"
          type="button"
          @click="onSubmit"
          :disabled="!form.name || !form.category_id"
        >
          {{ submitLabel }}
        </k-button>
      </div>
    </div>
  </FormCard>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { kButton } from 'konsta/vue';
import TextField from './TextField.vue';
import SelectField from './SelectField.vue';
import ColorPicker from './ColorPicker.vue';
import NumberField from './NumberField.vue';
import FormCard from './FormCard.vue';
import { randomSwatchColor } from '../utils/colors.js';

interface ItemFormValue {
  name: string;
  color: string;
  category_id: string;
  difficulty_multiplier: number;
}

const props = defineProps<{
  categories: { id: number; name: string; icon: string }[];
  initialValues?: Partial<ItemFormValue>;
  submitLabel: string;
  showCancel?: boolean;
  idPrefix: string;
  showPlaceholderOption?: boolean;
}>();

const emit = defineEmits<{
  submit: [data: {
    name: string;
    color: string;
    category_id: number;
    difficulty_multiplier: number;
  }];
  cancel: [];
}>();

const form = reactive<ItemFormValue>({
  name: '',
  color: randomSwatchColor(),
  category_id: '',
  difficulty_multiplier: 1.0,
  ...props.initialValues,
});

const selectedCategory = computed(
  () => props.categories.find((c) => String(c.id) === form.category_id) ??
    null,
);

// Keep the selected category in sync when the list changes (e.g. a
// category was deleted).
watch(
  () => props.categories,
  (cats) => {
    const validIds = cats.map((c) => String(c.id));
    if (form.category_id && !validIds.includes(form.category_id)) {
      form.category_id =
        cats.length > 0 ? String(cats[cats.length - 1].id) : '';
    } else if (!form.category_id && cats.length > 0) {
      form.category_id = String(cats[cats.length - 1].id);
    }
  },
  { immediate: true, deep: true },
);

function onSubmit() {
  if (!form.name || !form.category_id) return;
  emit('submit', {
    name: form.name,
    color: form.color,
    category_id: Number(form.category_id),
    difficulty_multiplier: form.difficulty_multiplier,
  });
}
</script>
