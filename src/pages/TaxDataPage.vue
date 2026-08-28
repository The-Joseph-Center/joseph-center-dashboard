<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

// Year-end giving, for the two jobs it gets used for: the acknowledgment
// letters donors need, and the organizational figures that go on the 990.
//
// Read from Stripe rather than our own donations table, because that table only
// holds gifts made through the current on-site flow — the Harness-era recurring
// donors have no rows in it, and their gifts are real money.

interface Donor {
  key: string; name: string; email: string;
  address: string; city: string; state: string; zip: string;
  gifts: number; totalCents: number; refundedCents: number;
  firstGift: number; lastGift: number; recurring: boolean;
}
interface Org {
  grossCents: number; refundedCents: number; gifts: number; donorCount: number;
  averageCents: number; largestCents: number;
  recurringCents: number; oneTimeCents: number; byMonth: number[];
}

const year = ref<number | null>(null);
const years = ref<number[]>([]);
const org = ref<Org | null>(null);
const donors = ref<Donor[]>([]);
const threshold = ref(25000);
const needsLetterCount = ref(0);
const loading = ref(true);
const error = ref('');
const exporting = ref('');

const search = ref('');
const show = ref<'all' | 'letters' | 'noaddress'>('all');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortMoney = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
const day = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return donors.value.filter((d) => {
    if (show.value === 'letters' && d.totalCents < threshold.value) return false;
    if (show.value === 'noaddress' && d.address) return false;
    if (!q) return true;
    return [d.name, d.email, d.city, d.zip].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
});
const missingAddress = computed(() => donors.value.filter((d) => !d.address).length);
const peak = computed(() => Math.max(1, ...(org.value?.byMonth ?? [1])));

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/tax-summary${year.value ? `?year=${year.value}` : ''}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    year.value = d.year; years.value = d.years; org.value = d.org; donors.value = d.donors;
    threshold.value = d.thresholdCents; needsLetterCount.value = d.needsLetterCount;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load giving totals.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(year, (v, old) => { if (old !== null && v !== old) load(); });

