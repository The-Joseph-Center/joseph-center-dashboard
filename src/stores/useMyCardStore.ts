import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

// The signed-in user's own staff card, fetched once and shared.
//
// Both the overview widget and the sidebar avatar want it; without somewhere to
// keep it they would each call the Function on every navigation. Loading is
// idempotent — `load()` is safe to call from every component that needs it.

export interface MyCard {
  _id: string; name?: string; title?: string; email?: string;
  quote?: string; departments?: string[]; hidden?: boolean; imageUrl?: string | null;
}

export const useMyCardStore = defineStore('myCard', () => {
  const card = ref<MyCard | null>(null);
  const linked = ref(true);
  const loading = ref(true);
  const error = ref('');
  let inFlight: Promise<void> | null = null;

  function load(force = false): Promise<void> {
    if (inFlight && !force) return inFlight;
    if (card.value && !force) return Promise.resolve();
    loading.value = true;
    inFlight = (async () => {
      try {
        const res = await apiFetch('/.netlify/functions/get-my-staff-card');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        linked.value = data.linked;
        card.value = data.card;
        error.value = '';
      } catch {
        error.value = 'Could not load your staff card.';
      } finally {
        loading.value = false;
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { card, linked, loading, error, load };
});
