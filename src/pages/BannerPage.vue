<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';
import { bannerShowingAt, windowsOverlap } from '../../netlify/functions/_lib/banner';

// The notice across the top of every page — closures, changed hours,
// announcements.
//
// The message is stored as rich text so it can carry a link, but nobody posting
// "we are closed today" should have to think about that. This is a sentence, an
// optional link, and when it should stop showing.

interface Banner {
  _id: string; title?: string; active?: boolean;
  startsAt?: string; endsAt?: string; _updatedAt?: string;
  text: string; linkLabel: string; linkHref: string;
  live: boolean; state: 'off' | 'scheduled' | 'expired' | 'live';
}
interface Template { id: string; label: string; text: string; linkLabel?: string }

const banners = ref<Banner[]>([]);
const templates = ref<Template[]>([]);
const loading = ref(true);
const error = ref('');
const saving = ref(false);
const savedAt = ref(0);
/**
 * Banners this save switched off.
 *
 * Only ones sharing a week with what was just posted, since only one can show
 * at a time. Said out loud because the alternative is finding out later that
 * posting a notice took something else down.
 */
const switchedOff = ref<string[]>([]);
const busyId = ref<string | null>(null);
const confirmDelete = ref<string | null>(null);

const form = ref({ _id: '', text: '', linkLabel: '', linkHref: '', startsAt: '', endsAt: '' });
const editingExisting = computed(() => !!form.value._id);

/**
 * The one slot, and who is in it when.
 *
 * Banners can be scheduled, so there is a running order rather than a current
 * banner — four of them for November and December is the ordinary case. But
 * only one shows at a time, and when two windows overlap the site picks the one
 * ending soonest. That rule is invisible from a list, so it is applied here and
 * said out loud: a banner that will be hidden by another says so, in the queue,
 * before anybody schedules their month around it.
 *
 * The ordering mirrors SiteBanner.vue exactly. If the two ever disagree the
 * page is lying about the website, which is worse than not showing this at all.
 */
const startOf = (b: Banner) => (b.startsAt ? new Date(b.startsAt).getTime() : Number.NEGATIVE_INFINITY);
const endOf = (b: Banner) => (b.endsAt ? new Date(b.endsAt).getTime() : Number.POSITIVE_INFINITY);
const isOn = (b: Banner) => b.active !== false;
const winnerAt = (t: number) => bannerShowingAt(banners.value, t);

// Not `banners.find(b => b.live)`: with two live at once that returned whichever
// the API listed first, which is no longer the one the site shows.
const liveBanner = computed(() => winnerAt(Date.now()));

/**
 * What is up now and what follows, in the order visitors will meet it.
 *
 * A banner is placed at the moment it starts mattering — now, if it has already
 * begun. `hiddenBy` is checked at that same moment, because a notice scheduled
 * inside a longer campaign is exactly the case that looks fine in a list and
 * does not happen.
 */
const queue = computed(() => {
  const now = Date.now();
  return banners.value
    .filter((b) => isOn(b) && endOf(b) >= now)
    .sort((a, b) => {
      const sa = Math.max(startOf(a), now), sb = Math.max(startOf(b), now);
      if (sa !== sb) return sa - sb;
      return endOf(a) - endOf(b);
    })
    .map((b) => {
      const at = Math.max(startOf(b), now);
      const winner = winnerAt(at);
      return { b, hiddenBy: winner && winner._id !== b._id ? winner : null };
    });
});

/** Switched off, or finished. Kept, because the wording gets reused next year. */
const shelved = computed(() =>
  banners.value.filter((b) => !isOn(b) || endOf(b) < Date.now())
);

/** Which already-scheduled banners this draft would take down if posted. */
const wouldSwitchOff = computed(() => {
  const draft = { startsAt: fromLocal(form.value.startsAt), endsAt: fromLocal(form.value.endsAt) };
  return banners.value.filter(
    (b) => b._id !== form.value._id && isOn(b) && endOf(b) >= Date.now() && windowsOverlap(draft, b)
  );
});

const startsLater = computed(() => {
  const t = form.value.startsAt ? new Date(form.value.startsAt).getTime() : NaN;
  return Number.isFinite(t) && t > Date.now();
});

const STATE_LABEL: Record<Banner['state'], string> = {
  live: 'Showing now', scheduled: 'Scheduled', expired: 'Finished', off: 'Off',
};

