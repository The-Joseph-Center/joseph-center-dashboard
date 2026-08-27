<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { RouterLink } from 'vue-router';
import { apiFetch } from '@/lib/api';

// Opening, closing and editing the seasonal forms — Angel Tree, Easter baskets.
//
// These edit the same Sanity documents the public page reads, so what is saved
// here is what the site serves. The slug is not editable and new forms cannot be
// created: the slug is the URL and the key every past submission is filed under,
// and the form pages are hardcoded routes in the site.

interface Field {
  _key?: string; label: string; name: string; type: string;
  required: boolean; options?: string[];
}
interface Form {
  _id: string; title: string; slug: string; active: boolean;
  activeDates: { start?: string; end?: string } | null;
  description: string; successMessage: string; notifyEmail: string;
  fields: Field[];
  status: { open: boolean; state: 'closed' | 'open' | 'before-start' | 'after-end' };
  years: { year: string; count: number }[];
  total: number;
}

const forms = ref<Form[]>([]);
const fieldTypes = ref<string[]>([]);
const loading = ref(true);
const error = ref('');
const savingId = ref<string | null>(null);
const savedId = ref<string | null>(null);
const editing = ref<string | null>(null);

// Local edit buffers, so a half-finished edit is never sent and Cancel is real.
const draft = ref<Record<string, {
  title: string; description: string; successMessage: string; notifyEmail: string;
  startAt: string; endAt: string; fields: Field[];
}>>({});

// Built here rather than on the server: Netlify runs in UTC, and a date
// formatted there reads a day out in Colorado whenever the boundary is near
// midnight. The server decides open or closed; the browser says it in the
// reader's own timezone.
const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

function statusLabel(f: Form): string {
  switch (f.status.state) {
    case 'before-start': return `Opens ${day(f.activeDates?.start)}`;
    case 'after-end': return `Closed ${day(f.activeDates?.end)}`;
    case 'open': return f.activeDates?.end ? `Open until ${day(f.activeDates.end)}` : 'Open';
    default: return 'Closed';
  }
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Text', email: 'Email', phone: 'Phone', number: 'Number',
  textarea: 'Long text', select: 'Dropdown',
};

// Sanity stores a full ISO datetime; <input type="datetime-local"> wants
// YYYY-MM-DDTHH:mm with no zone, in local time.
const toLocalInput = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-forms');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    forms.value = d.forms; fieldTypes.value = d.fieldTypes;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the forms.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function edit(f: Form) {
  draft.value = {
    ...draft.value,
    [f._id]: {
      title: f.title ?? '', description: f.description ?? '',
      successMessage: f.successMessage ?? '', notifyEmail: f.notifyEmail ?? '',
      startAt: toLocalInput(f.activeDates?.start), endAt: toLocalInput(f.activeDates?.end),
      fields: (f.fields ?? []).map((x) => ({ ...x, options: [...(x.options ?? [])] })),
    },
  };
  editing.value = f._id;
}

async function toggle(f: Form) {
  savingId.value = f._id; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', _id: f._id, active: !f.active }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not change the form.';
  } finally {
    savingId.value = null;
  }
}

const confirmFor = ref<{ id: string; message: string } | null>(null);

async function save(f: Form, confirmKeyChange = false) {
  const d = draft.value[f._id];
  if (!d) return;
  savingId.value = f._id; savedId.value = null; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _id: f._id, title: d.title, description: d.description,
        successMessage: d.successMessage, notifyEmail: d.notifyEmail,
        startAt: fromLocalInput(d.startAt), endAt: fromLocalInput(d.endAt),
        fields: d.fields, confirmKeyChange,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.needsConfirm) {
      confirmFor.value = { id: f._id, message: data.error };
      return;
    }
    if (!res.ok) throw new Error(data.error || String(res.status));
    confirmFor.value = null;
    savedId.value = f._id;
    editing.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    savingId.value = null;
  }
}

function addField(id: string) {
  draft.value[id]?.fields.push({ label: '', name: '', type: 'text', required: false, options: [] });
}
function removeField(id: string, i: number) {
  draft.value[id]?.fields.splice(i, 1);
}
function move(id: string, i: number, by: number) {
  const list = draft.value[id]?.fields;
  if (!list) return;
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
}
// Options are edited as one-per-line, which is how they read on the form.
const optionsText = (f: Field) => (f.options ?? []).join('\n');
function setOptions(f: Field, value: string) {
  f.options = value.split('\n').map((s) => s.trim()).filter(Boolean);
}

const busy = computed(() => (id: string) => savingId.value === id);
</script>

