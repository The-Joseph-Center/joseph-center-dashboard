<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

interface Person { name: string; email: string }
interface Group { name: string; description: string | null; members: Person[]; inactive: number }
interface Cap { id: string; label: string; everyone: boolean; groups: string[] }
interface Form { id: string; label: string; sensitive: boolean; groups: string[] }

const loading = ref(true);
const error = ref('');
const capabilities = ref<Cap[]>([]);
const forms = ref<Form[]>([]);
const groups = ref<Group[]>([]);
const missing = ref<string[]>([]);
const empty = ref<string[]>([]);
const view = ref<'health' | 'byGroup' | 'byCapability' | 'byForm'>('health');

interface Check { name: string; state: 'ok' | 'fail' | 'unconfigured'; detail: string; ms: number }
interface Hook { url: string; status: string; events: string[]; onExpectedDomain: boolean; expectedHost: string }
const checks = ref<Check[]>([]);
const webhooks = ref<Hook[] | null>(null);
const healthLoading = ref(false);
const healthError = ref('');
const checkedAt = ref<number | null>(null);

const failing = computed(() => checks.value.filter((c) => c.state === 'fail'));

async function loadHealth() {
  healthLoading.value = true; healthError.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-health');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    checks.value = d.checks; webhooks.value = d.webhooks; checkedAt.value = d.checkedAt;
  } catch (e) {
    healthError.value = e instanceof Error ? e.message : 'Could not run the checks.';
  } finally {
    healthLoading.value = false;
  }
}

const when = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });

const byName = computed(() => Object.fromEntries(groups.value.map((g) => [g.name.toLowerCase(), g])));
const membersOf = (name: string) => byName.value[name.toLowerCase()]?.members ?? [];
const countOf = (name: string) => byName.value[name.toLowerCase()]?.members.length ?? 0;

/** Everything one group unlocks, so a group can be read as a job description. */
const grantsOf = (name: string) => ({
  capabilities: capabilities.value.filter((c) => c.groups.some((g) => g.toLowerCase() === name.toLowerCase())),
  forms: forms.value.filter((f) => f.groups.some((g) => g.toLowerCase() === name.toLowerCase())),
});

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-access');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    capabilities.value = d.capabilities; forms.value = d.forms;
    groups.value = d.groups; missing.value = d.missing; empty.value = d.empty;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the access map.';
  } finally {
    loading.value = false;
  }
}
onMounted(() => { load(); loadHealth(); });
</script>

