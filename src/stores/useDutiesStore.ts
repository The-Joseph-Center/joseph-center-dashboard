import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

/**
 * Whether the duties list has anything in it for this person.
 *
 * The rest of the navigation is decided by capability alone, which is static
 * and known the moment someone signs in. Duties is not: which rows a person
 * sees depends on the `access_group` stored on each row, so "can they open the
 * page" cannot be answered without asking the server.
 *
 * The probe returns a count and nothing else, so drawing a menu item does not
 * mean shipping the list to do it.
 *
 * `available` stays null until the answer is known, and the sidebar shows the
 * link only on true. A link that appears and then vanishes is worse than one
 * that arrives a moment late.
 */
export const useDutiesStore = defineStore('duties', () => {
  const available = ref<boolean | null>(null);
  const visibleCount = ref(0);
  const canEdit = ref(false);
  let inFlight: Promise<void> | null = null;

  async function load() {
    if (available.value !== null) return;
    // Several components may ask at once; only one request should go out.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const res = await apiFetch('/.netlify/functions/marketing-duties?probe=1');
        if (!res.ok) { available.value = false; return; }
        const d = await res.json();
        available.value = !!d.available;
        visibleCount.value = Number(d.visibleCount ?? 0);
        canEdit.value = !!d.canEdit;
      } catch {
        // A failed probe hides the link rather than showing one that 403s.
        available.value = false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { available, visibleCount, canEdit, load };
});
