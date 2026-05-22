<template>
  <div>
    <FormSectionHeader
      title="Items"
      :isOpen="showItemForm"
      :showToggle="categories.length > 0"
      @toggle="showItemForm = !showItemForm"
    />

    <div v-if="showItemForm && categories.length > 0" class="mx-4 mb-3 p-3 bg-white border border-gray-200 rounded-2xl space-y-2">
      <TextField id="item-name" label="Name" v-model="itemForm.name" />
      <div class="flex gap-2 items-end">
        <ColorPicker v-model="itemForm.color" />
        <template v-if="selectedCat?.icon">
          <Icon v-if="selectedCat.icon.includes(':')" :icon="selectedCat.icon" class="w-6 h-6 self-center shrink-0" :style="{ color: itemForm.color }" />
          <span v-else class="text-xl self-center shrink-0">{{ selectedCat.icon }}</span>
        </template>
        <div class="flex-1 min-w-[10ch]">
          <SelectField
            id="item-category"
            label=""
            :modelValue="itemForm.category_id"
            @update:modelValue="itemForm.category_id = $event"
          >
            <option value="" disabled>Select…</option>
            <option v-for="cat in categories" :key="cat.id" :value="String(cat.id)">{{ cat.name }}</option>
          </SelectField>
        </div>
        <k-button
          type="button"
          @click="onAddItem"
          :disabled="!itemForm.name || !itemForm.category_id"
        >
          Add
        </k-button>
      </div>
    </div>

    <template v-if="!loading">
      <div v-for="cat in categories" :key="cat.id">
        <div class="px-4 mt-4 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {{ cat.name }}
        </div>
        <k-list inset class="!my-2">
          <k-list-item
            v-for="item in itemsForCategory(cat.id)"
            :key="item.id"
            :title="item.name"
          >
            <template #media>
              <Icon
                v-if="cat.icon?.includes(':')"
                :icon="cat.icon"
                class="w-7 h-7"
                :style="{ color: item.color }"
              />
              <span v-else-if="cat.icon" class="text-2xl">{{ cat.icon }}</span>
              <ColorCircle v-else :color="item.color" />
            </template>
            <template #after>
              <k-button small outline type="button" @click="onDeleteItem(item.id)">Delete</k-button>
            </template>
          </k-list-item>
          <k-list-item
            v-if="itemsForCategory(cat.id).length === 0"
            title="No items in this category"
            class="text-gray-400"
          />
        </k-list>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { kList, kListItem, kButton } from 'konsta/vue';
import { useItems } from '../composables/useItems.js';
import { useCategories } from '../composables/useCategories.js';
import { useToast } from '../composables/useToast.js';
import { randomSwatchColor } from '../utils/colors.js';
import TextField from './TextField.vue';
import SelectField from './SelectField.vue';
import ColorPicker from './ColorPicker.vue';
import ColorCircle from './ColorCircle.vue';
import FormSectionHeader from './FormSectionHeader.vue';

const { loadItems, createItem, deleteItem, itemsForCategory } = useItems();
const { categories } = useCategories();
const { showError } = useToast();

const loading = ref(true);
const showItemForm = ref(false);

const itemForm = reactive({ name: '', color: randomSwatchColor(), category_id: '' });

const selectedCat = computed(() =>
  categories.value.find((c) => String(c.id) === itemForm.category_id) ?? null
);

onMounted(async () => {
  try {
    await loadItems();
  } finally {
    loading.value = false;
  }
});

// categories is populated by CategoriesSection via the shared useCategories ref;
// this component intentionally does not call loadCategories() itself.
// Keep default category selection in sync when categories change.
// deep: true is needed because createCategory pushes to the array rather than replacing it.
watch(categories, (cats) => {
  const validIds = cats.map((c) => String(c.id));
  if (itemForm.category_id && !validIds.includes(itemForm.category_id)) {
    // Selected category was deleted — reset to last available or empty.
    itemForm.category_id = cats.length > 0 ? String(cats[cats.length - 1].id) : '';
  } else if (!itemForm.category_id && cats.length > 0) {
    itemForm.category_id = String(cats[cats.length - 1].id);
  }
}, { immediate: true, deep: true });

async function onAddItem() {
  if (!itemForm.name || !itemForm.color || !itemForm.category_id) return;
  try {
    await createItem({
      name: itemForm.name,
      color: itemForm.color,
      category_id: Number(itemForm.category_id),
    });
    itemForm.name = '';
    itemForm.color = randomSwatchColor();
    showItemForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onDeleteItem(id: number) {
  if (!confirm('Delete this item?')) return;
  try {
    await deleteItem(id);
  } catch (e) {
    showError(String(e));
  }
}
</script>
