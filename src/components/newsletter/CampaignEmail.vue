<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { apiFetch } from '@/lib/api';
// The merge tag itself, not a copy of it: a greeting written out again here
// could drift from the one the renderer emits, and this line is the only place
// a writer is told what it looks like.
import { GREETING } from '../../../netlify/functions/_lib/newsletter';

/**
 * A one-off campaign email: Giving Tuesday, a year-end appeal, Angel Tree.
 *
 * Deliberately a separate tool from the monthly newsletter rather than a sixth
 * section of it. A newsletter has a guest, a program, stats and videos and runs
 * to a page and a half; a campaign email is eighty words and one button, and
 * every newsletter check would fire on all of it at once.
 *
 * What it is NOT separate in is how it looks. Both bodies come from
 * `campaignHtml`/`campaignText` in the same module the newsletter renders
 * from, using the same shell, greeting, button and signature. Nothing is
 * styled here and no copy is composed in the browser, so what this page shows
 * is what the function produces is what the subscriber receives — the same
 * single-render rule the Coffee Chat invite follows, and for the same reason.
 */

interface Issue {
  severity: 'must' | 'should'; where: string; problem: string; fix: string;
  id: string; overridable: boolean;
}
interface Dismissed extends Issue { reason: string; by?: string; at?: number }
interface Override { id: string; reason: string; label?: string; by?: string; at?: number }

interface VariantCopy { subject: string; previewText: string; body: string }
interface Campaign {
  slug: string; name: string; sendDate: string; link: string; buttonLabel: string;
  closingNote: string; variants: Record<string, VariantCopy>;
  status: string; sentAt: number | null; updatedBy: string | null; updatedAt: number;
}
interface Version {
  id: string; label: string; audience: string; signature: string;
  aweberTag: string; excludes: string[]; showButton: boolean;
  subject: string; previewText: string; html: string; text: string;
}
interface Listed {
  slug: string; name: string; sendDate: string; status: string;
  sentAt: number | null; updatedAt: number; updatedBy: string | null;
}

const PREVIEW_LIMIT = 140;

const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const dirty = ref(false);
const error = ref('');

const list = ref<Listed[]>([]);
const slug = ref('');
const campaign = ref<Campaign | null>(null);
const versions = ref<Version[]>([]);
const issues = ref<Issue[]>([]);
const dismissed = ref<Dismissed[]>([]);
const staleOverrides = ref<Override[]>([]);
const overrides = ref<Override[]>([]);
const exists = ref(false);

/** Which version's copy is being edited. */
const active = ref('community-friend');
/** Whether the output block shows the markup or the rendered email. */
const showHtml = ref(false);
const copied = ref('');

const dismissing = ref('');
const dismissReason = ref('');

/**
 * Building the drafts in AWeber.
 *
 * Deliberately stops one step short of what the newsletter tool can do. That
 * one can apply the monthly tag, which is the send; this builds drafts and
 * nothing else. A campaign email goes out as a broadcast to a segment at a
 * chosen minute, and both of those choices are the job — there is nothing a
 * button here could do with them except get them wrong on somebody's behalf.
 */
interface BuildState {
  ready: boolean;
  blocking?: Issue[];
  missingScopes?: string[];
  error?: string;
  apiDraftCount?: number;
  versions?: {
    id: string; label: string; subject: string;
    builtId: number | null; builtAt: number | null; missingInAweber: boolean;
  }[];
}
const buildOpen = ref(false);
const buildState = ref<BuildState | null>(null);
const checkingAweber = ref(false);
const building = ref(false);
const buildResult = ref<{
  drafts: { tier: string; id: string; subject: string; broadcastId?: number; skipped?: boolean; error?: string }[];
  recorded: boolean;
  previewTexts: Record<string, string>;
} | null>(null);

let autosave: ReturnType<typeof setTimeout> | undefined;

const musts = computed(() => issues.value.filter((i) => i.severity === 'must'));
const shoulds = computed(() => issues.value.filter((i) => i.severity === 'should'));
const dismissedMusts = computed(() => dismissed.value.filter((i) => i.severity === 'must').length);

const current = computed(() => campaign.value?.variants[active.value] ?? null);
const currentSpec = computed(() => versions.value.find((v) => v.id === active.value) ?? null);
const currentOut = computed(() => versions.value.find((v) => v.id === active.value) ?? null);