<template>
  <DashboardLayout page-title="Access">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <template v-else>
      <p class="lede">
        Permissions are written in <code>capabilities.ts</code>; membership lives in Okta. This page
        joins the two and changes neither — to move someone, change their groups in Okta.
      </p>

      <div v-if="missing.length" class="notice notice--warn" role="alert">
        <strong>{{ missing.length }} group named in the rules does not exist in Okta:</strong>
        {{ missing.join(', ') }}. A rule naming a group that is not there grants nothing.
      </div>
      <div v-if="empty.length" class="notice">
        <strong>Groups with nobody in them:</strong> {{ empty.join(', ') }}. These grant nothing
        today, and will the moment somebody is added.
      </div>

      <nav class="tabs">
        <button type="button" class="tab" :class="{ 'tab--on': view === 'health' }" @click="view = 'health'">
          Integrations
          <span v-if="failing.length" class="badge">{{ failing.length }}</span>
        </button>
        <button type="button" class="tab" :class="{ 'tab--on': view === 'byGroup' }" @click="view = 'byGroup'">By group</button>
        <button type="button" class="tab" :class="{ 'tab--on': view === 'byCapability' }" @click="view = 'byCapability'">By tool</button>
        <button type="button" class="tab" :class="{ 'tab--on': view === 'byForm' }" @click="view = 'byForm'">By inbox</button>
      </nav>

      <!-- Integrations: every check is a real call, not a variable lookup -->
      <section v-if="view === 'health'" class="stack">
        <div class="widget">
          <h2 class="block__title">
            Integrations
            <button type="button" class="linkish" :disabled="healthLoading" @click="loadHealth">
              {{ healthLoading ? 'Checking…' : 'Re-check' }}
            </button>
          </h2>
          <p class="block__hint">
            Each row is a live call to the service, not a check that a setting exists. Netlify
            snapshots environment values into functions at deploy time, so a correct-looking
            setting and a working one are different questions.
            <span v-if="checkedAt"> Last checked {{ when(checkedAt) }}.</span>
          </p>
          <p v-if="healthError" class="state state--err" role="alert">{{ healthError }}</p>
          <p v-else-if="healthLoading && !checks.length" class="state">Running checks…</p>
          <table v-else class="tbl">
            <tbody>
              <tr v-for="c in checks" :key="c.name">
                <td class="hc"><span class="dot" :class="`dot--${c.state}`" aria-hidden="true"></span></td>
                <td><strong>{{ c.name }}</strong></td>
                <td class="dim">{{ c.detail }}</td>
                <td class="num dim">{{ c.ms }}ms</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="widget">
          <h2 class="block__title">Stripe webhook</h2>
          <p class="block__hint">
            Where Stripe delivers donation events. If this is wrong, gifts are taken but nothing
            downstream happens — no database row, no receipt, no staff notification.
          </p>
          <p v-if="!webhooks" class="state">Could not read the webhook configuration.</p>
          <template v-else>
            <div v-for="h in webhooks" :key="h.url" class="hook">
              <p class="hook__url"><code>{{ h.url }}</code></p>
              <p v-if="!h.onExpectedDomain" class="notice">
                Not on <code>{{ h.expectedHost }}</code>. This still works, but it is not the
                address anyone would think to check, and it will keep working unchanged if the
                custom domain ever moves.
              </p>
              <p class="lbl">Events</p>
              <ul class="grants"><li v-for="e in h.events" :key="e"><code>{{ e }}</code></li></ul>
              <p class="dim">Status: {{ h.status }}</p>
            </div>
          </template>
        </div>
      </section>

      <!-- By group: what does this department get, and who is in it -->
      <section v-else-if="view === 'byGroup'" class="stack">
        <div v-for="g in groups" :key="g.name" class="widget">
          <h2 class="block__title">
            {{ g.name }}
            <span class="count">{{ g.members.length }}</span>
            <span v-if="g.inactive" class="count count--muted">{{ g.inactive }} deactivated</span>
          </h2>
          <p v-if="g.description" class="block__hint">{{ g.description }}</p>

          <p class="lbl">People</p>
          <p v-if="!g.members.length" class="state">Nobody.</p>
          <ul v-else class="people">
            <li v-for="p in g.members" :key="p.email">{{ p.name }} <span class="dim">{{ p.email }}</span></li>
          </ul>

          <p class="lbl">Can use</p>
          <ul class="grants">
            <li v-for="c in grantsOf(g.name).capabilities" :key="c.id">{{ c.label }}</li>
            <li v-for="f in grantsOf(g.name).forms" :key="f.id">
              Read <strong>{{ f.label }}</strong>
              <span v-if="f.sensitive" class="flag">sensitive</span>
            </li>
            <li v-if="!grantsOf(g.name).capabilities.length && !grantsOf(g.name).forms.length" class="dim">Nothing.</li>
          </ul>
        </div>
      </section>

      <!-- By tool: who can reach each part of the dashboard -->
      <section v-else-if="view === 'byCapability'" class="widget">
        <div class="tablewrap">
          <table class="tbl">
            <thead><tr><th>Tool</th><th>Groups</th><th class="num">People</th></tr></thead>
            <tbody>
              <tr v-for="c in capabilities" :key="c.id">
                <td><strong>{{ c.id }}</strong><br /><span class="dim">{{ c.label }}</span></td>
                <td>
                  <span v-if="c.everyone" class="dim">Everyone signed in</span>
                  <template v-else>
                    <span v-for="g in c.groups" :key="g" class="pill">
                      {{ g }} <span class="dim">{{ countOf(g) }}</span>
                    </span>
                  </template>
                </td>
                <td class="num">
                  {{ c.everyone ? '—' : new Set(c.groups.flatMap((g) => membersOf(g).map((p) => p.email))).size }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- By inbox: the per-form rules, which are the sensitive ones -->
      <section v-else class="widget">
        <div class="tablewrap">
          <table class="tbl">
            <thead><tr><th>Inbox</th><th>Groups</th><th class="num">People</th></tr></thead>
            <tbody>
              <tr v-for="f in forms" :key="f.id">
                <td>
                  <strong>{{ f.label }}</strong>
                  <span v-if="f.sensitive" class="flag">sensitive</span>
                </td>
                <td>
                  <span v-for="g in f.groups" :key="g" class="pill">
                    {{ g }} <span class="dim">{{ countOf(g) }}</span>
                  </span>
                </td>
                <td class="num">{{ new Set(f.groups.flatMap((g) => membersOf(g).map((p) => p.email))).size }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.lede { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 1rem; max-width: 60ch; }
.lede code { font-size: .78rem; }
.state { color: var(--color-text-secondary); font-size: .875rem; }
.state--err { color: #8a1f1f; }
.notice { font-size: .8125rem; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 8%, transparent); border-radius: var(--border-radius); padding: .5rem .65rem; margin: 0 0 1rem; }
.notice--warn { color: #8a1f1f; background: color-mix(in srgb, #8a1f1f 8%, transparent); }
.tabs { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1rem; }
.tab { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .4rem .7rem; font: inherit; font-size: .8125rem; cursor: pointer; color: var(--color-text); }
.tab--on { border-color: var(--color-primary-strong); color: var(--color-primary-strong); font-weight: 600; }
.stack { display: grid; gap: 1rem; }
.block__title { display: flex; align-items: center; gap: .5rem; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: .1rem 0 .6rem; }
.count { font-size: .7rem; font-weight: 400; color: var(--color-text-secondary); background: var(--color-bg); border-radius: 999px; padding: .05rem .45rem; }
.count--muted { opacity: .7; }
.lbl { font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin: .8rem 0 .3rem; }
.people, .grants { margin: 0; padding-left: 1.1rem; font-size: .8125rem; display: grid; gap: .15rem; }
.dim { color: var(--color-text-secondary); font-size: .75rem; }
.pill { display: inline-block; font-size: .75rem; border: 1px solid var(--color-border); border-radius: 999px; padding: .05rem .5rem; margin: 0 .3rem .3rem 0; }
.flag { font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; color: #8a1f1f; background: color-mix(in srgb, #8a1f1f 10%, transparent); border-radius: 999px; padding: .05rem .4rem; margin-left: .4rem; }
.badge { font-size: .7rem; background: #8a1f1f; color: #fff; border-radius: 999px; padding: .05rem .4rem; margin-left: .35rem; }
.dot { display: inline-block; width: .6rem; height: .6rem; border-radius: 50%; }
.dot--ok { background: #1f6b3a; }
.dot--fail { background: #8a1f1f; }
.dot--unconfigured { background: var(--color-border); }
.hc { width: 1.4rem; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-primary-strong); cursor: pointer; margin-left: auto; }
.hook__url { font-size: .8125rem; margin: 0 0 .5rem; word-break: break-all; }
.tablewrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: .8125rem; }
.tbl th { text-align: left; font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); padding: .4rem .5rem; border-bottom: 1px solid var(--color-border); }
.tbl td { padding: .5rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
.num { text-align: right; }
</style>
