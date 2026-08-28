<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

// The monthly newsletter, built in one place.
//
// Sections 4 and the closing are templates, not something written fresh each
// month — the process document says the pattern is established and not to
// deviate, and a block regenerated monthly drifts. Only the guest story and the
// program spotlight are written each time. Everything else is data entry.
//
// AWeber is deliberately untouched. Applying the monthly tag is what sends the
// newsletter to every active subscriber; this page tells you exactly what to
// set and leaves the sending to a person.

interface Issue { severity: 'must' | 'should'; where: string; problem: string; fix: string }
interface Version {
  id: string; label: string; tag: string; excludes: string[];
  subject: string; signature: string; section4: string; closing: string;
}
interface Draft {
  month: string; monthName: string; guestName: string; guestFrame: string; program: string;
  aweberTag: string; section1: string; section2: string;
  stats: Record<string, string>; videos: { title: string; url: string }[];
  partners: { name: string; url: string }[]; previewText: string; status: string;
  updatedBy: string | null; updatedAt: number;
}

const months = ref<{ month: string; monthName: string; status: string; guest: string | null }[]>([]);
const month = ref('');
const draft = ref<Draft | null>(null);
const issues = ref<Issue[]>([]);
const versions = ref<Version[]>([]);
const plan = ref<{ tag: string; waitDays: number; endOfMonth: string } | null>(null);
const partnerHistory = ref<{ name: string; url: string; months: string[]; lastUsed: string }[]>([]);
const history = ref<{ month: string; monthName: string; guest: string | null; program: string | null }[]>([]);
const carriedPartners = ref(false);
const pullingVideos = ref(false);

// ── Section 1 from a transcript ──
const transcriptOpen = ref(false);
const transcript = ref('');
const drafting = ref(false);
const draftQuotes = ref<string[]>([]);
const draftGaps = ref<string[]>([]);
const appendedBridge = ref(false);

