<template>
  <div>
    <FormSectionHeader
      title="Items"
      :isOpen="showItemForm"
      :showToggle="categories.length > 0"
      @toggle="showItemForm = !showItemForm; if (showItemForm) editingItemId = null"
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
      </div>
      <div class="flex gap-4 items-end">
        <div>
          <label for="item-difficulty" class="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
          <input
            id="item-difficulty"
            v-model.number="itemForm.difficulty_multiplier"
            type="number" min="0.1" step="0.1"
            class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
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
          <template v-for="item in itemsForCategory(cat.id)" :key="item.id">
            <k-list-item :title="item.name">
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
                <div class="flex gap-1">
                  <k-button small outline type="button" @click="onToggleEdit(item)">Edit</k-button>
                  <k-button small outline type="button" @click="onDeleteItem(item.id)">Delete</k-button>
                </div>
              </template>
            </k-list-item>
            <div v-if="editingItemId === item.id" class="mx-2 mb-2 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
              <TextField id="edit-item-name" label="Name" v-model="editForm.name" />
              <div class="flex gap-2 items-end">
                <ColorPicker v-model="editForm.color" />
                <template v-if="editSelectedCat?.icon">
                  <Icon v-if="editSelectedCat.icon.includes(':')" :icon="editSelectedCat.icon" class="w-6 h-6 self-center shrink-0" :style="{ color: editForm.color }" />
                  <span v-else class="text-xl self-center shrink-0">{{ editSelectedCat.icon }}</span>
                </template>
                <div class="flex-1 min-w-[10ch]">
                  <SelectField
                    id="edit-item-category"
                    label=""
                    :modelValue="editForm.category_id"
                    @update:modelValue="editForm.category_id = $event"
                  >
                    <option v-for="c in categories" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
                  </SelectField>
                </div>
              </div>
              <div class="flex gap-4 items-end">
                <div>
                  <label for="edit-item-difficulty" class="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
                  <input
                    id="edit-item-difficulty"
                    v-model.number="editForm.difficulty_multiplier"
                    type="number" min="0.1" step="0.1"
                    class="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div class="flex gap-2 ml-auto">
                  <k-button small outline type="button" @click="editingItemId = null">Cancel</k-button>
                  <k-button small type="button" @click="onSaveItem(item.id)" :disabled="!editForm.name">Save</k-button>
                </div>
              </div>
            </div>
          </template>
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
import type { Item } from '../composables/useWear.js';
import { useCategories } from '../composables/useCategories.js';
import { useToast } from '../composables/useToast.js';
import { randomSwatchColor } from '../utils/colors.js';
import TextField from './TextField.vue';
import SelectField from './SelectField.vue';
import ColorPicker from './ColorPicker.vue';
import ColorCircle from './ColorCircle.vue';
import FormSectionHeader from './FormSectionHeader.vue';

const { loadItems, createItem, updateItem, deleteItem, itemsForCategory } = useItems();
const { categories } = useCategories();
const { showError } = useToast();

const loading = ref(true);
const showItemForm = ref(false);
const editingItemId = ref<number | null>(null);

const itemForm = reactive({ name: '', color: randomSwatchColor(), category_id: '', difficulty_multiplier: 1.0 });
const editForm = reactive({ name: '', color: '', category_id: '', difficulty_multiplier: 1.0 });

const selectedCat = computed(() =>
  categories.value.find((c) => String(c.id) === itemForm.category_id) ?? null
);
const editSelectedCat = computed(() =>
  categories.value.find((c) => String(c.id) === editForm.category_id) ?? null
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

function onToggleEdit(item: Item) {
  if (editingItemId.value === item.id) {
    editingItemId.value = null;
    return;
  }
  editForm.name = item.name;
  editForm.color = item.color;
  editForm.category_id = String(item.category_id);
  editForm.difficulty_multiplier = item.difficulty_multiplier;
  editingItemId.value = item.id;
  showItemForm.value = false;
}

async function onAddItem() {
  if (!itemForm.name || !itemForm.color || !itemForm.category_id) return;
  try {
    await createItem({
      name: itemForm.name,
      color: itemForm.color,
      category_id: Number(itemForm.category_id),
      difficulty_multiplier: itemForm.difficulty_multiplier,
    });
    itemForm.name = '';
    itemForm.color = randomSwatchColor();
    itemForm.difficulty_multiplier = 1.0;
    showItemForm.value = false;
  } catch (e) {
    showError(String(e));
  }
}

async function onSaveItem(id: number) {
  if (!editForm.name) return;
  try {
    await updateItem(id, {
      name: editForm.name,
      color: editForm.color,
      category_id: Number(editForm.category_id),
      difficulty_multiplier: editForm.difficulty_multiplier,
    });
    editingItemId.value = null;
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
