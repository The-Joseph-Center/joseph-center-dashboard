<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';
import type { Column } from '@/lib/submissionForms';
import { formatSubmissionValue } from '@/lib/submission-display';

// Everything the public forms collect, in one place.
//
// Which forms appear is decided per form by the caller's Okta groups, on the
// server — this page renders what came back rather than deciding anything, so
// there is nothing here to get out of step with the Functions.

interface FormSummary {
  id: string; label: string; description: string;
  sensitive: string | null; total: number; latest: number | null;
}
interface FormMeta {
  id: string; label: string; description: string; sensitive: string | null;
  columns: Column[]; exportable: boolean; groupColumn: string | null;
}

const forms = ref<FormSummary[]>([]);
const active = ref<string>('');
const meta = ref<FormMeta | null>(null);
const rows = ref<Record<string, unknown>[]>([]);
const total = ref(0);
const years = ref<string[]>([]);
const groups = ref<string[]>([]);
const opened = ref<number | null>(null);

const search = ref('');
const year = ref('');
const group = ref('');
const offset = ref(0);
const PAGE = 50;

const loading = ref(true);
const rowsLoading = ref(false);
const error = ref('');

const primary = computed(() => meta.value?.columns.filter((c) => c.primary) ?? []);
const filtering = computed(() => !!search.value.trim() || !!year.value || !!group.value);

const fmtDate = (v: unknown) =>
  v == null ? '' : new Date(Number(v) * 1000).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });

function display(col: Column, value: unknown): string {
  if (value == null || value === '') return '—';
  if (col.type === 'date') return fmtDate(value);
  if (col.type === 'bool') return value ? 'Yes' : 'No';
  // Stored answers are JSON; people are not. See lib/submission-display —
  // the volunteer inbox was showing ["whereverNeeded"] and a nested
  // availability object instead of the wording the person actually chose.
  if (col.type === 'json') return formatSubmissionValue(value);
  return String(value);
}

async function loadForms() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/list-submissions');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    forms.value = (await res.json()).forms;
    const first = forms.value[0];
    if (first && !active.value) active.value = first.id;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the form list.';
  } finally {
    loading.value = false;
  }
}