async function draftSection1() {
  if (!draft.value) return;
  drafting.value = true; error.value = ''; draftQuotes.value = []; draftGaps.value = [];
  try {
    const res = await apiFetch('/.netlify/functions/newsletter-draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcript.value, guestName: draft.value.guestName,
        monthName: draft.value.monthName, frame: draft.value.guestFrame, program: draft.value.program,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    if (draft.value.section1.trim() && !window.confirm('Replace what is already in Section 1?')) return;
    draft.value.section1 = d.draft;
    draftQuotes.value = d.quotes ?? [];
    draftGaps.value = d.gaps ?? [];
    appendedBridge.value = !!d.appendedBridgeLine;
    transcriptOpen.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not draft from the transcript.';
  } finally {
    drafting.value = false;
  }
}

// ── Stats from the shared sheet ──
// Shows where each number came from rather than just filling the boxes: a
// silently wrong figure in a sent newsletter is not correctable.
interface SheetMatch { label: string; row: number; value: string; sourceLabel: string }
const sheetOpen = ref(false);
const sheetTabs = ref<string[]>([]);
const sheetTab = ref('');
const sheetRows = ref<{ index: number; label: string; value: string }[]>([]);
const sheetMatches = ref<SheetMatch[]>([]);
const sheetHeader = ref('');
const sheetError = ref('');
const readingSheet = ref(false);

async function openSheet() {
  sheetOpen.value = !sheetOpen.value;
  if (!sheetOpen.value || sheetTabs.value.length) return;
  await readSheet();
}

async function readSheet() {
  if (!draft.value) return;
  readingSheet.value = true; sheetError.value = '';
  try {
    const labels = Object.keys(draft.value.stats).join('|');
    const params = new URLSearchParams({ month: month.value, labels });
    if (sheetTab.value) params.set('tab', sheetTab.value);
    const res = await apiFetch(`/.netlify/functions/sheets-stats?${params}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { sheetError.value = d.error || String(res.status); sheetTabs.value = d.tabs ?? []; return; }
    sheetTabs.value = d.tabs ?? [];
    if (!sheetTab.value && sheetTabs.value.length) { sheetTab.value = d.tab || sheetTabs.value[0]!; if (!d.matches) return readSheet(); }
    sheetMatches.value = d.matches ?? [];
    sheetRows.value = d.rows ?? [];
    sheetHeader.value = d.monthHeader ?? '';
    sheetError.value = d.error ?? '';
  } catch (e) {
    sheetError.value = e instanceof Error ? e.message : 'Could not read the sheet.';
  } finally {
    readingSheet.value = false;
  }
}

function pickRow(m: SheetMatch, index: number) {
  const row = sheetRows.value.find((r) => r.index === index);
  if (!row) return;
  m.row = index; m.value = row.value; m.sourceLabel = row.label;
}

function applySheet() {
  if (!draft.value) return;
  for (const m of sheetMatches.value) {
    if (m.value) draft.value.stats[m.label] = m.value;
  }
  sheetOpen.value = false;
}

// ── Email HTML ──
const htmlVersions = ref<Record<string, string>>({});
const buildingHtml = ref(false);
const showHtml = ref(false);

async function buildHtml() {
  if (!draft.value) return;
  buildingHtml.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-newsletter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft.value, month: month.value, action: 'html' }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    htmlVersions.value = Object.fromEntries(d.versions.map((v: { id: string; html: string }) => [v.id, v.html]));
    showHtml.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not build the HTML.';
  } finally {
    buildingHtml.value = false;
  }
}
const section3Header = ref('');
const bridge = ref('');
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const saved = ref(false);
const openVersion = ref<string>('community-friend');

const musts = computed(() => issues.value.filter((i) => i.severity === 'must'));
const shoulds = computed(() => issues.value.filter((i) => i.severity === 'should'));

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function loadIndex() {
  const res = await apiFetch('/.netlify/functions/admin-newsletter');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
  months.value = (await res.json()).months;
}

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/admin-newsletter?month=${month.value}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    draft.value = d.draft; issues.value = d.issues; versions.value = d.versions;
    plan.value = d.plan; section3Header.value = d.section3Header; bridge.value = d.bridgeLine;
    partnerHistory.value = d.partners ?? []; history.value = d.history ?? [];
    carriedPartners.value = !!d.carriedPartners;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the newsletter.';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try { await loadIndex(); } catch { /* the month view still works */ }
  month.value = months.value[0]?.status === 'draft' ? months.value[0].month : thisMonth();
  await load();
});
watch(month, (v, old) => { if (old && v !== old) load(); });

async function save() {
  if (!draft.value) return;
  saving.value = true; error.value = ''; saved.value = false;
  try {
    const res = await apiFetch('/.netlify/functions/admin-newsletter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draft.value, month: month.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    saved.value = true;
    await loadIndex();
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    saving.value = false;
  }
}

/** Last month's videos, from the channel — titles have to match exactly. */
async function pullVideos() {
  if (!draft.value) return;
  const [y, m] = month.value.split('-').map(Number);
  const prev = `${m === 1 ? y! - 1 : y}-${String(m === 1 ? 12 : m! - 1).padStart(2, '0')}`;
  pullingVideos.value = true; error.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/youtube-videos?month=${prev}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    if (!d.videos.length) { error.value = `No videos found for ${prev}.`; return; }
    draft.value.videos = d.videos.map((v: { title: string; url: string }) => ({ title: v.title, url: v.url }));
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not reach YouTube.';
  } finally {
    pullingVideos.value = false;
  }
}

const usePartner = (p: { name: string; url: string }) => {
  if (!draft.value || draft.value.partners.some((x) => x.name === p.name)) return;
  draft.value.partners.push({ name: p.name, url: p.url });
};

const addVideo = () => draft.value?.videos.push({ title: '', url: '' });
const removeVideo = (i: number) => draft.value?.videos.splice(i, 1);
const addPartner = () => draft.value?.partners.push({ name: '', url: '' });
const removePartner = (i: number) => draft.value?.partners.splice(i, 1);

const copied = ref('');
async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = what;
    window.setTimeout(() => { if (copied.value === what) copied.value = ''; }, 1600);
  } catch {
    error.value = 'Copying is blocked in this browser — select the text instead.';
  }
}

/** The whole version, in the order it appears in the email. */
const fullVersion = (v: Version) =>
  [draft.value?.section1, draft.value?.section2, `## ${section3Header.value}`, statsBlock(), videoBlock(), v.section4, v.closing, `— ${v.signature}`]
    .filter(Boolean).join('\n\n');

function statsBlock() {
  const s = draft.value?.stats ?? {};
  const lines = Object.entries(s).filter(([, v]) => String(v).trim()).map(([k, v]) => `- ${k}: ${v}`);
  return lines.length ? `**This Month in Numbers**\n\n${lines.join('\n')}` : '';
}
function videoBlock() {
  const v = draft.value?.videos ?? [];
  const lines = v.filter((x) => x.title && x.url).map((x) => `[Watch: "${x.title}"](${x.url})`);
  return lines.length ? `${lines.join('\n\n')}\n\nWant to be a guest? [Apply here](https://forms.gle/aQZRYokrT7YK8GFL9)` : '';
}
</script>

<template>
  <DashboardLayout page-title="Newsletter">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="!draft" class="state state--err">{{ error || 'Could not load.' }}</p>

    <template v-else>
      <div class="widget bar">
        <label class="bar__f"><span>Month</span><input v-model="month" type="month" /></label>
        <span class="bar__status" :class="`bar__status--${draft.status}`">{{ draft.status === 'sent' ? 'Sent' : 'Draft' }}</span>
        <span v-if="draft.updatedBy" class="bar__meta">last edited by {{ draft.updatedBy }}</span>
        <span class="bar__spacer"></span>
        <button type="button" class="btn btn--sm" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
        <span v-if="saved" class="ok">Saved</span>
      </div>
      <p v-if="error" class="state state--err" role="alert">{{ error }}</p>

      <!-- This month -->
      <section class="widget block">
        <h2 class="block__title">This month</h2>
        <div class="grid2">
          <label class="f"><span>Guest or partner (first name)</span><input v-model="draft.guestName" type="text" /></label>
          <label class="f">
            <span>Story frame</span>
            <select v-model="draft.guestFrame">
              <option value="guest">Guest — before, support, transformation</option>
              <option value="calling">Board or community partner — why I believe</option>
            </select>
          </label>
        </div>
        <label class="f"><span>Section 2 program or theme</span><input v-model="draft.program" type="text" placeholder="Day Shelter, Food Pantry, IFS, The Golden Girls Project, Family Center…" /></label>
        <label class="f"><span>Preview text — one evocative sentence</span><input v-model="draft.previewText" type="text" maxlength="200" /></label>

        <details v-if="history.length" class="rotation">
          <summary>What has already run ({{ history.length }})</summary>
          <ul>
            <li v-for="h in history" :key="h.month">
              <strong>{{ h.monthName }}</strong> — {{ h.guest || 'no guest' }} · {{ h.program || 'no program' }}
            </li>
          </ul>
        </details>
      </section>

      <!-- Sections 1 and 2 -->
      <section class="widget block">
        <h2 class="block__title">Section 1 — {{ draft.guestFrame === 'calling' ? 'Partner story' : 'Guest story' }}</h2>
        <p class="block__hint">
          3–4 paragraphs, most resonant angle first. Must end on the bridge line:
          <button type="button" class="linkish" @click="copy(bridge, 'bridge')">{{ copied === 'bridge' ? 'Copied' : 'copy it' }}</button>
        </p>
        <div class="tools">
          <button type="button" class="btn btn--ghost btn--sm" @click="transcriptOpen = !transcriptOpen">
            {{ transcriptOpen ? 'Close' : 'Draft from a Coffee Chat transcript' }}
          </button>
        </div>

        <div v-if="transcriptOpen" class="transcript">
          <p class="block__hint">
            Paste both sides of the conversation, plus the bonus content if there is any. The transcript is the
            only thing it works from — anything it cannot settle comes back as a question rather than a guess.
          </p>
          <textarea v-model="transcript" rows="8" class="body" placeholder="MONA: …&#10;GUEST: …"></textarea>
          <div class="actions">
            <button type="button" class="btn btn--sm" :disabled="drafting || transcript.trim().length < 400 || !draft.guestName" @click="draftSection1">
              {{ drafting ? 'Reading the transcript…' : `Draft the ${draft.guestFrame === 'calling' ? 'partner' : 'guest'} story` }}
            </button>
            <span v-if="!draft.guestName" class="hint">Set the guest name first.</span>
            <span v-else-if="transcript.trim().length < 400" class="hint">Paste the transcript first.</span>
          </div>
        </div>

        <textarea v-model="draft.section1" rows="10" class="body"></textarea>

        <p v-if="appendedBridge" class="hint hint--warn">The bridge line was missing from the draft and has been added at the end — check it reads naturally there.</p>
        <div v-if="draftQuotes.length" class="quotes">
          <p class="quotes__head">Quotations used — check each against the transcript:</p>
          <ul><li v-for="(q, i) in draftQuotes" :key="i">&ldquo;{{ q }}&rdquo;</li></ul>
        </div>
        <div v-if="draftGaps.length" class="gaps">
          <p class="gaps__head">The transcript did not settle these:</p>
          <ul><li v-for="(g, i) in draftGaps" :key="i">{{ g }}</li></ul>
        </div>
      </section>

      <section class="widget block">
        <h2 class="block__title">Section 2 — Program spotlight</h2>
        <p class="block__hint">Header, hook, description, "What we provide" bullets, the month's stat paragraph, the bridge closing line, then the referral CTA.</p>
        <textarea v-model="draft.section2" rows="10" class="body"></textarea>
      </section>

      <!-- Section 3 -->
      <section class="widget block">
        <h2 class="block__title">Section 3 — {{ section3Header }}</h2>
        <p class="block__hint">Stats come from the program directors. Never estimated, never left as placeholders.</p>
        <div class="tools">
          <button type="button" class="btn btn--ghost btn--sm" :disabled="readingSheet" @click="openSheet">
            {{ readingSheet ? 'Reading the sheet…' : sheetOpen ? 'Close' : 'Pull from the shared sheet' }}
          </button>
        </div>

        <div v-if="sheetOpen" class="sheet">
          <p v-if="sheetError" class="warn" role="alert">{{ sheetError }}</p>
          <div v-if="sheetTabs.length" class="sheet__head">
            <label class="f f--inline">
              <span>Tab</span>
              <select v-model="sheetTab" @change="readSheet">
                <option v-for="t in sheetTabs" :key="t" :value="t">{{ t }}</option>
              </select>
            </label>
            <span v-if="sheetHeader" class="hint">Reading the column headed <strong>{{ sheetHeader }}</strong>.</span>
          </div>

          <table v-if="sheetMatches.length" class="sheet__tbl">
            <thead><tr><th>Stat</th><th>Row it was taken from</th><th class="num">Value</th></tr></thead>
            <tbody>
              <tr v-for="m in sheetMatches" :key="m.label">
                <td>{{ m.label }}</td>
                <td>
                  <select :value="m.row" @change="pickRow(m, Number(($event.target as HTMLSelectElement).value))">
                    <option :value="-1">— not found, pick one —</option>
                    <option v-for="r in sheetRows" :key="r.index" :value="r.index">{{ r.label }}</option>
                  </select>
                </td>
                <td class="num"><strong>{{ m.value || '—' }}</strong></td>
              </tr>
            </tbody>
          </table>

          <div v-if="sheetMatches.length" class="actions">
            <button type="button" class="btn btn--sm" @click="applySheet">Use these numbers</button>
            <span class="hint">Check each one against the row it came from before you do.</span>
          </div>
        </div>
        <div class="grid2">
          <label v-for="(_, k) in draft.stats" :key="k" class="f"><span>{{ k }}</span><input v-model="draft.stats[k]" type="text" /></label>
        </div>

        <h3 class="sub">
          Last month's Coffee Chat videos
          <button type="button" class="btn btn--ghost btn--sm" :disabled="pullingVideos" @click="pullVideos">
            {{ pullingVideos ? 'Fetching…' : 'Pull from YouTube' }}
          </button>
        </h3>
        <p class="block__hint">Titles come from the channel so they match exactly — the document is clear they are never typed or estimated.</p>
        <div v-for="(v, i) in draft.videos" :key="i" class="rowline">
          <input v-model="v.title" type="text" placeholder="Exact title as published on YouTube" />
          <input v-model="v.url" type="text" placeholder="https://youtu.be/…" />
          <button type="button" class="linkish linkish--danger" @click="removeVideo(i)">Remove</button>
        </div>
        <button type="button" class="linkish" @click="addVideo">+ Add a video</button>
      </section>

      <!-- Closing -->
      <section class="widget block">
        <h2 class="block__title">This quarter's foundation partners</h2>
        <p class="block__hint">
          Confirm with Mona or Shawna before each quarter changes.
          <span v-if="carriedPartners"> Carried over from last month — check they are still current.</span>
        </p>
        <div v-if="partnerHistory.length" class="suggest-partners">
          <span class="suggest-partners__label">From the home-page marquee — never featured first, then least recent:</span>
          <button
            v-for="p in partnerHistory"
            :key="p.name"
            type="button"
            class="chip"
            :title="p.months.length ? `Featured in ${p.months.join(', ')}` : 'Never featured in a newsletter'"
            @click="usePartner(p)"
          >
            {{ p.name }} <span class="chip__when">{{ p.lastUsed || 'new' }}</span>
          </button>
        </div>
        <div v-for="(p, i) in draft.partners" :key="i" class="rowline">
          <input v-model="p.name" type="text" placeholder="Peer 180" />
          <input v-model="p.url" type="text" placeholder="https://peer-180.com" />
          <button type="button" class="linkish linkish--danger" @click="removePartner(i)">Remove</button>
        </div>
        <button type="button" class="linkish" @click="addPartner">+ Add a partner</button>
      </section>

      <!-- AWeber -->
      <section v-if="plan" class="widget block">
        <h2 class="block__title">AWeber setup</h2>
        <p class="block__hint">
          Set these by hand. Applying the tag is what sends the newsletter to every active subscriber,
          so that stays with a person rather than a button here.
        </p>
        <dl class="plan">
          <dt>Monthly tag</dt><dd><code>{{ draft.aweberTag || plan.tag }}</code> — must be new; never reuse a month's tag</dd>
          <dt>Wait step</dt><dd>{{ plan.waitDays }} days, so it lands on {{ plan.endOfMonth }}</dd>
          <dt>Entry rule</dt><dd>Subscribers can enter once — confirm on all three automations</dd>
        </dl>
      </section>

      <!-- Review -->
      <section class="widget block">
        <h2 class="block__title">
          Review
          <span v-if="!issues.length" class="pill pill--ok">nothing outstanding</span>
          <span v-else class="pill pill--warn">{{ musts.length }} to fix, {{ shoulds.length }} to check</span>
        </h2>
        <p class="block__hint">Every one of these is a mistake that has been caught in review before.</p>
        <ul v-if="issues.length" class="issues">
          <li v-for="(i, n) in issues" :key="n" class="issue" :class="`issue--${i.severity}`">
            <span class="sev" :class="`sev--${i.severity}`">{{ i.severity === 'must' ? 'Fix' : 'Check' }}</span>
            <div>
              <p class="issue__problem"><strong>{{ i.where }}</strong> — {{ i.problem }}</p>
              <p class="issue__fix">{{ i.fix }}</p>
            </div>
          </li>
        </ul>
      </section>

      <!-- The three versions -->
      <section class="widget block">
        <h2 class="block__title">The three versions</h2>
        <nav class="tabs">
          <button v-for="v in versions" :key="v.id" type="button" class="tab" :class="{ 'tab--on': openVersion === v.id }" @click="openVersion = v.id">{{ v.label }}</button>
        </nav>
        <template v-for="v in versions" :key="v.id">
          <div v-if="openVersion === v.id" class="version">
            <dl class="plan">
              <dt>Subject</dt><dd>{{ v.subject }}</dd>
              <dt>Preview text</dt><dd>{{ draft.previewText || '(not set)' }}</dd>
              <dt>Signature</dt><dd>{{ v.signature }}</dd>
              <dt>Excludes</dt><dd><code>{{ v.excludes.join(', ') }}</code></dd>
            </dl>
            <div class="version__actions">
              <button type="button" class="btn btn--sm" @click="copy(showHtml && htmlVersions[v.id] ? htmlVersions[v.id]! : fullVersion(v), v.id)">
                {{ copied === v.id ? 'Copied' : showHtml ? 'Copy the HTML' : 'Copy this version' }}
              </button>
              <button type="button" class="linkish" @click="copy(v.subject, v.id + '-subject')">
                {{ copied === v.id + '-subject' ? 'Copied' : 'Copy subject line' }}
              </button>
              <span class="version__spacer"></span>
              <button type="button" class="linkish" :disabled="buildingHtml" @click="showHtml && Object.keys(htmlVersions).length ? (showHtml = false) : buildHtml()">
                {{ buildingHtml ? 'Building…' : showHtml ? 'Show plain text' : 'Build email HTML' }}
              </button>
            </div>
            <p v-if="showHtml" class="block__hint">
              Paste this into AWeber's HTML mode. Inline styles and tables throughout, 600px wide — what email clients need rather than what a browser would.
            </p>
            <pre class="preview">{{ showHtml && htmlVersions[v.id] ? htmlVersions[v.id] : fullVersion(v) }}</pre>
          </div>
        </template>
      </section>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.widget { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1.25rem; }
.block { margin-bottom: 1.25rem; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .35rem; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 1rem; line-height: 1.55; }
.state { color: var(--color-text-secondary); }
.state--err { color: #8a1f1f; }
.sub { font-family: var(--font-heading); font-size: .8125rem; margin: 1.1rem 0 .5rem; }

.bar { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; margin-bottom: 1.25rem; padding: .85rem 1.25rem; }
.bar__f { display: flex; align-items: center; gap: .4rem; font-size: .75rem; color: var(--color-text-secondary); }
.bar__spacer { flex: 1; }
.bar__meta { font-size: .7rem; color: var(--color-text-secondary); }
.bar__status { font-size: .7rem; font-weight: 600; padding: .15rem .5rem; border-radius: 999px; }
.bar__status--draft { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }
.bar__status--sent { color: #14532d; background: color-mix(in srgb, #14532d 12%, transparent); }

.pill { font-size: .65rem; font-weight: 600; padding: .12rem .5rem; border-radius: 999px; }
.pill--ok { color: #14532d; background: color-mix(in srgb, #14532d 12%, transparent); }
.pill--warn { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }

.issues { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
.issue { display: flex; gap: .6rem; align-items: flex-start; padding: .55rem .7rem; background: var(--color-bg); border-radius: var(--border-radius); border-left: 3px solid var(--color-border); }
.issue--must { border-left-color: #8a1f1f; }
.issue--should { border-left-color: #8a5a1f; }
.sev { font-size: .6rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: .1rem .35rem; border-radius: 3px; flex-shrink: 0; margin-top: .1rem; }
.sev--must { color: #8a1f1f; background: color-mix(in srgb, #8a1f1f 12%, transparent); }
.sev--should { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }
.issue__problem { margin: 0; font-size: .8125rem; }
.issue__fix { margin: .15rem 0 0; font-size: .75rem; color: var(--color-text-secondary); line-height: 1.5; }

.f { display: block; margin-bottom: .7rem; }
.f > span { display: block; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: .25rem; }
.f input, .f select { width: 100%; }
input, select, textarea { padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.body { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; line-height: 1.65; resize: vertical; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
@media (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } }
.rowline { display: grid; grid-template-columns: 1fr 1fr auto; gap: .5rem; margin-bottom: .45rem; align-items: center; }
@media (max-width: 700px) { .rowline { grid-template-columns: 1fr; } }

.plan { display: grid; grid-template-columns: minmax(7rem, 9rem) 1fr; gap: .3rem .9rem; margin: 0 0 .9rem; font-size: .8125rem; }
.plan dt { font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); }
.plan dd { margin: 0; }
.plan code { background: var(--color-bg); padding: .05rem .3rem; border-radius: 3px; }

.tools { margin-bottom: .7rem; }
.sheet { border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .8rem; margin-bottom: .9rem; background: var(--color-bg); }
.sheet__head { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; margin-bottom: .7rem; }
.f--inline { display: flex; align-items: center; gap: .4rem; margin: 0; }
.f--inline > span { margin: 0; }
.sheet__tbl { width: 100%; border-collapse: collapse; font-size: .8125rem; }
.sheet__tbl th { text-align: left; font-family: var(--font-heading); font-size: .65rem; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); padding: .3rem .4rem; border-bottom: 1px solid var(--color-border); }
.sheet__tbl td { padding: .35rem .4rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.sheet__tbl select { width: 100%; max-width: 22rem; }
.warn { font-size: .8125rem; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 8%, transparent); border-radius: var(--border-radius); padding: .6rem .7rem; margin: 0 0 .7rem; line-height: 1.5; }
.transcript { border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .8rem; margin-bottom: .8rem; background: var(--color-bg); }
.transcript .body { margin-bottom: .6rem; }
.actions { display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
.hint { font-size: .75rem; color: var(--color-text-secondary); margin: .4rem 0 0; }
.hint--warn { color: #8a5a1f; }
.quotes, .gaps { margin-top: .7rem; padding: .6rem .8rem; border-radius: var(--border-radius); }
.quotes { background: var(--color-bg); }
.gaps { background: color-mix(in srgb, #8a5a1f 8%, transparent); }
.quotes__head, .gaps__head { margin: 0 0 .3rem; font-size: .8125rem; font-weight: 600; }
.gaps__head { color: #8a5a1f; }
.quotes ul, .gaps ul { margin: 0; padding-left: 1.1rem; }
.quotes li, .gaps li { font-size: .8125rem; margin-bottom: .25rem; line-height: 1.5; }
.version__spacer { flex: 1; }

.suggest-partners { display: flex; flex-wrap: wrap; gap: .35rem; align-items: center; margin-bottom: .8rem; }
.suggest-partners__label { font-size: .75rem; color: var(--color-text-secondary); }
.chip { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 999px; padding: .2rem .6rem; font: inherit; font-size: .75rem; cursor: pointer; color: var(--color-text); }
.chip:hover { border-color: var(--color-primary-strong); color: var(--color-primary-strong); }
.chip__when { color: var(--color-text-secondary); font-size: .7rem; }
.rotation { font-size: .75rem; color: var(--color-text-secondary); margin-top: .4rem; }
.rotation summary { cursor: pointer; }
.rotation ul { margin: .4rem 0 0; padding-left: 1.1rem; }
.rotation li { margin-bottom: .15rem; }
.btn--ghost { background: none; color: var(--color-text-secondary); border: 1px solid var(--color-border); }

.tabs { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: 1rem; }
.tab { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .35rem .7rem; font: inherit; font-size: .8125rem; cursor: pointer; color: var(--color-text); }
.tab--on { border-color: var(--color-primary-strong); color: var(--color-primary-strong); font-weight: 600; }
.version__actions { display: flex; gap: .9rem; align-items: center; margin-bottom: .8rem; }
.preview { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .9rem; font-size: .75rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 32rem; overflow-y: auto; margin: 0; }

.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .4rem .9rem; font-size: .8125rem; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.ok { font-size: .75rem; color: var(--color-primary-strong); }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }
.linkish--danger { color: #8a1f1f; }
</style>