/** A date without a time, for a queue read at a glance. */
const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const span = (b: Banner) =>
  !b.startsAt && !b.endsAt
    ? 'until it is taken down'
    : !b.startsAt ? `now until ${day(b.endsAt)}`
    : !b.endsAt ? `from ${day(b.startsAt)}, until taken down`
    : `${day(b.startsAt)} – ${day(b.endsAt)}`;

const toLocal = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : '');
const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-banner');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    banners.value = d.banners; templates.value = d.templates;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the banner.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function blank() {
  form.value = { _id: '', text: '', linkLabel: '', linkHref: '', startsAt: '', endsAt: '' };
  error.value = '';
}
function edit(b: Banner) {
  form.value = {
    _id: b._id, text: b.text, linkLabel: b.linkLabel, linkHref: b.linkHref,
    startsAt: toLocal(b.startsAt), endsAt: toLocal(b.endsAt),
  };
  error.value = '';
}
function useTemplate(t: Template) {
  form.value.text = t.text;
  if (t.linkLabel) form.value.linkLabel = t.linkLabel;
}

// The commonest case by far: something that should stop on its own tonight.
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  form.value.endsAt = toLocal(d.toISOString());
}

async function post(payload: Record<string, unknown>, id = '') {
  busyId.value = id || 'form';
  saving.value = true;
  error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-banner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    savedAt.value = Date.now();
    switchedOff.value = Array.isArray(d.switchedOff) ? d.switchedOff : [];
    confirmDelete.value = null;
    await load();
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
    return false;
  } finally {
    saving.value = false;
    busyId.value = null;
  }
}

async function publish() {
  const ok = await post({
    ...form.value,
    startsAt: fromLocal(form.value.startsAt),
    endsAt: fromLocal(form.value.endsAt),
    active: true,
  }, form.value._id);
  if (ok) blank();
}
const switchOff = (b: Banner) => post({ action: 'off', _id: b._id }, b._id);
const remove = (b: Banner) => post({ action: 'delete', _id: b._id }, b._id);
</script>

