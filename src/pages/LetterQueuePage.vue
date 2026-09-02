<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

interface Row {
  key: string; name: string; email: string;
  street: string; city: string; state: string; zip: string;
  totalCents: number; gifts: number; recurring: boolean;
  requested: boolean; isDonor: boolean;
  writtenAt: number | null; writtenBy: string | null; note: string | null;
}
interface Summary { total: number; written: number; noAddress: number; requested: number; irs: number }

const loading = ref(true);
const error = ref('');
const rows = ref<Row[]>([]);
const years = ref<number[]>([]);
const year = ref<number | null>(null);
const summary = ref<Summary>({ total: 0, written: 0, noAddress: 0, requested: 0, irs: 0 });
const threshold = ref(25000);
const saving = ref('');
const exporting = ref(false);

const search = ref('');
const show = ref<'todo' | 'all' | 'written' | 'noaddress' | 'requested' | 'irs'>('todo');

const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const remaining = computed(() => summary.value.total - summary.value.written);
const percent = computed(() =>
  summary.value.total ? Math.round((summary.value.written / summary.value.total) * 100) : 0
);

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (show.value === 'todo' && r.writtenAt) return false;
    if (show.value === 'written' && !r.writtenAt) return false;
    if (show.value === 'noaddress' && r.street) return false;
    if (show.value === 'requested' && !r.requested) return false;
    if (show.value === 'irs' && r.totalCents < threshold.value) return false;
    if (!q) return true;
    return [r.name, r.email, r.city, r.zip].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
});

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/letter-queue${year.value ? `?year=${year.value}` : ''}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    year.value = d.year; years.value = d.years; rows.value = d.rows;
    summary.value = d.summary; threshold.value = d.thresholdCents;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the letters.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(year, (v, old) => { if (old !== null && v !== old) load(); });

async function mark(r: Row, written: boolean) {
  saving.value = r.key;
  try {
    const res = await apiFetch('/.netlify/functions/letter-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: year.value, key: r.key, written }),
    });
    if (!res.ok) throw new Error(String(res.status));
    // Update in place rather than reloading: the list re-sorts when a row is
    // ticked, and having the page jump under the cursor mid-run is its own
    // kind of mistake.
    r.writtenAt = written ? Math.floor(Date.now() / 1000) : null;
    r.writtenBy = written ? 'you' : null;
    summary.value.written += written ? 1 : -1;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    saving.value = '';
  }
}

async function saveNote(r: Row, value: string) {
  const note = value.trim();
  if (note === (r.note ?? '')) return;
  r.note = note || null;
  await apiFetch('/.netlify/functions/letter-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: year.value, key: r.key, note }),
  });
}