/** Words, as the brief counts them. */
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const WORD_RANGE: Record<string, [number, number]> = {
  'community-friend': [80, 120],
  donor: [60, 90],
  'recurring-donor': [60, 90],
};
const range = computed<[number, number]>(() => WORD_RANGE[active.value] ?? [60, 120]);
const words = computed(() => (current.value ? wordCount(current.value.body) : 0));

/** Unix seconds as a plain date. */
function when(seconds: number) {
  return new Date(seconds * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadIndex() {
  const res = await apiFetch('/.netlify/functions/admin-campaign-email');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
  const d = await res.json();
  list.value = d.campaigns ?? [];
}

/**
  * True while a server response is being applied.
  *
  * The autosave watcher below is deep and therefore asynchronous: it flushes
  * after this function AND after `load()`'s `finally`, so a `loading` check
  * inside it is always false by the time it runs. That made every page load
  * mark the campaign dirty and autosave four seconds later, writing the page's
  * own state back over the row — which silently undid three seeds of the
  * Giving Tuesday copy before anyone worked out where the writes were going.
  *
  * Cleared on the next tick, once that flush has happened.
  */
const hydrating = ref(false);

function take(d: Record<string, unknown>) {
  hydrating.value = true;
  campaign.value = d.campaign as Campaign;
  versions.value = (d.versions ?? []) as Version[];
  issues.value = (d.issues ?? []) as Issue[];
  dismissed.value = (d.dismissed ?? []) as Dismissed[];
  staleOverrides.value = (d.staleOverrides ?? []) as Override[];
  dismissing.value = ''; dismissReason.value = '';
  void nextTick(() => {
    hydrating.value = false;
    // The watcher has run by now and set this; what was just loaded is not
    // an unsaved edit.
    dirty.value = false;
  });
}

async function load() {
  if (!slug.value) { campaign.value = null; return; }
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/admin-campaign-email?slug=${encodeURIComponent(slug.value)}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    take(d);
    exists.value = !!d.exists;
    // The dismissals themselves, so a save carries them back unchanged.
    const wb = (d.workbench ?? {}) as { overrides?: Override[] };
    overrides.value = wb.overrides ?? [];
    dirty.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the campaign.';
    campaign.value = null;
  } finally {
    loading.value = false;
  }
}

/**
 * The campaign is saved and the review comes back with it.
 *
 * The function re-renders and re-reviews whatever it just wrote, so the panel
 * can never be showing a verdict on the version before the last keystroke —
 * which is the failure the newsletter's pre-send check had to work around.
 */
async function save() {
  if (!campaign.value) return;
  saving.value = true; error.value = ''; saved.value = false;
  const c = campaign.value;
  try {
    const res = await apiFetch('/.netlify/functions/admin-campaign-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: c.slug, name: c.name, sendDate: c.sendDate, link: c.link,
        buttonLabel: c.buttonLabel, closingNote: c.closingNote, variants: c.variants,
        workbench: { overrides: overrides.value },
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    take(d);
    exists.value = true;
    saved.value = true;
    dirty.value = false;
    await loadIndex().catch(() => { /* the picker can be stale */ });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    saving.value = false;
  }
}

/** A new campaign starts from its slug, which is also its `?campaign=` value. */
async function create() {
  const typed = window.prompt('Slug for the new campaign — lowercase, hyphens, and it is what the donation link\'s ?campaign= will carry:', '');
  const next = (typed ?? '').trim().toLowerCase();
  if (!next) return;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(next)) {
    error.value = 'Lowercase letters, numbers and hyphens only — "giving-tuesday-2026".';
    return;
  }
  slug.value = next;
  await load();
}

function startDismiss(i: Issue) { dismissing.value = i.id; dismissReason.value = ''; }

function confirmDismiss(i: Issue) {
  const reason = dismissReason.value.trim();
  if (reason.length < 5) return;
  overrides.value = [
    ...overrides.value.filter((o) => o.id !== i.id),
    { id: i.id, reason, label: `${i.where} — ${i.problem}` },
  ];
  // `by` and `at` are the server's to set from the signed-in session.
  dismissed.value = [...dismissed.value, { ...i, reason }];
  issues.value = issues.value.filter((x) => x.id !== i.id);
  dismissing.value = ''; dismissReason.value = '';
  dirty.value = true;
}

function restore(d: Dismissed) {
  overrides.value = overrides.value.filter((o) => o.id !== d.id);
  staleOverrides.value = staleOverrides.value.filter((o) => o.id !== d.id);
  dismissed.value = dismissed.value.filter((x) => x.id !== d.id);
  const { reason: _reason, by: _by, at: _at, ...issue } = d;
  issues.value = [...issues.value, issue];
  dirty.value = true;
}

function clearStale() {
  const gone = new Set(staleOverrides.value.map((o) => o.id));
  overrides.value = overrides.value.filter((o) => !gone.has(o.id));
  staleOverrides.value = [];
  dirty.value = true;
}

async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => { if (copied.value === key) copied.value = ''; }, 2000);
  } catch {
    error.value = 'The clipboard refused. Select the text and copy it by hand.';
  }
}

