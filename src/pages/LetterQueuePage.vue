<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';
import { readSheet, matchColumns, toPeople, type Person } from '@/lib/spreadsheet';

interface Row {
  key: string; name: string; email: string;
  street: string; city: string; state: string; zip: string;
  totalCents: number; gifts: number; recurring: boolean;
  requested: boolean; isDonor: boolean; addedManually: boolean;
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

// ── Adding people by hand ────────────────────────────────────────────────
const adding = ref(false);
const blank = (): Person => ({ firstName: '', lastName: '', street: '', city: '', state: 'CO', zip: '', email: '' });
const draft = ref<Person>(blank());
const addBusy = ref(false);
const addMsg = ref('');

// Import: parsed and shown for review before anything is written. A bulk add
// of unseen rows into a mailing list is not something to do on trust.
const preview = ref<Person[] | null>(null);
const previewName = ref('');
const importErr = ref('');

async function addOne() {
  addBusy.value = true; addMsg.value = ''; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/letter-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', year: year.value, person: draft.value }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || (d.rejected?.[0]?.reason ?? String(res.status)));
    if (d.added) { addMsg.value = `Added ${draft.value.firstName} ${draft.value.lastName}.`; draft.value = blank(); await load(); }
    else if (d.duplicates?.length) addMsg.value = `${d.duplicates[0]} is already on this year's list.`;
    else addMsg.value = d.rejected?.[0]?.reason ? `Not added — ${d.rejected[0].reason}.` : 'Not added.';
  } catch (e) {
    addMsg.value = e instanceof Error ? e.message : 'Could not add.';
  } finally { addBusy.value = false; }
}

async function pickFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  importErr.value = ''; preview.value = null; previewName.value = file.name;
  try {
    const sheet = await readSheet(file);
    const map = matchColumns(sheet.headers);
    if (map.street === undefined || (map.firstName === undefined && map.fullName === undefined)) {
      throw new Error(`Could not find a name and address column. The file's columns are: ${sheet.headers.join(', ')}.`);
    }
    const people = toPeople(sheet.rows, map);
    if (!people.length) throw new Error('No rows found under the headers.');
    preview.value = people;
  } catch (e) {
    importErr.value = e instanceof Error ? e.message : 'Could not read that file.';
  } finally {
    (ev.target as HTMLInputElement).value = '';
  }
}

async function confirmImport() {
  if (!preview.value) return;
  addBusy.value = true; addMsg.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/letter-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'addBulk', year: year.value, people: preview.value }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    const bits = [`Added ${d.added}`];
    if (d.duplicates?.length) bits.push(`${d.duplicates.length} already on the list`);
    if (d.rejected?.length) bits.push(`${d.rejected.length} skipped for a missing name or address`);
    addMsg.value = bits.join(' · ') + '.';
    preview.value = null;
    await load();
  } catch (e) {
    importErr.value = e instanceof Error ? e.message : 'Could not import.';
  } finally { addBusy.value = false; }
}
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
        <button type="button" class="btn btn--sm" @click="adding = !adding; addMsg = ''">
          {{ adding ? 'Close' : 'Add someone' }}
        </button>
        <button type="button" class="btn btn--ghost btn--sm" :disabled="exporting" @click="exportCsv">
          {{ exporting ? 'Preparing…' : 'Export list' }}
        </button>
      </div>

      <section v-if="adding" class="widget addbox">
        <h2 class="block__title">Add someone to this year's letters</h2>
        <p class="block__hint">
          For anyone not already here — a board member, a partner, someone who gave outside Stripe.
          An address is required, since the letter has to be posted somewhere. Email is optional.
        </p>

        <div class="addbox__grid">
          <label>First name<input v-model="draft.firstName" type="text" /></label>
          <label>Last name<input v-model="draft.lastName" type="text" /></label>
          <label class="wide">Street<input v-model="draft.street" type="text" /></label>
          <label>City<input v-model="draft.city" type="text" /></label>
          <label>State<input v-model="draft.state" type="text" maxlength="2" /></label>
          <label>ZIP<input v-model="draft.zip" type="text" /></label>
          <label class="wide">Email <span class="dim">(optional)</span><input v-model="draft.email" type="email" /></label>
        </div>
        <button type="button" class="btn btn--sm" :disabled="addBusy" @click="addOne">
          {{ addBusy ? 'Adding…' : 'Add to the list' }}
        </button>

        <h3 class="addbox__sub">Or add several from a file</h3>
        <p class="block__hint">
          A spreadsheet with a row per person. Excel (.xlsx) or CSV both work. The columns are matched
          by name — "First Name", "Address 1", "Zip Code" and similar are all understood — and nothing
          is added until you have seen what was read.
        </p>
        <input type="file" accept=".csv,.xlsx,.txt" @change="pickFile" />
        <p v-if="importErr" class="addbox__err" role="alert">{{ importErr }}</p>

        <template v-if="preview">
          <p class="addbox__ok">
            Read <strong>{{ preview.length }}</strong>
            {{ preview.length === 1 ? 'person' : 'people' }} from {{ previewName }}. Check them before adding.
          </p>
          <div class="tablewrap">
            <table class="tbl">
              <thead><tr><th>Name</th><th>Address</th><th>Email</th></tr></thead>
              <tbody>
                <tr v-for="(p, i) in preview.slice(0, 15)" :key="i">
                  <td>{{ p.firstName }} {{ p.lastName }}</td>
                  <td>{{ p.street }}<template v-if="p.city">, {{ p.city }}</template> {{ p.state }} {{ p.zip }}</td>
                  <td class="dim">{{ p.email || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="preview.length > 15" class="dim">…and {{ preview.length - 15 }} more.</p>
          <div class="addbox__actions">
            <button type="button" class="btn btn--sm" :disabled="addBusy" @click="confirmImport">
              {{ addBusy ? 'Adding…' : `Add all ${preview.length}` }}
            </button>
            <button type="button" class="linkish" @click="preview = null">Cancel</button>
          </div>
        </template>

        <p v-if="addMsg" class="addbox__ok">{{ addMsg }}</p>
      </section>

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
                  <span v-if="r.addedManually" class="flag flag--asked">added by hand</span>
                  <span v-else-if="r.requested" class="flag flag--asked">asked for one</span>
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

.addbox { margin-bottom: 1rem; }
.addbox__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .6rem; margin: .5rem 0 .8rem; }
.addbox__grid label { display: flex; flex-direction: column; gap: .2rem; font-size: .75rem; color: var(--color-text-secondary); }
.addbox__grid .wide { grid-column: span 2; }
.addbox__grid input { padding: .4rem .5rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.addbox__sub { font-family: var(--font-heading); font-size: .7rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin: 1.4rem 0 .3rem; }
.addbox__err { font-size: .8125rem; color: #8a1f1f; margin: .6rem 0 0; }
.addbox__ok { font-size: .8125rem; color: var(--color-text); margin: .8rem 0 .4rem; }
.addbox__actions { display: flex; gap: .8rem; align-items: baseline; margin-top: .7rem; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .8125rem; color: var(--color-primary-strong); cursor: pointer; }

.flag { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; border-radius: 999px; padding: .05rem .4rem; margin-left: .35rem; color: var(--color-text-secondary); background: var(--color-bg); }
.flag--asked { color: var(--color-primary-strong); background: color-mix(in srgb, var(--color-primary-strong) 10%, transparent); }
.flag--irs { color: #6b5a1f; background: color-mix(in srgb, #6b5a1f 10%, transparent); }
.flag--warn { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 10%, transparent); }
</style>