<template>
  <DashboardLayout page-title="Site banner">
    <p v-if="loading" class="state">Loading…</p>

    <template v-else>
      <!-- What visitors see right now -->
      <div class="widget block">
        <h2 class="block__title">On the website right now</h2>
        <div v-if="liveBanner" class="preview">
          <p class="preview__msg">
            {{ liveBanner.text }}
            <a v-if="liveBanner.linkHref" :href="liveBanner.linkHref" class="preview__link" target="_blank" rel="noopener">{{ liveBanner.linkLabel }}</a>
          </p>
        </div>
        <p v-else class="state">No banner is showing. The top of the site is clear.</p>
        <p v-if="liveBanner?.endsAt" class="block__hint stops">Stops on its own at {{ when(liveBanner.endsAt) }}.</p>
        <div v-if="liveBanner" class="row-actions">
          <button type="button" class="linkish" @click="edit(liveBanner)">Edit this</button>
          <button type="button" class="linkish" :disabled="busyId === liveBanner._id" @click="switchOff(liveBanner)">Take it down</button>
        </div>
      </div>

      <p v-if="error" class="state state--err" role="alert">{{ error }}</p>

      <!-- The running order -->
      <section class="widget block">
        <h2 class="block__title">The queue</h2>
        <p v-if="queue.length < 2" class="block__hint">
          Banners can be scheduled, so you can set up a month of them at once and leave it alone.
          Only one shows at a time; where two share dates, the one ending soonest wins.
        </p>
        <p v-else class="block__hint">
          In the order visitors will see them. Only one shows at a time; where two share dates,
          the one ending soonest wins.
        </p>

        <ol v-if="queue.length" class="queue">
          <li v-for="({ b, hiddenBy }, i) in queue" :key="b._id" class="queue__item">
            <div class="queue__when">
              <span class="pill" :class="hiddenBy ? 'pill--off' : i === 0 ? 'pill--live' : 'pill--scheduled'">
                {{ hiddenBy ? 'Hidden' : i === 0 ? 'Showing now' : 'Then' }}
              </span>
              <span class="queue__dates">{{ span(b) }}</span>
            </div>
            <div class="queue__body">
              <p class="queue__text">{{ b.text || b.title || '(no message)' }}</p>
              <p v-if="hiddenBy" class="queue__warn">
                Will not appear — <strong>{{ hiddenBy.text || hiddenBy.title }}</strong> ends sooner
                and takes the slot. Give this one dates that do not overlap, or fold both messages
                into one banner.
              </p>
            </div>
            <div class="queue__actions">
              <button type="button" class="linkish" @click="edit(b)">Edit</button>
              <button type="button" class="linkish" :disabled="busyId === b._id" @click="switchOff(b)">
                {{ i === 0 && !hiddenBy ? 'Take it down' : 'Switch off' }}
              </button>
            </div>
          </li>
        </ol>
        <p v-else class="state">Nothing queued. The top of the site is clear.</p>
      </section>

      <!-- Write one -->
      <section class="widget block">
        <h2 class="block__title">{{ editingExisting ? 'Edit the banner' : 'Post a banner' }}</h2>
        <p class="block__hint">
          Give it dates and it joins the queue — it does not have to go up now. Posting it only takes
          down banners that share its dates; ones set for other weeks are left alone.
        </p>

        <div v-if="!editingExisting" class="templates">
          <span class="templates__label">Start from:</span>
          <button v-for="t in templates" :key="t.id" type="button" class="chip" @click="useTemplate(t)">{{ t.label }}</button>
        </div>

        <label class="f">
          <span>Message</span>
          <textarea v-model="form.text" rows="2" maxlength="400" placeholder="e.g. The Joseph Center is closed today due to weather." />
        </label>

        <div class="grid2">
          <label class="f"><span>Link text (optional)</span><input v-model="form.linkLabel" type="text" placeholder="See the details →" /></label>
          <label class="f"><span>Link address</span><input v-model="form.linkHref" type="text" placeholder="/events or https://…" /></label>
        </div>

        <div class="grid2">
          <label class="f"><span>Start showing (optional)</span><input v-model="form.startsAt" type="datetime-local" /></label>
          <label class="f">
            <span>Stop showing (optional)</span>
            <input v-model="form.endsAt" type="datetime-local" />
          </label>
        </div>
        <p class="block__hint">
          <button type="button" class="linkish" @click="endOfToday">Stop at the end of today</button>
          — worth setting for anything temporary, so a closure notice cannot outlive the closure.
        </p>

        <p v-if="wouldSwitchOff.length" class="warn">
          This shares dates with
          <strong>{{ wouldSwitchOff.map((b) => b.text || b.title).join(', ') }}</strong>,
          so posting it will switch {{ wouldSwitchOff.length === 1 ? 'that one' : 'those' }} off.
          Only one banner shows at a time.
        </p>

        <div class="preview preview--draft" v-if="form.text || form.linkLabel">
          <p class="preview__cap">How it will look</p>
          <p class="preview__msg">
            {{ form.text }}
            <a v-if="form.linkLabel" class="preview__link" href="#" @click.prevent>{{ form.linkLabel }}</a>
          </p>
        </div>

        <div class="actions">
          <button type="button" class="btn btn--sm" :disabled="saving || (!form.text && !form.linkLabel)" @click="publish">
            {{ saving
              ? 'Saving…'
              : editingExisting ? 'Save changes'
              : startsLater ? `Add it to the queue for ${day(fromLocal(form.startsAt))}`
              : 'Put it on the site' }}
          </button>
          <button v-if="editingExisting" type="button" class="linkish" @click="blank">Cancel</button>
          <span v-if="savedAt && !saving" class="ok">Saved</span>
          <span v-if="switchedOff.length && !saving" class="block__hint">
            Switched off, because it shares these dates:
            {{ switchedOff.join(', ') }}
          </span>
        </div>
      </section>

      <!-- Everything else on file -->
      <details v-if="shelved.length" class="widget fold">
        <summary class="fold__summary">Switched off and finished ({{ shelved.length }})</summary>
        <p class="block__hint">Kept, because most of this wording gets reused next year.</p>
        <ul class="list">
          <li v-for="b in shelved" :key="b._id" class="item">
            <div class="item__body">
              <p class="item__text">{{ b.text || b.title || '(no message)' }}</p>
              <p class="item__meta">
                <span class="pill" :class="`pill--${b.state}`">{{ STATE_LABEL[b.state] }}</span>
                <template v-if="b.startsAt">from {{ when(b.startsAt) }}</template>
                <template v-if="b.endsAt">until {{ when(b.endsAt) }}</template>
              </p>
            </div>
            <div class="item__actions">
              <button type="button" class="linkish" @click="edit(b)">Edit</button>
              <template v-if="confirmDelete === b._id">
                <span class="warn">Delete for good?</span>
                <button type="button" class="linkish linkish--danger" :disabled="busyId === b._id" @click="remove(b)">Yes, delete</button>
                <button type="button" class="linkish" @click="confirmDelete = null">Cancel</button>
              </template>
              <button v-else type="button" class="linkish linkish--danger" @click="confirmDelete = b._id">Delete</button>
            </div>
          </li>
        </ul>
      </details>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.block { margin-bottom: 1.25rem; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .5rem; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 1rem; }