/** Reads only: scopes, the review, and which drafts already exist. */
async function checkAweber() {
  if (!campaign.value) return;
  checkingAweber.value = true; error.value = ''; buildResult.value = null;
  try {
    // The function reads the saved row, so an unsaved edit would be reported
    // on as though it were not there.
    if (dirty.value) await save();
    const res = await apiFetch(`/.netlify/functions/campaign-aweber?slug=${encodeURIComponent(campaign.value.slug)}`);
    const d = await res.json().catch(() => ({}));
    buildState.value = res.ok ? d : { ready: false, error: d.error || `The request failed (${res.status}).` };
    buildOpen.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not reach AWeber.';
  } finally {
    checkingAweber.value = false;
  }
}

/** Builds the drafts. `rebuild` names versions to make again. */
async function buildDrafts(rebuild: string[] = []) {
  if (!campaign.value) return;
  const again = rebuild.length;
  if (!window.confirm(again
    ? `This creates ${again === 1 ? 'a new draft' : `${again} new drafts`} in AWeber, alongside anything already there. Nothing is sent. Continue?`
    : 'This creates three drafts in AWeber. Nothing is scheduled and nothing is sent — you choose the segment and the time there. Continue?')) return;
  building.value = true; error.value = '';
  try {
    if (dirty.value) await save();
    const res = await apiFetch('/.netlify/functions/campaign-aweber', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: campaign.value.slug, action: 'drafts', rebuild }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok && !d.drafts) {
      if (Array.isArray(d.blocking)) buildState.value = { ready: false, blocking: d.blocking, error: d.error };
      throw new Error(d.error || `The request failed (${res.status}).`);
    }
    buildResult.value = d;
    if (d.error) error.value = d.error;
    await checkAweber();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not build the drafts.';
  } finally {
    building.value = false;
  }
}

async function markSent() {
  if (!campaign.value) return;
  if (!window.confirm('This records the campaign as sent. It does not send anything — AWeber does that. Continue?')) return;
  const res = await apiFetch('/.netlify/functions/admin-campaign-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: campaign.value.slug, action: 'sent' }),
  });
  if (res.ok) await load();
}

onMounted(async () => {
  try { await loadIndex(); } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not list the campaigns.';
  }
  // The soonest unsent campaign is the one being worked on.
  slug.value = list.value.find((c) => c.status !== 'sent')?.slug ?? list.value[0]?.slug ?? '';
  if (slug.value) await load(); else loading.value = false;
});

watch(slug, async (v, old) => {
  if (!old || v === old) return;
  clearTimeout(autosave);
  if (dirty.value) { try { await save(); } catch { /* already on screen */ } }
  await load();
});

/**
 * Autosaved, like the newsletter.
 *
 * Copy for a dated send is written over more than one sitting, and the thing
 * that hurts to lose is the paragraph somebody got right on the third try.
 */
watch(campaign, () => {
  if (hydrating.value || loading.value || !campaign.value) return;
  dirty.value = true;
  clearTimeout(autosave);
  const target = slug.value;
  autosave = setTimeout(() => {
    if (dirty.value && !saving.value && slug.value === target) save();
  }, 4000);
}, { deep: true });
</script>

