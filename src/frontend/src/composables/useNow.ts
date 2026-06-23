import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

export function useNow(): Ref<number> {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    timer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  });

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer);
  });

  return now;
}
