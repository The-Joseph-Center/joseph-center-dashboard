<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

// Editing the public staff page. Okta owns identity, access and employment
// status; everything here is the copy that appears on the website, plus the
// photo — which Okta cannot store, and which is the reason this tool exists
// rather than letting the directory feed the site directly.
//
// Quote is deliberately not editable here: staff own theirs, through the review
// flow on their own card.

interface Card {
  _id: string; name?: string; title?: string; email?: string;
  departments?: string[]; hidden?: boolean; imageUrl?: string | null;
  linkedLogin?: string | null;
}
interface NeedsCard {
  login: string; firstName: string; lastName: string; title: string; status: string;
  duplicateOf: string[];
}
interface NotStaff {
  login: string; name: string; reason: string; note: string; by: string; at: number;
}

const LABELS: Record<string, string> = {
  'day-shelter': 'Day Shelter', 'family-center': 'Family Center',
  'golden-girls': 'Golden Girls Project', ifs: 'Integrated Financial Services',
  'it-marketing': 'IT & Marketing', kitchen: 'Kitchen & Food Services',
  maintenance: 'Maintenance', security: 'Security', operations: 'Operations',
  unknown: 'Unknown / Needs Review',
};

const cards = ref<Card[]>([]);
const needsCard = ref<NeedsCard[]>([]);
const notStaff = ref<NotStaff[]>([]);
const serviceAccounts = ref<string[]>([]);
const reasons = ref<Record<string, string>>({});
const departments = ref<string[]>([]);
const loading = ref(true);
const error = ref('');
const savingId = ref<string | null>(null);
const savedId = ref<string | null>(null);
const photoFor = ref<Record<string, { base64: string; filename: string } | undefined>>({});

const incomplete = computed(() => cards.value.filter((c) => !c.title || !c.email));

// Cards nobody owns yet — the placeholders, and anyone whose public email was
// never set so the nightly matcher could not resolve them.
const unlinkedCards = computed(() => cards.value.filter((c) => !c.linkedLogin));

// ── Finding a card ──
// One text box across name, title, email and department label, plus a
// department picker — searching for "kitchen" should find the same people
// whether it is typed or picked. The visibility filter is here because the
// hidden cards are the ones you go looking for deliberately, and they are
// otherwise mixed in with 26 others.
const search = ref('');
const deptFilter = ref('');
const visibility = ref<'all' | 'visible' | 'hidden' | 'unlinked' | 'incomplete'>('all');

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return cards.value.filter((c) => {
    if (deptFilter.value && !(c.departments ?? []).includes(deptFilter.value)) return false;
    if (visibility.value === 'visible' && c.hidden === true) return false;
    if (visibility.value === 'hidden' && c.hidden !== true) return false;
    if (visibility.value === 'unlinked' && c.linkedLogin) return false;
    if (visibility.value === 'incomplete' && c.title && c.email) return false;
    if (!q) return true;
    // Department matches on the label people actually read, not the slug —
    // "Golden Girls" finds golden-girls.
    const haystack = [
      c.name, c.title, c.email, c.linkedLogin,
      ...(c.departments ?? []).map((d) => LABELS[d] ?? d),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
  });
});

const filtering = computed(() => !!search.value.trim() || !!deptFilter.value || visibility.value !== 'all');
function clearFilters() {
  search.value = ''; deptFilter.value = ''; visibility.value = 'all';
}
const cardLabel = (c: Card) =>
  [c.name || '(no name)', c.title].filter(Boolean).join(' — ');

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-staff');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    cards.value = d.cards; needsCard.value = d.needsCard; departments.value = d.departments;
    notStaff.value = d.notStaff ?? []; serviceAccounts.value = d.serviceAccounts ?? [];
    reasons.value = d.reasons ?? {};
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load the staff list.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function toggleDept(card: Card, value: string) {
  const list = card.departments ?? (card.departments = []);
  const i = list.indexOf(value);
  if (i === -1) list.push(value); else list.splice(i, 1);
}

function pickPhoto(id: string, e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    photoFor.value = { ...photoFor.value, [id]: { base64: String(reader.result), filename: file.name } };
  };
  reader.readAsDataURL(file);
}