async function loadRows() {
  if (!active.value) return;
  rowsLoading.value = true; error.value = ''; opened.value = null;
  try {
    const params = new URLSearchParams({ form: active.value, limit: String(PAGE), offset: String(offset.value) });
    if (search.value.trim()) params.set('q', search.value.trim());
    if (year.value) params.set('year', year.value);
    if (group.value) params.set('group', group.value);
    const res = await apiFetch(`/.netlify/functions/list-submissions?${params}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    meta.value = d.form; rows.value = d.rows; total.value = d.total;
    years.value = d.years; groups.value = d.groups;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load submissions.';
  } finally {
    rowsLoading.value = false;
  }
}

onMounted(async () => { await loadForms(); await loadRows(); });

function pick(id: string) {
  if (id === active.value) return;
  active.value = id; search.value = ''; year.value = ''; group.value = ''; offset.value = 0;
  loadRows();
}

let debounce: number | undefined;
watch(search, () => {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => { offset.value = 0; loadRows(); }, 300);
});
watch([year, group], () => { offset.value = 0; loadRows(); });

function page(by: number) {
  offset.value = Math.max(0, offset.value + by);
  loadRows();
}

// The browser cannot be sent straight at the endpoint — it would arrive without
// the bearer token — so the CSV is fetched with auth and saved from memory.
const exporting = ref(false);
async function exportCsv() {
  if (!meta.value?.exportable) return;
  exporting.value = true;
  try {
    const params = new URLSearchParams({ form: active.value, format: 'csv' });
    if (year.value) params.set('year', year.value);
    if (group.value) params.set('group', group.value);
    if (search.value.trim()) params.set('q', search.value.trim());
    const res = await apiFetch(`/.netlify/functions/list-submissions?${params}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active.value}${year.value ? `-${year.value}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not export.';
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <DashboardLayout page-title="Submissions">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="!forms.length" class="state">
      No form inboxes are shared with your account.
    </p>

    <template v-else>
      <nav class="tabs">
        <button
          v-for="f in forms"
          :key="f.id"
          type="button"
          class="tab"
          :class="{ 'tab--on': f.id === active }"
          @click="pick(f.id)"
        >
          {{ f.label }}
          <span class="tab__count">{{ f.total }}</span>
        </button>
      </nav>

      <p v-if="error" class="state state--err" role="alert">{{ error }}</p>

      <section class="widget">
        <h2 class="block__title">{{ meta?.label ?? '' }}</h2>
        <p class="block__hint">{{ meta?.description ?? '' }}</p>
        <p v-if="meta?.sensitive" class="notice">{{ meta.sensitive }}</p>

        <div class="find">
          <input v-model="search" type="search" class="find__q" placeholder="Search…" aria-label="Search submissions" />
          <select v-if="years.length" v-model="year" aria-label="Filter by year">
            <option value="">All years</option>
            <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
          </select>
          <select v-if="groups.length" v-model="group" :aria-label="`Filter by ${meta?.groupColumn}`">
            <option value="">All</option>
            <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
          </select>
          <button
            v-if="meta?.exportable"
            type="button"
            class="btn btn--sm"
            :disabled="exporting || !rows.length"
            @click="exportCsv"
          >
            {{ exporting ? 'Preparing…' : 'Export CSV' }}
          </button>
          <span v-else-if="meta" class="find__noexport">Export disabled for this form</span>
        </div>

        <p v-if="rowsLoading" class="state">Loading…</p>
        <p v-else-if="!rows.length" class="state">
          {{ filtering ? 'Nothing matches those filters.' : 'No submissions yet.' }}
        </p>

        <template v-else>
          <div class="tablewrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th v-for="c in primary" :key="c.key">{{ c.label }}</th>
                  <th><span class="sr">Details</span></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(r, i) in rows" :key="i">
                  <tr :class="{ 'tbl__row--open': opened === i }">
                    <td v-for="c in primary" :key="c.key">{{ display(c, r[c.key]) }}</td>
                    <td class="tbl__more">
                      <button type="button" class="linkish" @click="opened = opened === i ? null : i">
                        {{ opened === i ? 'Close' : 'Open' }}
                      </button>
                    </td>
                  </tr>
                  <tr v-if="opened === i" class="tbl__detail">
                    <td :colspan="primary.length + 1">
                      <dl class="detail">
                        <template v-for="c in meta?.columns ?? []" :key="c.key">
                          <dt>{{ c.label }}</dt>
                          <dd>{{ display(c, r[c.key]) }}</dd>
                        </template>
                      </dl>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div class="pager">
            <span>{{ offset + 1 }}–{{ offset + rows.length }} of {{ total }}</span>
            <button type="button" class="linkish" :disabled="offset === 0" @click="page(-PAGE)">Newer</button>
            <button type="button" class="linkish" :disabled="offset + rows.length >= total" @click="page(PAGE)">Older</button>
          </div>
        </template>
      </section>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.widget { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1.25rem; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .35rem; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 1rem; }
.state { color: var(--color-text-secondary); font-size: .875rem; }
.state--err { color: #8a1f1f; margin-bottom: .75rem; }
.notice { font-size: .8125rem; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 8%, transparent); border-radius: var(--border-radius); padding: .5rem .65rem; margin: 0 0 1rem; }

.tabs { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1rem; }
.tab { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .4rem .7rem; font: inherit; font-size: .8125rem; cursor: pointer; color: var(--color-text); display: inline-flex; align-items: center; gap: .4rem; }
.tab--on { border-color: var(--color-primary-strong); color: var(--color-primary-strong); font-weight: 600; }
.tab__count { font-size: .7rem; color: var(--color-text-secondary); background: var(--color-bg); border-radius: 999px; padding: .05rem .4rem; }

.find { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
.find__q { flex: 1 1 14rem; min-width: 0; }
.find input, .find select { padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.find__noexport { font-size: .75rem; color: var(--color-text-secondary); }

.tablewrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: .8125rem; }
.tbl th { text-align: left; font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); padding: .4rem .5rem; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
.tbl td { padding: .5rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
.tbl td.cell--multi { white-space: pre-line; }
.tbl__row--open td { background: var(--color-bg); }
.tbl__more { text-align: right; white-space: nowrap; }
.tbl__detail td { background: var(--color-bg); }
.detail { display: grid; grid-template-columns: minmax(8rem, 12rem) 1fr; gap: .3rem .9rem; margin: 0; }
.detail dt { font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); }
.detail dd { margin: 0; word-break: break-word; white-space: pre-line; }
@media (max-width: 640px) { .detail { grid-template-columns: 1fr; } .detail dd { margin-bottom: .4rem; } }

.pager { display: flex; align-items: center; gap: 1rem; margin-top: .9rem; font-size: .75rem; color: var(--color-text-secondary); }
.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .35rem .8rem; font-size: .8125rem; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }
.linkish:disabled { opacity: .5; cursor: not-allowed; text-decoration: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