<template>
  <div class="campaign">
    <!-- Which campaign -->
    <div class="widget bar">
      <label class="bar__pick">
        <span>Campaign</span>
        <select v-model="slug" :disabled="saving">
          <option v-for="c in list" :key="c.slug" :value="c.slug">
            {{ c.name || c.slug }}{{ c.status === 'sent' ? ' — sent' : '' }}
          </option>
          <option v-if="slug && !list.some((c) => c.slug === slug)" :value="slug">{{ slug }} — new</option>
        </select>
      </label>
      <button type="button" class="btn btn--sm btn--ghost" @click="create()">New campaign</button>
      <span class="bar__spacer" />
      <span v-if="saving" class="state">Saving…</span>
      <span v-else-if="saved && !dirty" class="ok">Saved</span>
      <span v-else-if="dirty" class="state">Unsaved</span>
      <button type="button" class="btn btn--sm" :disabled="saving || !campaign || !dirty" @click="save()">Save</button>
    </div>

    <p v-if="error" class="state state--err">{{ error }}</p>
    <p v-if="loading" class="state">Loading…</p>

    <template v-else-if="campaign">
      <p v-if="!exists" class="warn">
        This campaign has not been saved yet. It is created the first time you save, and the slug
        <code>{{ campaign.slug }}</code> is what the donation link's <code>?campaign=</code> carries — so it has to
        match the campaign row the donation tracking uses.
      </p>
      <p v-if="campaign.status === 'sent'" class="ready">
        Recorded as sent{{ campaign.sentAt ? ` on ${when(campaign.sentAt)}` : '' }}. Editing it now changes the record,
        not the email.
      </p>

      <!-- The campaign itself -->
      <section class="widget block">
        <h2 class="block__title">The campaign</h2>
        <p class="block__hint">
          One link and one button label, shared by every version. The brief's rule is one clear call to action, with
          the button appearing at most once.
        </p>
        <div class="grid">
          <label class="f">
            <span>Name</span>
            <input v-model="campaign.name" type="text" maxlength="120" placeholder="Giving Tuesday 2026" />
          </label>
          <label class="f">
            <span>Send date</span>
            <input v-model="campaign.sendDate" type="date" />
          </label>
          <label class="f">
            <span>Button label</span>
            <input v-model="campaign.buttonLabel" type="text" maxlength="120" placeholder="Give Today →" />
          </label>
        </div>
        <label class="f">
          <span>Donation link</span>
          <input v-model="campaign.link" type="url" maxlength="500"
            placeholder="https://josephcentergj.com/donate?campaign=giving-tuesday-2026" />
        </label>
        <p class="block__hint block__hint--tight">
          Absolute <code>https://</code>, always. A relative link has nothing to resolve against in an inbox, and a
          bare domain is read as a path.
        </p>
        <label class="f">
          <span>Instead of the button, where a version is not asking</span>
          <input v-model="campaign.closingNote" type="text" maxlength="600" />
        </label>
        <p class="block__hint block__hint--tight">
          Recurring donors already give every month, so they are not asked again — this line stands where their button
          would be.
        </p>
      </section>

      <!-- The copy, per version -->
      <section class="widget block">
        <h2 class="block__title">
          The copy
          <span class="pill pill--warn">{{ words }} words</span>
          <span v-if="words < range[0] || words > range[1]" class="count count--over">
            the brief asks for {{ range[0] }}–{{ range[1] }}
          </span>
          <span v-else class="count">within {{ range[0] }}–{{ range[1] }}</span>
        </h2>

        <div class="tabs">
          <button
            v-for="v in versions" :key="v.id" type="button"
            class="tab" :class="{ 'tab--on': active === v.id }"
            @click="active = v.id">{{ v.label }}</button>
        </div>

        <p v-if="currentSpec" class="block__hint">
          {{ currentSpec.audience }}
          Signed <strong>{{ currentSpec.signature }}</strong>.
          <template v-if="!currentSpec.showButton"> No button on this one.</template>
        </p>

        <template v-if="current">
          <label class="f">
            <span>Subject line</span>
            <input v-model="current.subject" type="text" maxlength="300" />
          </label>
          <label class="f">
            <span>
              Preview text — the line that follows the subject in the inbox
              <span class="count" :class="{ 'count--over': current.previewText.length > PREVIEW_LIMIT }">
                {{ current.previewText.length }}/{{ PREVIEW_LIMIT }}
              </span>
            </span>
            <input v-model="current.previewText" type="text" maxlength="300" />
          </label>
          <div class="inbox" v-if="current.subject || current.previewText">
            <strong>{{ current.subject || 'no subject set' }}</strong>
            <span class="inbox__preview"> — {{ current.previewText || 'no preview text set' }}</span>
          </div>
          <label class="f">
            <span>The message</span>
            <textarea v-model="current.body" rows="12"
              placeholder="Plain writing. A blank line starts a paragraph; &quot;## &quot; is a heading; &quot;- &quot; is a bullet; &quot;&gt; &quot; is a pull quote. The greeting and the signature are added for you."></textarea>
          </label>
          <p class="block__hint block__hint--tight">
            The greeting (<code>{{ GREETING }}</code>) and the signature are added by the renderer, as they are in
            the newsletter — don't write either one here.
          </p>
        </template>
      </section>

      <!-- Review -->
      <section class="widget block">
        <h2 class="block__title">
          Review
          <span v-if="!issues.length" class="pill pill--ok">nothing outstanding</span>
          <span v-else class="pill pill--warn">{{ musts.length }} to fix, {{ shoulds.length }} to check</span>
          <span v-if="dismissed.length" class="pill pill--set">{{ dismissed.length }} set aside</span>
        </h2>
        <p class="block__hint">
          The campaign brief's Do/Don't list, as string tests: the bridge framing, "a hand forward", guests, the
          retired terms, the words and figures the brief rules out, and one check that every link is absolute. Each one
          is a judgement in a regular expression, so when one is wrong about a correct sentence, set it aside with a
          reason rather than editing good copy to satisfy it.
        </p>
        <p v-if="!issues.length" class="ready">
          Checked and clear across all three versions: framing and terminology, urgency and matching-gift language,
          the numbers the brief allows, first names only, subject and preview lengths, word counts, and the link.
          <template v-if="dismissed.length">
            {{ dismissed.length === 1 ? 'One item was' : `${dismissed.length} items were` }} set aside to get here.
          </template>
        </p>

        <ul v-if="issues.length" class="issues">
          <li v-for="i in issues" :key="i.id" class="issue" :class="`issue--${i.severity}`">
            <span class="sev" :class="`sev--${i.severity}`">{{ i.severity === 'must' ? 'Fix' : 'Check' }}</span>
            <div class="issue__body">
              <p class="issue__problem"><strong>{{ i.where }}</strong> — {{ i.problem }}</p>
              <p class="issue__fix">{{ i.fix }}</p>
              <form v-if="dismissing === i.id" class="setaside__form" @submit.prevent="confirmDismiss(i)">
                <label :for="`cwhy-${i.id}`">Why is this one wrong?</label>
                <input :id="`cwhy-${i.id}`" v-model="dismissReason" type="text" maxlength="400"
                  placeholder="It is the program's official name, not a person" />
                <div class="setaside__row">
                  <button type="submit" class="btn btn--sm" :disabled="dismissReason.trim().length < 5">Set it aside</button>
                  <button type="button" class="linkish" @click="dismissing = ''">Cancel</button>
                  <span class="setaside__note">This campaign only, and only for this exact wording.</span>
                </div>
              </form>
              <!--
                Every campaign check can be set aside. Nothing here is a
                mechanical fact about an AWeber account the way a reused
                monthly tag is — it is all the brief's judgement, and the
                brief can be wrong about a particular sentence.
              -->
              <button v-else type="button" class="linkish setaside__open" @click="startDismiss(i)">
                This one is wrong — set it aside
              </button>
            </div>
          </li>
        </ul>

        <details v-if="dismissed.length" class="setaside">
          <summary>
            {{ dismissed.length }} set aside<template v-if="dismissedMusts"> — {{ dismissedMusts }}
            {{ dismissedMusts === 1 ? 'of them a Fix' : 'of them Fixes' }}</template>
          </summary>
          <ul class="issues">
            <li v-for="d in dismissed" :key="d.id" class="issue issue--set">
              <span class="sev sev--set">{{ d.severity === 'must' ? 'Fix' : 'Check' }}</span>
              <div class="issue__body">
                <p class="issue__problem"><strong>{{ d.where }}</strong> — {{ d.problem }}</p>
                <p class="issue__fix">
                  “{{ d.reason }}”<template v-if="d.by"> — {{ d.by }}</template><template v-if="d.at">, {{ when(d.at) }}</template>
                </p>
                <button type="button" class="linkish setaside__open" @click="restore(d)">Put it back in the review</button>
              </div>
            </li>
          </ul>
        </details>

        <p v-if="staleOverrides.length" class="block__hint">
          {{ staleOverrides.length }} earlier set-aside{{ staleOverrides.length === 1 ? '' : 's' }}
          {{ staleOverrides.length === 1 ? 'matches' : 'match' }} nothing now — the copy has changed since.
          <button type="button" class="linkish" @click="clearStale()">Clear them</button>
        </p>
      </section>

      <!-- What to paste into AWeber -->
      <section class="widget block">
        <h2 class="block__title">
          {{ currentSpec?.label ?? 'Output' }}
          <button type="button" class="linkish" @click="showHtml = !showHtml">
            {{ showHtml ? 'Show the rendered email' : 'Show the HTML' }}
          </button>
        </h2>
        <p class="block__hint">
          Rendered by the same module the newsletter is rendered by — the same card, greeting, button and signature.
          Paste the HTML into AWeber's HTML mode, as the monthly newsletter is pasted. Nothing here sends anything.
        </p>

        <template v-if="currentOut">
          <div class="plan">
            <dl>
              <dt>AWeber tag</dt><dd><code>{{ currentOut.aweberTag }}</code></dd>
              <dt>Exclude</dt><dd><code>{{ currentOut.excludes.join(', ') }}</code></dd>
              <dt>Signature</dt><dd>{{ currentOut.signature }}</dd>
            </dl>
          </div>
          <div class="outrow">
            <button type="button" class="btn btn--sm" @click="copy(currentOut.html, active + '-html')">
              {{ copied === active + '-html' ? 'Copied' : 'Copy the HTML' }}
            </button>
            <button type="button" class="btn btn--sm btn--ghost" @click="copy(currentOut.text, active + '-text')">
              {{ copied === active + '-text' ? 'Copied' : 'Copy the plain text' }}
            </button>
            <button type="button" class="linkish" :disabled="!currentOut.subject"
              @click="copy(currentOut.subject, active + '-subject')">
              {{ copied === active + '-subject' ? 'Copied' : 'Copy the subject' }}
            </button>
            <button type="button" class="linkish" :disabled="!currentOut.previewText"
              @click="copy(currentOut.previewText, active + '-preview')">
              {{ copied === active + '-preview' ? 'Copied' : 'Copy the preview text' }}
            </button>
          </div>
          <!--
            An iframe rather than a div: the email's styles are inline but its
            tables are not, and letting 600px of email table inherit the
            dashboard's own CSS would show a layout nobody is going to receive.
          -->
          <iframe v-if="!showHtml" class="render" :srcdoc="currentOut.html" title="Rendered email" />
          <pre v-else class="preview">{{ currentOut.html }}</pre>
          <details class="setaside">
            <summary>The plain-text version</summary>
            <pre class="preview">{{ currentOut.text }}</pre>
          </details>
        </template>

      </section>

      <!-- Build the drafts in AWeber -->
      <section class="widget block">
        <h2 class="block__title">Build the drafts in AWeber</h2>
        <p class="block__hint">
          Creates one draft per version, from the saved copy, the same way the monthly newsletter does. It stops
          there: a campaign email goes out as a broadcast to a segment at a chosen minute, and choosing the segment
          and the minute stays with you. Nothing here schedules or sends anything.
        </p>

        <div class="outrow">
          <button type="button" class="btn btn--sm btn--ghost" :disabled="checkingAweber || building" @click="checkAweber()">
            {{ checkingAweber ? 'Checking…' : 'Check AWeber' }}
          </button>
          <button
            v-if="buildState?.ready" type="button" class="btn btn--sm" :disabled="building"
            @click="buildDrafts()">{{ building ? 'Building…' : 'Build the three drafts' }}</button>
        </div>

        <template v-if="buildOpen && buildState">
          <p v-if="buildState.error" class="warn">{{ buildState.error }}</p>

          <ul v-if="buildState.missingScopes?.length" class="issues">
            <li class="issue issue--must">
              <span class="sev sev--must">Fix</span>
              <div class="issue__body">
                <p class="issue__problem">AWeber has not granted {{ buildState.missingScopes.join(', ') }}.</p>
                <p class="issue__fix">Re-authorize with the wider scopes — scripts/aweber-oauth.mjs.</p>
              </div>
            </li>
          </ul>

          <template v-else-if="buildState.blocking?.length">
            <p class="warn">
              {{ buildState.blocking.length }} thing{{ buildState.blocking.length === 1 ? '' : 's' }} still to fix
              before the drafts can be built. A draft sitting in AWeber is a draft somebody will send, so the
              server refuses while anything is outstanding — set an item aside above if the check is wrong.
            </p>
            <ul class="issues">
              <li v-for="i in buildState.blocking" :key="i.id" class="issue issue--must">
                <span class="sev sev--must">Fix</span>
                <div class="issue__body">
                  <p class="issue__problem"><strong>{{ i.where }}</strong> — {{ i.problem }}</p>
                  <p class="issue__fix">{{ i.fix }}</p>
                </div>
              </li>
            </ul>
          </template>

          <template v-else-if="buildState.versions">
            <ul class="built">
              <li v-for="v in buildState.versions" :key="v.id">
                <strong>{{ v.label }}</strong>
                <template v-if="v.builtId && !v.missingInAweber">
                  — draft <code>{{ v.builtId }}</code> built{{ v.builtAt ? ` ${when(v.builtAt)}` : '' }}
                  <a :href="`https://www.aweber.com/users/messages/edit/${v.builtId}`" target="_blank" rel="noopener">open in AWeber</a>
                  <button type="button" class="linkish" :disabled="building" @click="buildDrafts([v.id])">rebuild</button>
                </template>
                <template v-else-if="v.missingInAweber">
                  <span class="built__gone">— draft {{ v.builtId }} is no longer in AWeber; somebody deleted it there.</span>
                  <button type="button" class="linkish" :disabled="building" @click="buildDrafts([v.id])">build it again</button>
                </template>
                <template v-else>— not built yet</template>
                <span class="built__subject">“{{ v.subject || 'no subject' }}”</span>
              </li>
            </ul>
            <p class="block__hint block__hint--tight">
              Two versions may share a subject line, so what has been built is tracked by broadcast id rather than
              by subject — the newsletter's check would have built two and skipped the third.
            </p>
          </template>
        </template>

        <template v-if="buildResult">
          <p class="ready">
            {{ buildResult.drafts.filter((d) => d.broadcastId && !d.skipped).length }} built,
            {{ buildResult.drafts.filter((d) => d.skipped).length }} already there.
          </p>
          <p v-if="!buildResult.recorded" class="warn">
            The drafts were created but the record of them could not be saved. They are in AWeber — check there
            before building again, or you will get duplicates.
          </p>
          <!--
            The one thing the API cannot carry. AWeber's broadcast endpoint has
            no field for a preview line, so it has to be typed in their editor
            or the inbox shows the first line of the HTML — which is the
            greeting. October went out that way.
          -->
          <div class="hand">
            <p><strong>Set by hand in AWeber, per draft:</strong></p>
            <ul>
              <li>
                <strong>Preview text</strong> — the API has no field for it.
                <span v-for="v in versions" :key="v.id" class="hand__row">
                  <em>{{ v.label }}:</em>
                  <button type="button" class="linkish" :disabled="!v.previewText"
                    @click="copy(v.previewText, 'pt-' + v.id)">
                    {{ copied === 'pt-' + v.id ? 'Copied' : (v.previewText || 'not set') }}
                  </button>
                </span>
              </li>
              <li><strong>The segment</strong> — one per version, on the tier tags listed above each one.</li>
              <li><strong>The schedule</strong> — 7:30 AM Mountain on {{ campaign.sendDate || 'the send date' }}.</li>
            </ul>
          </div>
        </template>

        <p v-if="campaign.status !== 'sent'" class="finish">
          <button type="button" class="linkish" @click="markSent()">Record this campaign as sent</button>
          — bookkeeping only, after you have sent it in AWeber.
        </p>
      </section>
    </template>

    <p v-else-if="!error" class="state">
      No campaign emails yet. <button type="button" class="linkish" @click="create()">Start one</button>.
    </p>
  </div>