async function exportCsv(scope: 'all' | 'letters') {
  exporting.value = scope;
  try {
    const res = await apiFetch(`/.netlify/functions/tax-summary?year=${year.value}&format=csv&scope=${scope}`);
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `giving-${year.value}${scope === 'letters' ? '-acknowledgments' : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    error.value = 'Could not export.';
  } finally {
    exporting.value = '';
  }
}
</script>

<template>
  <DashboardLayout page-title="Year-end giving">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <template v-else-if="org">
      <div class="widget bar">
        <label class="bar__year">
          <span>Year</span>
          <select v-model.number="year">
            <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
          </select>
        </label>
        <div class="bar__actions">
          <button type="button" class="btn btn--sm" :disabled="!!exporting" @click="exportCsv('letters')">
            {{ exporting === 'letters' ? 'Preparing…' : `Acknowledgment letters (${needsLetterCount})` }}
          </button>
          <button type="button" class="btn btn--ghost btn--sm" :disabled="!!exporting" @click="exportCsv('all')">
            {{ exporting === 'all' ? 'Preparing…' : 'All donors' }}
          </button>
        </div>
      </div>

      <!-- The 990 figures -->
      <div class="stats">
        <div class="stat stat--lead">
          <p class="stat__label">Total received</p>
          <p class="stat__value">{{ money(org.grossCents) }}</p>
          <p class="stat__sub">net of refunds</p>
        </div>
        <div class="stat"><p class="stat__label">Gifts</p><p class="stat__value">{{ org.gifts.toLocaleString() }}</p></div>
        <div class="stat"><p class="stat__label">Donors</p><p class="stat__value">{{ org.donorCount.toLocaleString() }}</p></div>
        <div class="stat"><p class="stat__label">Average gift</p><p class="stat__value">{{ money(org.averageCents) }}</p></div>
        <div class="stat"><p class="stat__label">Largest gift</p><p class="stat__value">{{ money(org.largestCents) }}</p></div>
        <div class="stat">
          <p class="stat__label">Recurring</p>
          <p class="stat__value">{{ money(org.recurringCents) }}</p>
          <p class="stat__sub">{{ money(org.oneTimeCents) }} one-time</p>
        </div>
      </div>

      <section class="widget block">
        <h2 class="block__title">By month</h2>
        <div class="chart" role="img" :aria-label="`Giving by month for ${year}`">
          <div v-for="(v, i) in org.byMonth" :key="i" class="chart__col">
            <span class="chart__value">{{ v ? shortMoney(v) : '' }}</span>
            <div class="chart__bar" :style="{ height: `${Math.round((v / peak) * 100)}%` }" :title="`${MONTHS[i]}: ${money(v)}`"></div>
            <span class="chart__month">{{ MONTHS[i] }}</span>
          </div>
        </div>
        <details class="table-view">
          <summary>Show as a table</summary>
          <table class="tbl">
            <thead><tr><th>Month</th><th class="num">Received</th></tr></thead>
            <tbody>
              <tr v-for="(v, i) in org.byMonth" :key="i"><td>{{ MONTHS[i] }}</td><td class="num">{{ money(v) }}</td></tr>
            </tbody>
          </table>
        </details>
      </section>

      <section class="widget block">
        <h2 class="block__title">Donors ({{ visible.length }})</h2>
        <p class="block__hint">
          {{ needsLetterCount }} gave {{ money(threshold) }} or more, the point at which a donor needs a written
          acknowledgment from you to claim the deduction. Worth confirming the treatment with your bookkeeper.
        </p>

        <div class="find">
          <input v-model="search" type="search" class="find__q" placeholder="Search name, email, city or ZIP…" aria-label="Search donors" />
          <div class="seg" role="group" aria-label="Filter donors">
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'all' }]" @click="show = 'all'">All</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'letters' }]" @click="show = 'letters'">Needs a letter</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'noaddress' }]" @click="show = 'noaddress'">
              No address ({{ missingAddress }})
            </button>
          </div>
        </div>

        <div class="tablewrap">
          <table class="tbl">
            <thead>
              <tr>
                <th>Donor</th><th>Address</th><th class="num">Gifts</th>
                <th class="num">Total</th><th>Giving</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in visible" :key="d.key">
                <td>
                  <span class="who">{{ d.name || '(no name on record)' }}</span>
                  <span class="who__sub">{{ d.email || '—' }}</span>
                </td>
                <td class="addr">
                  <template v-if="d.address">{{ d.address }}<br />{{ d.city }}, {{ d.state }} {{ d.zip }}</template>
                  <span v-else class="flag flag--warn">no address</span>
                </td>
                <td class="num">{{ d.gifts }}</td>
                <td class="num">
                  <strong>{{ money(d.totalCents) }}</strong>
                  <span v-if="d.totalCents >= threshold" class="flag flag--letter">letter</span>
                </td>
                <td class="span">
                  {{ day(d.firstGift) }}<template v-if="d.lastGift !== d.firstGift"> – {{ day(d.lastGift) }}</template>
                  <span v-if="d.recurring" class="who__sub">recurring</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.widget { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1.25rem; }
.block { margin-bottom: 1.25rem; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .35rem; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 1rem; }
.state { color: var(--color-text-secondary); }
.state--err { color: #8a1f1f; }

.bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; padding: 1rem 1.25rem; }
.bar__year { display: flex; align-items: center; gap: .4rem; font-size: .75rem; color: var(--color-text-secondary); }
.bar__year select { padding: .35rem .5rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.bar__actions { display: flex; gap: .5rem; flex-wrap: wrap; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; margin-bottom: 1.25rem; }
.stat { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .85rem 1rem; }
.stat--lead { grid-column: span 2; }
.stat__label { margin: 0; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); }
.stat__value { margin: .2rem 0 0; font-size: 1.35rem; font-weight: 700; }
.stat--lead .stat__value { font-size: 1.9rem; }
.stat__sub { margin: .1rem 0 0; font-size: .7rem; color: var(--color-text-secondary); }
@media (max-width: 520px) { .stat--lead { grid-column: span 2; } }

/* One series, so no legend — the heading names it. Bars are the plain form for
   "how much, month by month"; values sit above the bars rather than on a second
   axis. */
.chart { display: flex; align-items: flex-end; gap: .4rem; height: 9rem; margin-bottom: .5rem; }
.chart__col { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; min-width: 0; }
.chart__bar { width: 100%; max-width: 2.5rem; background: var(--color-primary-strong); border-radius: 4px 4px 0 0; min-height: 2px; }
.chart__value { font-size: .6rem; color: var(--color-text-secondary); margin-bottom: .2rem; white-space: nowrap; }
.chart__month { font-size: .65rem; color: var(--color-text-secondary); margin-top: .3rem; }
.table-view { font-size: .75rem; color: var(--color-text-secondary); }
.table-view summary { cursor: pointer; }
.table-view .tbl { max-width: 20rem; margin-top: .5rem; }

.find { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
.find__q { flex: 1 1 14rem; min-width: 0; padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.seg { display: inline-flex; border: 1px solid var(--color-border); border-radius: var(--border-radius); overflow: hidden; }
.seg__b { background: none; border: 0; padding: .35rem .7rem; font: inherit; font-size: .75rem; cursor: pointer; color: var(--color-text-secondary); }
.seg__b--on { background: var(--color-primary-strong); color: #fff; font-weight: 600; }

.tablewrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: .8125rem; }
.tbl th { text-align: left; font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); padding: .4rem .5rem; border-bottom: 1px solid var(--color-border); }
.tbl td { padding: .5rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
.num { text-align: right; white-space: nowrap; }
.who { display: block; font-weight: 600; }
.who__sub { display: block; font-size: .7rem; color: var(--color-text-secondary); }
.addr { font-size: .75rem; color: var(--color-text-secondary); }
.span { font-size: .75rem; color: var(--color-text-secondary); white-space: nowrap; }
.flag { display: inline-block; margin-left: .35rem; font-size: .65rem; font-weight: 600; padding: .1rem .4rem; border-radius: 999px; }
.flag--warn { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }
.flag--letter { color: #14532d; background: color-mix(in srgb, #14532d 12%, transparent); }

.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .35rem .8rem; font-size: .8125rem; }
.btn--ghost { background: none; color: var(--color-text-secondary); border: 1px solid var(--color-border); }
.btn:disabled { opacity: .6; cursor: not-allowed; }
</style>
