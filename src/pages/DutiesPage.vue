<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

interface Duty {
  id: string; task: string; category: string; cadence: string; cadenceRank: number;
  priority: string; status: string; owner: string | null; ownerNames: string[];
  titleRole: string | null; accessGroup: string | null; notes: string | null;
  source: string | null; statusUpdatedBy: string | null; statusUpdatedAt: number | null;
}

const loading = ref(true);
const error = ref('');
const duties = ref<Duty[]>([]);
const statuses = ref<string[]>([]);
const hiddenCount = ref(0);
const isAdmin = ref(false);
const canEdit = ref(false);
const saving = ref('');
const opened = ref<string | null>(null);
const search = ref('');
const onlyMine = ref('');

const owners = computed(() =>
  [...new Set(duties.value.map((d) => d.ownerNames[0] ?? d.owner ?? 'Unassigned'))].sort()
);

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return duties.value.filter((d) => {
    if (onlyMine.value && (d.ownerNames[0] ?? d.owner ?? 'Unassigned') !== onlyMine.value) return false;
    if (!q) return true;
    return [d.task, d.category, d.cadence, d.notes, d.owner].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
});

/** Grouped by owner, then cadence — the order the endpoint already sorted in. */
const groups = computed(() => {
  const map = new Map<string, Duty[]>();
  for (const d of visible.value) {
    const key = d.ownerNames.join(' & ') || d.owner || 'Unassigned';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return [...map.entries()];
});

const done = computed(() => duties.value.filter((d) => d.status === 'Done').length);

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/marketing-duties');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    duties.value = d.duties; statuses.value = d.statuses;
    hiddenCount.value = d.hiddenCount; isAdmin.value = d.isAdmin; canEdit.value = d.canEdit;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the duties.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function setStatus(d: Duty, status: string) {
  const previous = d.status;
  saving.value = d.id;
  d.status = status;
  try {
    const res = await apiFetch('/.netlify/functions/marketing-duties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id, status }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.error || String(res.status));
    d.statusUpdatedBy = r.statusUpdatedBy;
    d.statusUpdatedAt = r.statusUpdatedAt;
  } catch (e) {
    d.status = previous;   // put it back rather than showing a change that did not save
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    saving.value = '';
  }
}

const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
</script>

<template>
  <DashboardLayout page-title="Recurring duties">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <template v-else>
      <p class="lede">
        The standing marketing and social-media work, grouped by who owns it. Everything here is
        reference — the wording, cadence and owner come from the marketing plan. <strong>Status is
        the one thing you can change</strong>, and it records who changed it.
      </p>
      <p v-if="!canEdit" class="notice notice--quiet">
        This list is read-only for your account while ownership is still being decided. If a status
        looks wrong, say so rather than working around it.
      </p>
      <p v-if="hiddenCount" class="notice">
        {{ hiddenCount }} {{ hiddenCount === 1 ? 'duty is' : 'duties are' }} not shown to your account.
      </p>

      <div class="widget bar">
        <p class="bar__count"><strong>{{ visible.length }}</strong> of {{ duties.length }} shown · {{ done }} done</p>
        <div class="bar__filters">
          <input v-model="search" type="search" class="find__q" placeholder="Search duties…" aria-label="Search duties" />
          <select v-model="onlyMine" aria-label="Filter by owner">
            <option value="">All owners</option>
            <option v-for="o in owners" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>
      </div>

      <section v-for="[owner, list] in groups" :key="owner" class="widget block">
        <h2 class="block__title">{{ owner }} <span class="count">{{ list.length }}</span></h2>
        <p v-if="list[0]?.titleRole && list[0].titleRole !== '— unassigned —'" class="block__hint">
          {{ list[0].titleRole }}
        </p>

        <ul class="duties">
          <li v-for="d in list" :key="d.id" class="duty">
            <div class="duty__main">
              <button type="button" class="duty__task" @click="opened = opened === d.id ? null : d.id">
                <span class="duty__id">{{ d.id }}</span>{{ d.task }}
              </button>
              <p v-if="d.notes" class="duty__notes">{{ d.notes }}</p>
              <p class="duty__meta">
                {{ d.cadence }} · {{ d.category }}
                <span class="pri" :class="`pri--${d.priority.toLowerCase()}`">{{ d.priority }}</span>
                <span v-if="!d.accessGroup" class="pri pri--none">unassigned</span>
              </p>
            </div>

            <div class="duty__status">
              <select
                v-if="canEdit"
                :value="d.status"
                :disabled="saving === d.id"
                :aria-label="`Status of ${d.task}`"
                :class="`sel sel--${slug(d.status)}`"
                @change="setStatus(d, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
              </select>
              <span v-else class="sel sel--read" :class="`sel--${slug(d.status)}`">{{ d.status }}</span>
              <p v-if="d.statusUpdatedAt" class="dim">
                {{ d.statusUpdatedBy }} · {{ when(d.statusUpdatedAt) }}
              </p>
            </div>

            <dl v-if="opened === d.id" class="detail">
              <template v-if="d.notes"><dt>Notes</dt><dd>{{ d.notes }}</dd></template>
              <dt>Cadence</dt><dd>{{ d.cadence }}</dd>
              <dt>Category</dt><dd>{{ d.category }}</dd>
              <dt>Owner</dt><dd>{{ d.owner || '—' }}</dd>
              <template v-if="d.titleRole"><dt>Role</dt><dd>{{ d.titleRole }}</dd></template>
              <dt>Who can see this</dt>
              <dd>{{ d.accessGroup || 'Nobody assigned — dashboard admins only' }}</dd>
              <template v-if="d.source"><dt>From</dt><dd>{{ d.source }}</dd></template>
              <dt>Reference</dt><dd>{{ d.id }}</dd>
            </dl>
          </li>
        </ul>
      </section>

      <p v-if="!groups.length" class="state">Nothing matches.</p>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.lede { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 .75rem; max-width: 68ch; }
.state { color: var(--color-text-secondary); font-size: .875rem; }
.state--err { color: #8a1f1f; margin-bottom: .75rem; }
.notice { font-size: .8125rem; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 8%, transparent); border-radius: var(--border-radius); padding: .5rem .65rem; margin: 0 0 1rem; }

.bar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
.bar__count { font-size: .8125rem; margin: 0; color: var(--color-text-secondary); }
.bar__filters { display: flex; flex-wrap: wrap; gap: .5rem; }
.find__q, .bar__filters select { padding: .4rem .5rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }

.block { margin-bottom: 1rem; }
.block__title { display: flex; align-items: center; gap: .5rem; margin-bottom: .1rem; }
.block__hint { font-size: .75rem; color: var(--color-text-secondary); margin: 0 0 .7rem; }
.count { font-size: .7rem; font-weight: 400; color: var(--color-text-secondary); background: var(--color-bg); border-radius: 999px; padding: .05rem .45rem; }

.duties { list-style: none; margin: 0; padding: 0; }
.duty { display: grid; grid-template-columns: 1fr auto; gap: .5rem 1rem; padding: .6rem 0; border-top: 1px solid var(--color-border); align-items: start; }
.duty:first-child { border-top: 0; }
.duty__task { background: none; border: 0; padding: 0; font: inherit; font-size: .875rem; text-align: left; color: var(--color-text); cursor: pointer; }
.duty__task:hover { color: var(--color-primary-strong); }
.duty__id { display: inline-block; min-width: 2.6rem; font-size: .7rem; color: var(--color-text-secondary); }
.duty__notes { font-size: .75rem; color: var(--color-text-secondary); margin: .2rem 0 0 2.6rem; max-width: 62ch; }
.notice--quiet { color: var(--color-text-secondary); background: var(--color-bg); }
.sel--read { display: inline-block; border: 1px solid transparent; background: transparent; }
.duty__meta { font-size: .75rem; color: var(--color-text-secondary); margin: .15rem 0 0 2.6rem; }
.duty__status { text-align: right; }
.duty__status .dim { font-size: .7rem; color: var(--color-text-secondary); margin: .2rem 0 0; }

.sel { padding: .3rem .45rem; font: inherit; font-size: .75rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.sel--done { border-color: #1f6b3a; color: #1f6b3a; }
.sel--in-progress { border-color: var(--color-primary-strong); color: var(--color-primary-strong); }
.sel--needs-decision, .sel--needs-improvement { border-color: #8a5a1f; color: #8a5a1f; }
.sel--not-started { color: var(--color-text-secondary); }

.pri { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; border-radius: 999px; padding: .05rem .4rem; margin-left: .35rem; }
.pri--high { color: #8a1f1f; background: color-mix(in srgb, #8a1f1f 10%, transparent); }
.pri--medium { color: #6b5a1f; background: color-mix(in srgb, #6b5a1f 10%, transparent); }
.pri--low { color: var(--color-text-secondary); background: var(--color-bg); }
.pri--none { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 10%, transparent); }

.detail { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(7rem, 10rem) 1fr; gap: .25rem .9rem; margin: .5rem 0 .2rem; padding: .6rem .7rem; background: var(--color-bg); border-radius: var(--border-radius); font-size: .8125rem; }
.detail dt { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: var(--color-text-secondary); }
.detail dd { margin: 0; }
</style>