.stops { margin: .5rem 0 0; }
.state { color: var(--color-text-secondary); font-size: .875rem; }
.state--err { color: #8a1f1f; margin-bottom: .75rem; }

/* Mirrors the site's own banner — cream panel, gold left bar — so what is
   written here is recognizable as what will appear. */
.preview { background: #f4f1ea; border-left: 5px solid #C9A227; border-radius: 0 var(--border-radius) var(--border-radius) 0; padding: .8rem 1rem; }
.preview--draft { margin: .5rem 0 1rem; }
.preview__cap { margin: 0 0 .3rem; font-family: var(--font-heading); font-size: .6rem; letter-spacing: .06em; text-transform: uppercase; color: #6b6350; }
.preview__msg { margin: 0; font-size: .875rem; color: #262626; }
.preview__link { color: #1D5F55; font-weight: 700; text-decoration: underline; }

.row-actions { display: flex; gap: 1rem; margin-top: .75rem; }
.templates { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; margin-bottom: 1rem; }
.templates__label { font-size: .75rem; color: var(--color-text-secondary); }
.chip { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 999px; padding: .25rem .7rem; font: inherit; font-size: .75rem; cursor: pointer; color: var(--color-text); }
.chip:hover { border-color: var(--color-primary-strong); color: var(--color-primary-strong); }

.f { display: block; margin-bottom: .7rem; }
.f > span { display: block; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: .25rem; }
.f input, .f textarea { width: 100%; padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
.actions { display: flex; align-items: center; gap: 1rem; margin-top: .5rem; }
.ok { font-size: .75rem; color: var(--color-primary-strong); }

.fold { padding: 0; }
.fold__summary { cursor: pointer; padding: 1rem 1.25rem; font-family: var(--font-heading); font-size: 1rem; list-style-position: inside; }
.list { list-style: none; margin: 0; padding: 0 1.25rem 1.25rem; display: grid; gap: .5rem; }
.item { display: flex; justify-content: space-between; gap: 1rem; padding: .65rem .8rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); flex-wrap: wrap; }
.item__text { margin: 0; font-size: .8125rem; }
.item__meta { margin: .25rem 0 0; font-size: .7rem; color: var(--color-text-secondary); display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.item__actions { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
/* The queue. A row per banner: when, what, and what to do about it. The
   date column is fixed so the running order scans vertically. */
.queue { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .15rem; }
.queue__item {
  display: grid;
  grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) auto;
  gap: .25rem 1rem;
  align-items: start;
  padding: .7rem 0;
  border-top: 1px solid var(--color-border);
}
.queue__item:first-child { border-top: 0; }
.queue__when { display: flex; flex-direction: column; gap: .25rem; align-items: flex-start; min-width: 0; }
.queue__dates { font-size: .8125rem; color: var(--color-text-secondary); }
.queue__body { min-width: 0; }
.queue__text { margin: 0; font-size: .9375rem; line-height: 1.45; overflow-wrap: anywhere; }
.queue__warn { margin: .35rem 0 0; font-size: .8125rem; line-height: 1.5; color: #8a5a1f; }
.queue__actions { display: flex; gap: .75rem; align-items: center; flex-shrink: 0; }

@media (max-width: 640px) {
  /* One column, so nothing has to share a 390px row with two buttons. */
  .queue__item { grid-template-columns: minmax(0, 1fr); gap: .4rem; }
  .queue__when { flex-direction: row; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .queue__actions { justify-content: flex-start; }
}

.pill { font-size: .65rem; font-weight: 600; padding: .1rem .45rem; border-radius: 999px; }
.pill--live { color: #14532d; background: color-mix(in srgb, #14532d 12%, transparent); }
.pill--scheduled { color: #1f4f8a; background: color-mix(in srgb, #1f4f8a 12%, transparent); }
.pill--expired, .pill--off { color: var(--color-text-secondary); background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent); }
.warn { font-size: .75rem; color: #8a1f1f; font-weight: 600; }

.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .4rem .9rem; font-size: .8125rem; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }
.linkish:disabled { opacity: .5; cursor: not-allowed; }
.linkish--danger { color: #8a1f1f; }
</style>
