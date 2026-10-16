<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { apiFetch } from '@/lib/api';

/**
 * What is waiting on the person reading it, and nothing else.
 *
 * Shows nothing at all while it loads: a strip that says "all caught up" for a
 * second and then fills with work is worse than one that appears a moment
 * late. If the request fails it stays quiet too — claiming nothing is waiting
 * when we could not look is the one thing this must never do.
 */
interface Waiting {
  id: string;
  text: string;
  href: string;
  tone: 'act' | 'watch';
  count?: number;
}

const items = ref<Waiting[]>([]);
const loaded = ref(false);
const failed = ref(false);

onMounted(async () => {
  try {
    const res = await apiFetch('/.netlify/functions/overview');
    if (!res.ok) throw new Error(String(res.status));
    items.value = (await res.json()).waiting ?? [];
    loaded.value = true;
  } catch {
    failed.value = true;
  }
});

const owed = computed(() => items.value.filter((i) => i.tone === 'act').length);
</script>

<template>
  <section v-if="loaded" class="strip" aria-label="Waiting on you">
    <p v-if="!items.length" class="strip__clear" role="status">All caught up — nothing is waiting on you.</p>

    <template v-else>
      <p class="sr-only" role="status">
        {{ owed }} thing{{ owed === 1 ? '' : 's' }} waiting on you.
      </p>
      <ul class="strip__list">
        <li v-for="i in items" :key="i.id" class="strip__item" :class="`strip__item--${i.tone}`">
          <RouterLink :to="i.href" class="strip__link">
            <span class="strip__text">{{ i.text }}</span>
            <span class="strip__go" aria-hidden="true">→</span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.strip { margin-bottom: 1.25rem; }
.strip__clear {
  margin: 0; padding: .7rem 1rem; font-size: .875rem;
  color: #14532d; background: color-mix(in srgb, #14532d 8%, var(--color-surface));
  border: 1px solid color-mix(in srgb, #14532d 18%, var(--color-border));
  border-radius: var(--border-radius);
}
.strip__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
@media (min-width: 900px) { .strip__list { grid-template-columns: 1fr 1fr; } }

.strip__item { border: 1px solid var(--color-border); border-left-width: 3px; border-radius: var(--border-radius); background: var(--color-surface); }
.strip__item--act { border-left-color: #8a1f1f; }
.strip__item--watch { border-left-color: #8a5a1f; }

.strip__link {
  display: flex; align-items: center; justify-content: space-between; gap: .75rem;
  padding: .7rem 1rem; text-decoration: none; color: var(--color-text); font-size: .875rem;
}
.strip__link:hover { color: var(--color-primary-strong); }
.strip__go { color: var(--color-text-secondary); }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
</style>
