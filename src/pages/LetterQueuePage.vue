<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

// Mona's year-end letters, as a list to work down rather than a list to read.
//
// The form promises a letter to financial partners at the end of each year, so
// this is one batch per year written by hand over several sittings. Marking a
// name written is the whole point: it is what makes the queue resumable.

interface Row {
  id: string; first_name: string; last_name: string;
  street: string; city: string; state: string; zip: string; email: string;
  submitted_at: number; written_at: number | null; written_by: string | null; note: string | null;
  duplicate: boolean;
  /** null when the donor lookup could not run — not the same as "never gave". */
  isDonor: boolean | null;
}

const rows = ref<Row[]>([]);
const years = ref<string[]>([]);
const year = ref('');
const total = ref(0);
const written = ref(0);
const loading = ref(true);
const error = ref('');
const busyId = ref<string | null>(null);
const show = ref<'todo' | 'done' | 'all'>('todo');
const noteFor = ref<string | null>(null);
const noteText = ref('');

const visible = computed(() =>
  rows.value.filter((r) =>
    show.value === 'all' ? true : show.value === 'done' ? !!r.written_at : !r.written_at
  )
);
const remaining = computed(() => total.value - written.value);
const name = (r: Row) => `${r.first_name} ${r.last_name}`.trim();

const fmt = (s: number | null) =>
  s ? new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/letter-queue${year.value ? `?year=${year.value}` : ''}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    rows.value = d.rows; years.value = d.years; year.value = d.year;
    total.value = d.total; written.value = d.written;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the letter queue.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(year, (v, old) => { if (old !== '' && v !== old) load(); });

async function post(payload: Record<string, unknown>, id: string) {
  busyId.value = id; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/letter-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...payload }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    busyId.value = null;
  }
}

const toggle = (r: Row) => post({ written: !r.written_at }, r.id);

const printList = () => window.print();

function openNote(r: Row) { noteFor.value = r.id; noteText.value = r.note ?? ''; }
async function saveNote(r: Row) { await post({ note: noteText.value }, r.id); noteFor.value = null; }
</script>

<template>
  <DashboardLayout page-title="Letters from Mona">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <template v-else>
      <div class="widget bar no-print">
        <div class="bar__left">
          <label class="bar__year">
            <span>Year</span>
            <select v-model="year">
              <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
            </select>
          </label>
          <p class="bar__count">
            <strong>{{ remaining }}</strong> to write
            <span class="bar__sub">· {{ written }} of {{ total }} done</span>
          </p>
        </div>
        <div class="bar__right">
          <div class="seg" role="group" aria-label="Filter">
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'todo' }]" @click="show = 'todo'">To write</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'done' }]" @click="show = 'done'">Written</button>
            <button type="button" :class="['seg__b', { 'seg__b--on': show === 'all' }]" @click="show = 'all'">All</button>
          </div>
          <button type="button" class="btn btn--sm" :disabled="!visible.length" @click="printList">Print addresses</button>
        </div>
      </div>

      <p v-if="!years.length" class="state">No letter requests yet.</p>
      <p v-else-if="!visible.length" class="state">
        {{ show === 'todo' ? 'Every letter for this year is written.' : 'Nothing here.' }}
      </p>

      <!-- One card per letter: the address as it should be written, and a tick. -->
      <ol v-else class="queue">
        <li v-for="r in visible" :key="r.id" class="letter" :class="{ 'letter--done': r.written_at }">
          <div class="letter__addr">
            <p class="letter__name">{{ name(r) }}</p>
            <p class="letter__line">{{ r.street }}</p>
            <p class="letter__line">{{ r.city }}, {{ r.state }} {{ r.zip }}</p>
            <p class="letter__meta no-print">
              {{ r.email }} · asked {{ fmt(r.submitted_at) }}
              <span v-if="r.isDonor === false" class="flag flag--info">no donation on record</span>
              <span v-else-if="r.isDonor === null" class="flag flag--info">donor check unavailable</span>
              <span v-if="r.duplicate" class="flag flag--warn">possible duplicate</span>
            </p>
            <p v-if="r.note" class="letter__note">{{ r.note }}</p>
          </div>

          <div class="letter__side no-print">
            <label class="chk">
              <input type="checkbox" :checked="!!r.written_at" :disabled="busyId === r.id" @change="toggle(r)" />
              <span>Written</span>
            </label>
            <p v-if="r.written_at" class="letter__by">{{ fmt(r.written_at) }}<br />{{ r.written_by }}</p>
            <button v-if="noteFor !== r.id" type="button" class="linkish" @click="openNote(r)">
              {{ r.note ? 'Edit note' : 'Add note' }}
            </button>
            <template v-else>
              <input v-model="noteText" type="text" class="letter__noteinput" placeholder="e.g. returned to sender" />
              <button type="button" class="linkish" :disabled="busyId === r.id" @click="saveNote(r)">Save</button>
              <button type="button" class="linkish" @click="noteFor = null">Cancel</button>
            </template>
          </div>
        </li>
      </ol>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.widget { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1rem 1.25rem; }
.state { color: var(--color-text-secondary); font-size: .875rem; }
.state--err { color: #8a1f1f; }

.bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.bar__left { display: flex; align-items: center; gap: 1.25rem; }
.bar__right { display: flex; align-items: center; gap: .75rem; }
.bar__year { display: flex; align-items: center; gap: .4rem; font-size: .75rem; color: var(--color-text-secondary); }
.bar__year select { padding: .35rem .5rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.bar__count { margin: 0; font-size: .875rem; }
.bar__sub { color: var(--color-text-secondary); font-size: .8125rem; }

.seg { display: inline-flex; border: 1px solid var(--color-border); border-radius: var(--border-radius); overflow: hidden; }
.seg__b { background: none; border: 0; padding: .35rem .7rem; font: inherit; font-size: .75rem; cursor: pointer; color: var(--color-text-secondary); }
.seg__b--on { background: var(--color-primary-strong); color: #fff; font-weight: 600; }

.queue { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; }
.letter { display: flex; justify-content: space-between; gap: 1.25rem; padding: .9rem 1.1rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); }
.letter--done { opacity: .62; }
.letter__addr { min-width: 0; }
.letter__name { margin: 0; font-weight: 600; }
.letter__line { margin: 0; font-size: .875rem; }
.letter__meta { margin: .35rem 0 0; font-size: .75rem; color: var(--color-text-secondary); display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
.letter__note { margin: .35rem 0 0; font-size: .8125rem; font-style: italic; color: var(--color-text-secondary); }
.flag { font-size: .7rem; font-weight: 600; padding: .1rem .45rem; border-radius: 999px; }
.flag--warn { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }
.flag--info { color: #1f4f8a; background: color-mix(in srgb, #1f4f8a 12%, transparent); }
.letter__side { display: flex; flex-direction: column; align-items: flex-end; gap: .35rem; flex-shrink: 0; }
.letter__by { margin: 0; font-size: .7rem; color: var(--color-text-secondary); text-align: right; }
.letter__noteinput { padding: .35rem .5rem; font: inherit; font-size: .75rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.chk { display: inline-flex; align-items: center; gap: .35rem; font-size: .8125rem; cursor: pointer; }
.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .35rem .8rem; font-size: .8125rem; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }

/* Printing gives the addresses as a plain list to write from — no chrome, no
   tick boxes, and whichever filter is on screen is what prints. */
@media print {
  .no-print { display: none !important; }
  .letter { border: 0; padding: 0 0 1.1rem; break-inside: avoid; opacity: 1; }
  .queue { gap: 0; }
}
</style>
