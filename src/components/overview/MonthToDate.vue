<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { apiFetch } from '@/lib/api';
import { compare, NOT_CONNECTED } from '@/lib/compare';

/**
 * How the website is doing this month, so far.
 *
 * Live rather than settled: it changes every day, which is why it sits above
 * anything written at month end. The comparison is against the same stretch of
 * last month — the 1st to today against the 1st to the same day number — since
 * measuring half a month against a whole one makes every month look like a
 * collapse until the 28th.
 */
interface MonthData {
  connected: boolean;
  visits?: number;
  pageviews?: number;
  secondsPerVisit?: number | null;
  previousVisits?: number | null;
  days?: { date: string; visits: number }[];
}

const data = ref<MonthData | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const res = await apiFetch('/.netlify/functions/analytics-proxy?period=mtd');
    if (!res.ok) throw new Error(String(res.status));
    data.value = await res.json();
  } catch {
    failed.value = true;
  }
});

const monthName = computed(() => new Date().toLocaleString('en-US', { month: 'long' }));

const change = computed(() =>
  data.value?.connected ? compare(data.value.visits ?? 0, data.value.previousVisits) : null
);

/** Bar heights as percentages; today is faded because the day is not over. */
const bars = computed(() => {
  const days = data.value?.days ?? [];
  const peak = Math.max(1, ...days.map((d) => d.visits));
  const today = new Date().toLocaleDateString('en-CA');
  return days.map((d) => ({
    height: Math.max(2, Math.round((d.visits / peak) * 100)),
    today: d.date.slice(0, 10) === today,
  }));
});

const timePerVisit = computed(() => {
  const s = data.value?.secondsPerVisit;
  if (!s) return null;
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
});
</script>

<template>
  <section class="widget">
    <div class="card__head">
      <h2 class="card__title">{{ monthName }} so far</h2>
      <RouterLink to="/analytics" class="card__link">Analytics →</RouterLink>
    </div>

    <p v-if="failed" class="card__empty">Visitor figures could not be loaded just now.</p>
    <p v-else-if="data && !data.connected" class="card__empty">{{ NOT_CONNECTED.analytics }}</p>
    <p v-else-if="!data" class="card__empty" role="status">Reading the figures…</p>

    <template v-else>
      <p class="mtd__big">
        {{ data.visits?.toLocaleString() }}
        <span class="mtd__unit">visit{{ data.visits === 1 ? '' : 's' }}</span>
      </p>
      <p v-if="change?.text" class="mtd__change" :class="`mtd__change--${change.direction}`">{{ change.text }}</p>
      <p v-else class="mtd__change mtd__change--none">No figures for last month to compare with.</p>

      <div v-if="bars.length" class="mtd__spark" aria-hidden="true">
        <span v-for="(b, i) in bars" :key="i" class="mtd__bar" :class="{ 'mtd__bar--today': b.today }"
          :style="{ height: `${b.height}%` }" />
      </div>
      <p v-if="bars.length" class="sr-only">Daily visits for {{ monthName }} so far.</p>

      <p class="mtd__foot">
        <span>{{ data.pageviews?.toLocaleString() }} page views</span>
        <span v-if="timePerVisit">{{ timePerVisit }} per visit</span>
      </p>
    </template>
  </section>
</template>

<style scoped>
/* The same box every other widget draws. A shared .card class belongs in
   main.css, but that is a sweep of its own — until then this matches rather
   than introducing a second look. */
.card__head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .25rem 1rem; margin-bottom: .9rem; }
.card__title { font-size: 1rem; font-family: var(--font-heading); margin: 0; }
.card__link { font-size: .8125rem; font-weight: 600; color: var(--color-primary); text-decoration: none; }
.card__empty { font-size: .875rem; color: var(--color-text-secondary); margin: 0; }

.mtd__big { font-family: var(--font-heading); font-size: 2rem; margin: 0; line-height: 1.1; }
.mtd__unit { font-size: .9rem; font-weight: 400; color: var(--color-text-secondary); }
.mtd__change { margin: .25rem 0 0; font-size: .8125rem; }
.mtd__change--up { color: #14532d; }
.mtd__change--down { color: #8a1f1f; }
.mtd__change--same, .mtd__change--none, .mtd__change--unknown { color: var(--color-text-secondary); }

.mtd__spark { display: flex; align-items: flex-end; gap: 2px; height: 46px; margin: .9rem 0 .5rem; }
.mtd__bar { flex: 1; min-width: 2px; background: var(--color-primary); border-radius: 1px; opacity: .85; }
.mtd__bar--today { opacity: .4; }

.mtd__foot { display: flex; flex-wrap: wrap; gap: .25rem 1rem; margin: 0; font-size: .8125rem; color: var(--color-text-secondary); }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
</style>