</template>

<style scoped>
.block { margin-bottom: 1.25rem; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .35rem; display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 1rem; line-height: 1.55; }
.block__hint--tight { margin: -.4rem 0 .9rem; }
.state { color: var(--color-text-secondary); font-size: .8125rem; }
.state--err { color: #8a1f1f; }
.bar { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; margin-bottom: 1.25rem; padding: .85rem 1.25rem; }
.bar__spacer { flex: 1; }
.bar__pick { display: flex; align-items: center; gap: .5rem; font-size: .75rem; color: var(--color-text-secondary); }
.pill { font-size: .65rem; font-weight: 600; padding: .12rem .5rem; border-radius: 999px; }
.pill--ok { color: #14532d; background: color-mix(in srgb, #14532d 12%, transparent); }
.pill--warn { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }
.pill--set { color: var(--color-text-secondary); background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent); }
.ready { font-size: .8125rem; color: #14532d; margin: 0 0 .6rem; line-height: 1.55; }
.warn { font-size: .8125rem; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 8%, transparent); border-radius: var(--border-radius); padding: .6rem .7rem; margin: 0 0 .9rem; line-height: 1.5; }
.ok { font-size: .75rem; color: var(--color-primary-strong); }

input, select, textarea { padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
textarea { width: 100%; resize: vertical; line-height: 1.6; font-family: var(--font-mono, ui-monospace, monospace); }
.f { display: block; margin-bottom: .7rem; }
.f > span { display: block; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: .25rem; }
.f input { width: 100%; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 0 .9rem; }

.tabs { display: flex; gap: .3rem; flex-wrap: wrap; margin: 0 0 .8rem; }
.tab { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .35rem .7rem; font: inherit; font-size: .75rem; color: var(--color-text-secondary); cursor: pointer; }
.tab--on { background: var(--color-surface); color: var(--color-text); border-color: var(--color-primary-strong); font-weight: 600; }

.inbox { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .55rem .7rem; font-size: .8125rem; margin: -.2rem 0 .8rem; }
.inbox__preview { color: var(--color-text-secondary); }

.count { font-size: .6875rem; color: var(--color-text-secondary); }
.count--over { color: var(--color-danger, #b3261e); font-weight: 600; }

.issues { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem; }
.issue { display: flex; gap: .6rem; align-items: flex-start; padding: .55rem .7rem; background: var(--color-bg); border-radius: var(--border-radius); border-left: 3px solid var(--color-border); }
.issue--must { border-left-color: #8a1f1f; }
.issue--should { border-left-color: #8a5a1f; }
.issue--set { border-left-color: var(--color-border); opacity: .85; }
.issue__body { min-width: 0; }
.issue__problem { margin: 0; font-size: .8125rem; }
.issue__fix { margin: .15rem 0 0; font-size: .75rem; color: var(--color-text-secondary); line-height: 1.5; }
.sev { font-size: .6rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: .1rem .35rem; border-radius: 3px; flex-shrink: 0; margin-top: .1rem; }
.sev--must { color: #8a1f1f; background: color-mix(in srgb, #8a1f1f 12%, transparent); }
.sev--should { color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); }
.sev--set { color: var(--color-text-secondary); background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent); }

.setaside { margin-top: .7rem; font-size: .8125rem; }
.setaside > summary { cursor: pointer; color: var(--color-text-secondary); font-size: .75rem; padding: .2rem 0; }
.setaside > ul, .setaside > pre { margin-top: .45rem; }
.setaside__open { margin-top: .3rem; font-size: .72rem; }
.setaside__form { margin-top: .45rem; display: grid; gap: .3rem; }
.setaside__form label { font-size: .7rem; font-weight: 600; color: var(--color-text-secondary); }
.setaside__form input { width: 100%; }
.setaside__row { display: flex; gap: .55rem; align-items: center; flex-wrap: wrap; }
.setaside__note { font-size: .7rem; color: var(--color-text-secondary); }

.plan dl { display: grid; grid-template-columns: max-content 1fr; gap: .2rem .8rem; margin: 0 0 .8rem; font-size: .75rem; }
.plan dt { color: var(--color-text-secondary); }
.plan dd { margin: 0; }
.outrow { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin-bottom: .8rem; }
.render { width: 100%; height: 34rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: #FAFAF7; }
.preview { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .9rem; font-size: .75rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; max-height: 32rem; overflow-y: auto; margin: 0; }
.finish { border-top: 1px solid var(--color-border); margin-top: 1rem; padding-top: .8rem; font-size: .75rem; color: var(--color-text-secondary); }
.built { list-style: none; margin: .2rem 0 .6rem; padding: 0; font-size: .8125rem; display: grid; gap: .35rem; }
.built li { padding: .4rem .6rem; background: var(--color-bg); border-radius: var(--border-radius); line-height: 1.6; }
.built a { color: var(--color-text-secondary); font-size: .75rem; }
.built__gone { color: #8a5a1f; }
.built__subject { display: block; color: var(--color-text-secondary); font-size: .75rem; }
.hand { font-size: .8125rem; background: var(--color-bg); border-radius: var(--border-radius); padding: .7rem .8rem; line-height: 1.6; }
.hand p { margin: 0 0 .3rem; }
.hand ul { margin: 0; padding-left: 1.1rem; }
.hand li { margin-bottom: .3rem; }
.hand__row { display: block; margin-left: .2rem; }
.hand__row em { color: var(--color-text-secondary); font-style: normal; font-size: .75rem; margin-right: .3rem; }

.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .4rem .9rem; font-size: .8125rem; }
.btn--ghost { background: none; color: var(--color-text-secondary); border: 1px solid var(--color-border); }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }
.linkish:disabled { opacity: .5; cursor: not-allowed; text-decoration: none; }
code { font-size: .9em; }
</style>
