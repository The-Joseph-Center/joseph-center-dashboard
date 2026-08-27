<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
}
interface NeedsCard {
  login: string; firstName: string; lastName: string; title: string; status: string;
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
const departments = ref<string[]>([]);
const loading = ref(true);
const error = ref('');
const savingId = ref<string | null>(null);
const savedId = ref<string | null>(null);
const photoFor = ref<Record<string, { base64: string; filename: string } | undefined>>({});

const incomplete = computed(() => cards.value.filter((c) => !c.title || !c.email));

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-staff');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    cards.value = d.cards; needsCard.value = d.needsCard; departments.value = d.departments;
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

const creating = ref<string | null>(null);
async function createFor(u: NeedsCard) {
  creating.value = u.login; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        // Pre-filled from Okta. Title is usually blank there — it is public copy,
        // written here rather than pulled from the directory.
        name: u.firstName || u.login,
        title: u.title,
        email: '',
        departments: ['unknown'],
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not create the card.';
  } finally {
    creating.value = null;
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
        <p class="block__hint">Creating a card pre-fills the name from the directory. Add a title, department and photo below once created.</p>
        <ul class="queue">
          <li v-for="u in needsCard" :key="u.login" class="queue__row">
            <span class="queue__who">
              <strong>{{ [u.firstName, u.lastName].filter(Boolean).join(' ') || u.login }}</strong>
              <span class="queue__login">{{ u.login }}</span>
              <span v-if="u.status !== 'ACTIVE'" class="queue__status">{{ u.status }}</span>
            </span>
            <button type="button" class="btn btn--sm" :disabled="creating === u.login" @click="createFor(u)">
              {{ creating === u.login ? 'Creating…' : 'Create card' }}
            </button>
          </li>
        </ul>
      </section>

      <!-- The roster -->
      <section class="widget block">
        <h2 class="block__title">Staff cards ({{ cards.length }})</h2>
        <div class="roster">
          <article v-for="card in cards" :key="card._id" class="row">
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
              <label class="f"><span>Title</span><input v-model="card.title" type="text" /></label>
              <fieldset class="f f--depts">
                <legend>Departments</legend>
                <label v-for="d in departments" :key="d" class="chk">
                  <input type="checkbox" :checked="card.departments?.includes(d)" @change="toggleDept(card, d)" />
                  <span>{{ LABELS[d] ?? d }}</span>
                </label>
              </fieldset>
              <div class="row__actions">
                <label class="chk">
                  <input type="checkbox" :checked="card.hidden === true" @change="card.hidden = ($event.target as HTMLInputElement).checked" />
                  <span>Hide from the website</span>
                </label>
                <button type="button" class="btn btn--sm" :disabled="savingId === card._id" @click="save(card)">
                  {{ savingId === card._id ? 'Saving…' : 'Save' }}
                </button>
                <span v-if="savedId === card._id" class="ok">Saved</span>
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
.queue__row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .6rem .75rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); }
.queue__who { display: flex; flex-direction: column; }
.queue__login { font-size: .75rem; color: var(--color-text-secondary); }
.queue__status { font-size: .7rem; color: #8a5a1f; }

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