async function save(card: Card) {
  savingId.value = card._id; savedId.value = null; error.value = '';
  try {
    const photo = photoFor.value[card._id];
    const res = await apiFetch('/.netlify/functions/admin-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _id: card._id, name: card.name, title: card.title, email: card.email,
        departments: card.departments ?? [], hidden: card.hidden ?? false,
        imageBase64: photo?.base64, imageFilename: photo?.filename,
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    savedId.value = card._id;
    photoFor.value = { ...photoFor.value, [card._id]: undefined };
    if (photo) await load();  // pull the new image URL back
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    savingId.value = null;
  }
}

// ── Not a staff card ──
// A note field rather than reason-only, because the two cases behave
// differently: a scanner is settled forever, while a suspected duplicate is a
// reminder that something still needs sorting out in Okta. Both belong off the
// onboarding queue; only one of them is finished.
const dismissing = ref<string | null>(null);
const dismissForm = ref<{ reason: string; note: string }>({ reason: 'shared-inbox', note: '' });
const busy = ref<string | null>(null);

function openDismiss(u: NeedsCard) {
  dismissing.value = u.login;
  dismissForm.value = { reason: u.duplicateOf.length ? 'duplicate' : 'shared-inbox', note: '' };
}

async function post(payload: Record<string, unknown>, login: string) {
  busy.value = login; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    dismissing.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
  } finally {
    busy.value = null;
  }
}

const confirmDismiss = (login: string) =>
  post({ action: 'dismiss', login, ...dismissForm.value }, login);
const restore = (login: string) => post({ action: 'restore', login }, login);