async function exportCsv() {
  exporting.value = true;
  try {
    const res = await apiFetch(`/.netlify/functions/letter-queue?year=${year.value}&format=csv`);
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `letters-${year.value}.csv`; a.click();
    URL.revokeObjectURL(url);
  } catch {
    error.value = 'Could not export.';
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <DashboardLayout page-title="Year-end letters">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <template v-else>
      <div class="widget bar">
        <label class="bar__year">
          <span>Year</span>
          <select v-model.number="year">
            <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
          </select>
        </label>
        <button type="button" class="btn btn--ghost btn--sm" :disabled="exporting" @click="exportCsv">
          {{ exporting ? 'Preparing…' : 'Export list' }}
        </button>
      </div>

      <!-- The one number Mona actually wants: how much is left. -->
      <div class="widget progress">
        <div class="progress__head">
          <p class="progress__lead"><strong>{{ remaining }}</strong> letters left to write</p>
          <p class="progress__sub">{{ summary.written }} of {{ summary.total }} done</p>
        </div>
        <div class="progress__track" role="img" :aria-label="`${percent} percent written`">
          <div class="progress__fill" :style="{ width: `${percent}%` }"></div>
        </div>
        <p v-if="summary.noAddress" class="progress__warn">
          {{ summary.noAddress }} {{ summary.noAddress === 1 ? 'person has' : 'people have' }} no mailing
          address, so {{ summary.noAddress === 1 ? 'that letter' : 'those letters' }} cannot be sent.
        </p>
      </div>

      <section class="widget block">
        <h2 class="block__title">Letters ({{ visible.length }})</h2>
        <p class="block__hint">
          Everyone who gave in {{ year }}, plus anyone who asked for a letter. Someone in both appears
          once. Where a request gave an address, that one is used — it was given for this.
        </p>

        <div class="find">
          <input v-model="search" type="search" class="find__q" placeholder="Search name, email, city or ZIP…" aria-label="Search letters" />
          <div class="seg" role="group" aria-label="Filter letters">
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'todo' }]" @click="show = 'todo'">To write ({{ remaining }})</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'written' }]" @click="show = 'written'">Written ({{ summary.written }})</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'requested' }]" @click="show = 'requested'">Asked ({{ summary.requested }})</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'irs' }]" @click="show = 'irs'">IRS ({{ summary.irs }})</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'noaddress' }]" @click="show = 'noaddress'">No address ({{ summary.noAddress }})</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'all' }]" @click="show = 'all'">All</button>
          </div>
        </div>

        <p v-if="!visible.length" class="state">Nothing here.</p>

        <div v-else class="tablewrap">
          <table class="tbl">
            <thead>
              <tr>
                <th class="tick"><span class="sr">Written</span></th>
                <th>Who</th><th>Address</th><th class="num">Gave</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in visible" :key="r.key" :class="{ 'row--done': r.writtenAt }">
                <td class="tick">
                  <input
                    type="checkbox"
                    :checked="!!r.writtenAt"
                    :disabled="saving === r.key"
                    :aria-label="`Mark letter to ${r.name} as written`"
                    @change="mark(r, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>
                  <strong>{{ r.name || '(no name)' }}</strong>
                  <span v-if="r.requested" class="flag flag--asked">asked for one</span>
                  <span v-if="!r.isDonor" class="flag">no gift this year</span>
                  <span v-if="r.totalCents >= threshold" class="flag flag--irs">IRS ack</span>
                  <br /><span class="dim">{{ r.email || '—' }}</span>
                  <p v-if="r.writtenAt" class="dim">
                    Written {{ day(r.writtenAt) }}<template v-if="r.writtenBy"> by {{ r.writtenBy }}</template>
                  </p>
                </td>
                <td>
                  <template v-if="r.street">
                    {{ r.street }}<br />{{ r.city }}, {{ r.state }} {{ r.zip }}
                  </template>
                  <span v-else class="flag flag--warn">no address</span>
                </td>
                <td class="num">
                  <strong v-if="r.gifts">{{ money(r.totalCents) }}</strong>
                  <span v-else class="dim">—</span>
                  <span v-if="r.gifts" class="dim">{{ r.gifts }} {{ r.gifts === 1 ? 'gift' : 'gifts' }}</span>
                  <span v-if="r.recurring" class="dim">monthly</span>
                </td>
                <td>
                  <input
                    class="note"
                    type="text"
                    :value="r.note ?? ''"
                    placeholder="—"
                    :aria-label="`Note about the letter to ${r.name}`"
                    @change="saveNote(r, ($event.target as HTMLInputElement).value)"
                  />
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
.state { color: var(--color-text-secondary); font-size: .875rem; }
.state--err { color: #8a1f1f; margin-bottom: .75rem; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.bar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; justify-content: space-between; margin-bottom: 1rem; }
.bar__year { display: flex; flex-direction: column; gap: .2rem; font-size: .75rem; color: var(--color-text-secondary); }
.bar__year select { padding: .4rem .5rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }

.progress { margin-bottom: 1rem; }
.progress__head { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; justify-content: space-between; }
.progress__lead { font-size: 1.05rem; margin: 0; }
.progress__sub { font-size: .8125rem; color: var(--color-text-secondary); margin: 0; }
.progress__track { height: .5rem; background: var(--color-bg); border-radius: 999px; overflow: hidden; margin-top: .6rem; }
.progress__fill { height: 100%; background: var(--color-primary-strong); border-radius: 999px; transition: width .2s ease; }
.progress__warn { font-size: .8125rem; color: #8a5a1f; margin: .6rem 0 0; }

.block__title { margin-bottom: .1rem; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 .9rem; max-width: 70ch; }

.find { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
.find__q { flex: 1 1 14rem; min-width: 0; padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.seg { display: flex; flex-wrap: wrap; gap: .3rem; }
.seg__b { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .35rem .6rem; font: inherit; font-size: .75rem; cursor: pointer; color: var(--color-text); }
.seg__b--on { border-color: var(--color-primary-strong); color: var(--color-primary-strong); font-weight: 600; }

.tablewrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: .8125rem; }
.tbl th { text-align: left; font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); padding: .4rem .5rem; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
.tbl td { padding: .55rem .5rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
.tick { width: 2rem; }
.tick input { width: 1.05rem; height: 1.05rem; cursor: pointer; }
.row--done { opacity: .55; }
.row--done strong { font-weight: 500; }
.num { text-align: right; white-space: nowrap; }
.num .dim { display: block; }
.dim { color: var(--color-text-secondary); font-size: .75rem; margin: 0; }
.note { width: 100%; min-width: 8rem; padding: .3rem .4rem; font: inherit; font-size: .75rem; border: 1px solid transparent; border-radius: var(--border-radius); background: transparent; color: var(--color-text); }
.note:hover, .note:focus { border-color: var(--color-border); background: var(--color-surface); }

.flag { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; border-radius: 999px; padding: .05rem .4rem; margin-left: .35rem; color: var(--color-text-secondary); background: var(--color-bg); }
.flag--asked { color: var(--color-primary-strong); background: color-mix(in srgb, var(--color-primary-strong) 10%, transparent); }
.flag--irs { color: #6b5a1f; background: color-mix(in srgb, #6b5a1f 10%, transparent); }
.flag--warn { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 10%, transparent); }
</style>