<template>
  <DashboardLayout page-title="Seasonal forms">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <template v-else>
      <div class="widget intro">
        <p class="intro__text">
          Open or close a form, change what it says, and edit its questions. Changes
          are live on the site as soon as they are saved — no deploy needed.
          The web address and the list of forms are set in the site's code.
        </p>
      </div>

      <section v-for="f in forms" :key="f._id" class="widget block">
        <header class="head">
          <div>
            <h2 class="block__title">{{ f.title }}</h2>
            <p class="block__hint">/forms/{{ f.slug }} · {{ f.total }} submission{{ f.total === 1 ? '' : 's' }} all time</p>
          </div>
          <div class="head__right">
            <span class="pill" :class="f.status.open ? 'pill--open' : 'pill--shut'">{{ statusLabel(f) }}</span>
            <button type="button" class="btn btn--sm" :disabled="busy(f._id)" @click="toggle(f)">
              {{ f.active ? 'Close form' : 'Open form' }}
            </button>
          </div>
        </header>

        <!-- Reporting by year -->
        <div v-if="f.years.length" class="years">
          <span v-for="y in f.years" :key="y.year" class="years__item">
            <strong>{{ y.year }}</strong> {{ y.count }}
          </span>
          <RouterLink class="linkish" :to="`/submissions`">Open in Submissions →</RouterLink>
        </div>
        <p v-else class="block__hint">No submissions recorded yet.</p>

        <p v-if="savedId === f._id" class="ok">Saved.</p>

        <button v-if="editing !== f._id" type="button" class="linkish" @click="edit(f)">
          Edit questions and messages
        </button>

        <!-- Editor -->
        <div v-else-if="draft[f._id]" class="editor">
          <label class="f"><span>Form title</span><input v-model="draft[f._id]!.title" type="text" /></label>
          <label class="f">
            <span>Intro shown above the questions</span>
            <textarea v-model="draft[f._id]!.description" rows="3" />
          </label>
          <label class="f">
            <span>Message after submitting</span>
            <textarea v-model="draft[f._id]!.successMessage" rows="2" />
          </label>
          <div class="grid2">
            <label class="f">
              <span>Email each submission to</span>
              <input v-model="draft[f._id]!.notifyEmail" type="email" placeholder="leave blank for none" />
            </label>
            <div class="grid2">
              <label class="f"><span>Opens (optional)</span><input v-model="draft[f._id]!.startAt" type="datetime-local" /></label>
              <label class="f"><span>Closes (optional)</span><input v-model="draft[f._id]!.endAt" type="datetime-local" /></label>
            </div>
          </div>

          <h3 class="sub">Questions</h3>
          <div v-for="(fl, i) in draft[f._id]!.fields" :key="i" class="field">
            <div class="field__top">
              <label class="f f--grow"><span>Label</span><input v-model="fl.label" type="text" /></label>
              <label class="f"><span>Key</span><input v-model="fl.name" type="text" /></label>
              <label class="f">
                <span>Type</span>
                <select v-model="fl.type">
                  <option v-for="t in fieldTypes" :key="t" :value="t">{{ TYPE_LABELS[t] ?? t }}</option>
                </select>
              </label>
            </div>
            <div class="field__row">
              <label class="chk"><input v-model="fl.required" type="checkbox" /><span>Required</span></label>
              <button type="button" class="linkish" :disabled="i === 0" @click="move(f._id, i, -1)">Move up</button>
              <button type="button" class="linkish" :disabled="i === draft[f._id]!.fields.length - 1" @click="move(f._id, i, 1)">Move down</button>
              <button type="button" class="linkish linkish--danger" @click="removeField(f._id, i)">Remove</button>
            </div>
            <label v-if="fl.type === 'select'" class="f">
              <span>Dropdown options — one per line</span>
              <textarea :value="optionsText(fl)" rows="3" @input="setOptions(fl, ($event.target as HTMLTextAreaElement).value)" />
            </label>
          </div>

          <button type="button" class="linkish" @click="addField(f._id)">+ Add a question</button>

          <p v-if="confirmFor?.id === f._id" class="warn" role="alert">
            {{ confirmFor.message }}
            <button type="button" class="btn btn--danger btn--sm" @click="save(f, true)">Save anyway</button>
          </p>

          <div class="editor__actions">
            <button type="button" class="btn btn--sm" :disabled="busy(f._id)" @click="save(f)">
              {{ busy(f._id) ? 'Saving…' : 'Save changes' }}
            </button>
            <button type="button" class="linkish" @click="editing = null; confirmFor = null">Cancel</button>
          </div>
        </div>
      </section>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.widget { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1.25rem; }
.block { margin-bottom: 1.25rem; }
.intro { margin-bottom: 1.25rem; }
.intro__text { margin: 0; font-size: .8125rem; color: var(--color-text-secondary); line-height: 1.6; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .2rem; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 .75rem; }
.state { color: var(--color-text-secondary); }
.state--err { color: #8a1f1f; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.head__right { display: flex; align-items: center; gap: .6rem; }
.pill { font-size: .7rem; font-weight: 600; padding: .2rem .55rem; border-radius: 999px; }
.pill--open { color: #14532d; background: color-mix(in srgb, #14532d 12%, transparent); }
.pill--shut { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }
.years { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; font-size: .8125rem; margin: 0 0 .75rem; }
.years__item { color: var(--color-text-secondary); }
.years__item strong { color: var(--color-text); }
.ok { font-size: .75rem; color: var(--color-primary-strong); margin: 0 0 .5rem; }
.editor { margin-top: .9rem; border-top: 1px solid var(--color-border); padding-top: .9rem; }
.sub { font-family: var(--font-heading); font-size: .8125rem; margin: 1rem 0 .5rem; }
.f { display: block; margin-bottom: .6rem; }
.f--grow { flex: 1 1 12rem; }
.f > span { display: block; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: .25rem; }
.f input, .f select, .f textarea { width: 100%; padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
@media (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } }
.field { border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .7rem; margin-bottom: .6rem; background: var(--color-bg); }
.field__top { display: flex; gap: .6rem; flex-wrap: wrap; }
.field__row { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; }
.chk { display: inline-flex; align-items: center; gap: .3rem; font-size: .75rem; cursor: pointer; }
.warn { font-size: .8125rem; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 8%, transparent); border-radius: var(--border-radius); padding: .6rem .7rem; display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
.editor__actions { display: flex; align-items: center; gap: .9rem; margin-top: .9rem; }
.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .35rem .8rem; font-size: .8125rem; }
.btn--danger { background: #8a1f1f; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }
.linkish:disabled { opacity: .5; cursor: not-allowed; text-decoration: none; }
.linkish--danger { color: #8a1f1f; }
</style>