const when = (secs: number) =>
  new Date(secs * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const creating = ref<string | null>(null);
// The card just created, so the page can take you to it. Without this the
// roster reloads at the top of the page and the new card is somewhere below the
// fold — it reads as nothing having happened, and the button gets pressed again.
const justCreated = ref<string | null>(null);

async function revealCard(id: string) {
  // A filter that hides the new card would leave nothing to scroll to, which is
  // the same dead end this function exists to fix.
  clearFilters();
  await nextTick();
  const el = document.getElementById(`card-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  justCreated.value = id;
  // Focus the title, since that is the field the directory could not fill in.
  el.querySelector<HTMLInputElement>('[data-field="title"]')?.focus({ preventScroll: true });
  window.setTimeout(() => { if (justCreated.value === id) justCreated.value = null; }, 4000);
}

async function createFor(u: NeedsCard) {
  creating.value = u.login; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        // The login links the new card to the Okta account straight away, so the
        // row leaves the queue on this click rather than at the next nightly run.
        login: u.login,
        // Pre-filled from Okta. Title is usually blank there — it is public copy,
        // written here rather than pulled from the directory.
        name: u.firstName || u.login,
        title: u.title,
        email: '',
        departments: ['unknown'],
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const { id, alreadyLinked } = await res.json();
    // Drop the row before the reload lands, so it cannot be clicked twice.
    needsCard.value = needsCard.value.filter((n) => n.login !== u.login);
    if (alreadyLinked) error.value = `${u.firstName || u.login} already has a card — taking you to it.`;
    await load();
    if (id) await revealCard(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not create the card.';
  } finally {
    creating.value = null;
  }
}

// ── Linking an account to a card that already exists ──
// Separate from "create" because the placeholder cards are real documents
// waiting for a name. Creating another would leave the placeholder behind.
const linking = ref<string | null>(null);
const linkTarget = ref('');
function openLink(u: NeedsCard) {
  linking.value = u.login;
  linkTarget.value = unlinkedCards.value[0]?._id ?? '';
}
async function confirmLink(u: NeedsCard) {
  if (!linkTarget.value) return;
  const id = linkTarget.value;
  await post({ action: 'link', login: u.login, _id: id }, u.login);
  linking.value = null;
  await revealCard(id);
}
const unlink = (card: Card) => post({ action: 'unlink', _id: card._id }, card._id);

// ── Removing a card ──
// Two clicks, because it cannot be undone. Hiding is the right tool for someone
// who has left; this is for a card that should never have existed.
const confirmingDelete = ref<string | null>(null);
async function removeCard(card: Card) {
  savingId.value = card._id; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', _id: card._id }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    confirmingDelete.value = null;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not remove the card.';
  } finally {
    savingId.value = null;
  }
}
</script>

<template>
  <DashboardLayout page-title="Staff">
    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="error" class="state state--err" role="alert">{{ error }}</p>

    <template v-else>
      <div class="intro widget">
        <p class="intro__text">
          These details appear on the public staff page. Access and employment
          status come from Okta and are not edited here; the photo can only be
          set here, because Okta cannot store one.
        </p>
        <p v-if="incomplete.length" class="intro__todo">
          {{ incomplete.length }} card{{ incomplete.length === 1 ? '' : 's' }} still missing a title or email.
        </p>
      </div>

      <!-- Onboarding queue -->
      <section v-if="needsCard.length" class="widget block">
        <h2 class="block__title">In Okta, no staff card yet ({{ needsCard.length }})</h2>
        <p class="block__hint">
          Creating a card pre-fills the name from the directory. Add a title, department and photo below once created.
          Shared inboxes in Okta's <strong>Service Accounts</strong> group are left out of this list automatically.
        </p>
        <ul class="queue">
          <li v-for="u in needsCard" :key="u.login" class="queue__item">
            <div class="queue__row">
              <span class="queue__who">
                <strong>{{ [u.firstName, u.lastName].filter(Boolean).join(' ') || u.login }}</strong>
                <span class="queue__login">{{ u.login }}</span>
                <span v-if="u.status !== 'ACTIVE'" class="queue__status">{{ u.status }}</span>
              </span>
              <span class="queue__buttons">
                <button type="button" class="btn btn--sm" :disabled="creating === u.login" @click="createFor(u)">
                  {{ creating === u.login ? 'Creating…' : 'Create card' }}
                </button>
                <button
                  v-if="unlinkedCards.length"
                  type="button"
                  class="btn btn--outline btn--sm"
                  @click="openLink(u)"
                >
                  Link to a card
                </button>
                <button type="button" class="linkish" @click="openDismiss(u)">Not a staff card</button>
              </span>
            </div>

            <p v-for="(hint, i) in u.duplicateOf" :key="i" class="queue__dupe">
              Possible duplicate — {{ hint }}
            </p>

            <div v-if="linking === u.login" class="dismiss">
              <label class="f dismiss__wide">
                <span>Which card is {{ u.firstName || u.login }}?</span>
                <select v-model="linkTarget">
                  <option v-for="c in unlinkedCards" :key="c._id" :value="c._id">{{ cardLabel(c) }}</option>
                </select>
              </label>
              <div class="dismiss__actions">
                <button type="button" class="btn btn--sm" :disabled="busy === u.login" @click="confirmLink(u)">
                  {{ busy === u.login ? 'Linking…' : 'Link' }}
                </button>
                <button type="button" class="linkish" @click="linking = null">Cancel</button>
              </div>
            </div>

            <div v-if="dismissing === u.login" class="dismiss">
              <label class="f">
                <span>Reason</span>
                <select v-model="dismissForm.reason">
                  <option v-for="(label, key) in reasons" :key="key" :value="key">{{ label }}</option>
                </select>
              </label>
              <label class="f">
                <span>Note (optional)</span>
                <input v-model="dismissForm.note" type="text" placeholder="e.g. sends scans from the copier" />
              </label>
              <div class="dismiss__actions">
                <button type="button" class="btn btn--sm" :disabled="busy === u.login" @click="confirmDismiss(u.login)">
                  {{ busy === u.login ? 'Saving…' : 'Confirm' }}
                </button>
                <button type="button" class="linkish" @click="dismissing = null">Cancel</button>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <!-- Marked as never needing a card -->
      <details v-if="notStaff.length || serviceAccounts.length" class="widget block fold">
        <summary class="fold__summary">
          Not staff cards ({{ notStaff.length + serviceAccounts.length }})
        </summary>
        <p class="block__hint fold__hint">
          Left out of the queue above and out of the daily reconciliation email. Nothing here is deleted from Okta.
        </p>
        <ul class="queue">
          <li v-for="d in notStaff" :key="d.login" class="queue__row">
            <span class="queue__who">
              <strong>{{ d.name || d.login }}</strong>
              <span class="queue__login">{{ d.login }}</span>
              <span class="queue__meta">
                {{ reasons[d.reason] ?? d.reason }}<template v-if="d.note"> — {{ d.note }}</template>
                · {{ d.by }}, {{ when(d.at) }}
              </span>
            </span>
            <button type="button" class="linkish" :disabled="busy === d.login" @click="restore(d.login)">
              {{ busy === d.login ? 'Restoring…' : 'Put back' }}
            </button>
          </li>
          <li v-for="l in serviceAccounts" :key="l" class="queue__row">
            <span class="queue__who">
              <strong>{{ l }}</strong>
              <span class="queue__meta">Okta “Service Accounts” group — change it there</span>
            </span>
          </li>
        </ul>
      </details>

      <!-- The roster -->
      <section class="widget block">
        <h2 class="block__title">
          Staff cards
          <span v-if="filtering">({{ filtered.length }} of {{ cards.length }})</span>
          <span v-else>({{ cards.length }})</span>
        </h2>

        <div class="find">
          <input
            v-model="search"
            type="search"
            class="find__q"
            placeholder="Search name, title, email or department…"
            aria-label="Search staff cards"
          />
          <select v-model="deptFilter" aria-label="Filter by department">
            <option value="">All departments</option>
            <option v-for="d in departments" :key="d" :value="d">{{ LABELS[d] ?? d }}</option>
          </select>
          <select v-model="visibility" aria-label="Filter by status">
            <option value="all">Everyone</option>
            <option value="visible">On the website</option>
            <option value="hidden">Hidden</option>
            <option value="unlinked">No Okta account</option>
            <option value="incomplete">Missing title or email</option>
          </select>
          <button v-if="filtering" type="button" class="linkish" @click="clearFilters">Clear</button>
        </div>

        <p v-if="filtering && !filtered.length" class="block__hint find__empty">
          No cards match. <button type="button" class="linkish" @click="clearFilters">Clear the filters</button>
        </p>

        <div class="roster">
          <article
            v-for="card in filtered"
            :key="card._id"
            :id="`card-${card._id}`"
            class="row"
            :class="{ 'row--new': justCreated === card._id }"
          >
            <div class="row__photo">
              <img v-if="card.imageUrl" :src="`${card.imageUrl}?w=120&h=120&fit=crop&auto=format`" :alt="card.name || ''" />
              <div v-else class="row__nophoto">No photo</div>
              <label class="row__upload">
                {{ photoFor[card._id] ? 'Photo ready' : 'Choose photo' }}
                <input type="file" accept="image/*" @change="pickPhoto(card._id, $event)" />
              </label>
            </div>

            <div class="row__fields">
              <div class="grid2">
                <label class="f"><span>Name</span><input v-model="card.name" type="text" /></label>
                <label class="f"><span>Public email</span><input v-model="card.email" type="email" placeholder="optional" /></label>
              </div>
              <label class="f"><span>Title</span><input v-model="card.title" type="text" data-field="title" /></label>
              <fieldset class="f f--depts">
                <legend>Departments</legend>
                <label v-for="d in departments" :key="d" class="chk">
                  <input type="checkbox" :checked="card.departments?.includes(d)" @change="toggleDept(card, d)" />
                  <span>{{ LABELS[d] ?? d }}</span>
                </label>
              </fieldset>
              <p class="row__link">
                <template v-if="card.linkedLogin">
                  Signs in as {{ card.linkedLogin }}
                  <button type="button" class="linkish" :disabled="busy === card._id" @click="unlink(card)">Unlink</button>
                </template>
                <span v-else class="row__link--none">No Okta account linked — link one from the queue above.</span>
              </p>

              <div class="row__actions">
                <label class="chk">
                  <input type="checkbox" :checked="card.hidden === true" @change="card.hidden = ($event.target as HTMLInputElement).checked" />
                  <span>Hide from the website</span>
                </label>
                <button type="button" class="btn btn--sm" :disabled="savingId === card._id" @click="save(card)">
                  {{ savingId === card._id ? 'Saving…' : 'Save' }}
                </button>
                <span v-if="savedId === card._id" class="ok">Saved</span>

                <span class="row__remove">
                  <template v-if="confirmingDelete === card._id">
                    <span class="row__warn">Delete permanently?</span>
                    <button type="button" class="btn btn--danger btn--sm" :disabled="savingId === card._id" @click="removeCard(card)">
                      {{ savingId === card._id ? 'Removing…' : 'Yes, remove' }}
                    </button>
                    <button type="button" class="linkish" @click="confirmingDelete = null">Cancel</button>
                  </template>
                  <button v-else type="button" class="linkish linkish--danger" @click="confirmingDelete = card._id">
                    Remove card
                  </button>
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.widget { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1.25rem; }
.block { margin-bottom: 1.25rem; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .35rem; }
.block__hint { font-size: .8125rem; color: var(--color-text-secondary); margin: 0 0 1rem; }
.intro { margin-bottom: 1.25rem; }
.intro__text { margin: 0; font-size: .8125rem; color: var(--color-text-secondary); line-height: 1.6; }
.intro__todo { margin: .5rem 0 0; font-size: .8125rem; font-weight: 600; color: #8a5a1f; }
.state { color: var(--color-text-secondary); }
.state--err { color: #8a1f1f; }

.queue { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
.queue__item { padding: .6rem .75rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); }
.queue__item .queue__row { padding: 0; background: none; border: 0; border-radius: 0; }
.queue__buttons { display: flex; gap: .5rem; flex-shrink: 0; }
.queue__meta { font-size: .7rem; color: var(--color-text-secondary); }
.queue__dupe { margin: .45rem 0 0; font-size: .75rem; color: #8a5a1f; }
.dismiss { margin-top: .65rem; padding-top: .65rem; border-top: 1px solid var(--color-border); display: grid; grid-template-columns: minmax(0, 12rem) 1fr; gap: .6rem; align-items: end; }
.dismiss select, .dismiss input { width: 100%; padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.dismiss .f { margin-bottom: 0; }
.dismiss__actions { grid-column: 1 / -1; display: flex; gap: .5rem; }
@media (max-width: 640px) { .dismiss { grid-template-columns: 1fr; } }
.btn--ghost { background: none; color: var(--color-text-secondary); border: 1px solid var(--color-border); }
.btn--outline { background: none; color: var(--color-primary-strong); border: 1px solid var(--color-primary-strong); }
.btn--danger { background: #8a1f1f; }
/* Text controls, for actions that should not compete with Save. Red is kept for
   the one action that cannot be undone; Cancel is plain so the two never read
   as the same weight. */
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }
.linkish:disabled { opacity: .6; cursor: not-allowed; }
.linkish--danger { color: #8a1f1f; }
.linkish--danger:hover { color: #6d1818; }
.row__link { margin: 0 0 .5rem; font-size: .75rem; color: var(--color-text-secondary); display: flex; align-items: center; gap: .5rem; }
.row__link--none { color: #8a5a1f; }
.dismiss__wide { grid-column: 1 / -1; }
.row--new { outline: 2px solid var(--color-primary-strong); outline-offset: 2px; transition: outline-color 1s ease; }
.row__remove { margin-left: auto; display: flex; align-items: center; gap: .5rem; }
.row__warn { font-size: .75rem; color: #8a1f1f; font-weight: 600; }
.fold { padding: 0; }
.fold__summary { cursor: pointer; padding: 1rem 1.25rem; font-family: var(--font-heading); font-size: 1rem; list-style-position: inside; }
.fold[open] .fold__summary { padding-bottom: .35rem; }
.fold__hint { padding: 0 1.25rem; }
.fold .queue { padding: 0 1.25rem 1.25rem; }
.queue__row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .6rem .75rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); }
.queue__who { display: flex; flex-direction: column; }
.queue__login { font-size: .75rem; color: var(--color-text-secondary); }
.queue__status { font-size: .7rem; color: #8a5a1f; }

.find { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
.find__q { flex: 1 1 16rem; min-width: 0; }
.find input, .find select { padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.find__empty { margin: 0 0 1rem; }
.roster { display: grid; gap: 1rem; }
.row { display: flex; gap: 1rem; padding: 1rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); }
.row__photo { flex: 0 0 96px; display: flex; flex-direction: column; gap: .4rem; align-items: center; }
.row__photo img { width: 96px; height: 96px; object-fit: cover; border-radius: .4rem; }
.row__nophoto { width: 96px; height: 96px; border-radius: .4rem; background: var(--color-surface); border: 1px dashed var(--color-border); display: flex; align-items: center; justify-content: center; font-size: .7rem; color: var(--color-text-secondary); }
.row__upload { font-size: .7rem; color: var(--color-primary-strong); font-weight: 600; cursor: pointer; text-align: center; }
.row__upload input { display: none; }
.row__fields { flex: 1; min-width: 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } .row { flex-direction: column; } }
.f { display: block; margin-bottom: .6rem; }
.f > span, .f legend { display: block; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: .25rem; padding: 0; }
.f input[type='text'], .f input[type='email'] { width: 100%; padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.f--depts { border: none; padding: 0; margin-bottom: .6rem; }
.chk { display: inline-flex; align-items: center; gap: .3rem; font-size: .75rem; margin: 0 .7rem .25rem 0; cursor: pointer; }
.row__actions { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; margin-top: .35rem; }
.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .35rem .8rem; font-size: .8125rem; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.ok { font-size: .75rem; color: var(--color-primary-strong); }
</style>
