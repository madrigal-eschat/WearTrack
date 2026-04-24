import { ref } from 'vue';

const message = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

export function useToast() {
  function showError(msg: string) {
    message.value = msg;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { message.value = null; }, 4000);
  }

  function dismiss() {
    message.value = null;
    if (timer) clearTimeout(timer);
  }

  return { message, showError, dismiss };
}
