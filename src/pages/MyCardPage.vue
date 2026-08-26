<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch } from '@/lib/api';
import QuotePicker from '@/components/QuotePicker.vue';

// A staff member's own card. Name, title, department and email are shown but
// not editable — those are the organisation's record of the role, and admins
// change them. The quote is the one field the person owns.

interface Card {
  _id: string; name?: string; title?: string; email?: string;
  quote?: string; departments?: string[]; hidden?: boolean; imageUrl?: string | null;
}

const card = ref<Card | null>(null);
const linked = ref(true);
const loading = ref(true);
const loadError = ref('');

const quote = ref('');
const saving = ref(false);
const submitted = ref(false);
const unchanged = ref(false);
const saveError = ref('');

const DEPT_LABELS: Record<string, string> = {
  'day-shelter': 'Day Shelter', 'family-center': 'Family Center',
  'golden-girls': 'Golden Girls Project', ifs: 'Integrated Financial Services',
  'it-marketing': 'IT & Marketing', kitchen: 'Kitchen & Food Services',
  maintenance: 'Maintenance', security: 'Security', operations: 'Operations',
  unknown: 'Not yet assigned',
};
const label = (d: string) => DEPT_LABELS[d] ?? d;

onMounted(async () => {
  try {
    const res = await apiFetch('/.netlify/functions/get-my-staff-card');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    linked.value = data.linked;
    card.value = data.card;
    quote.value = data.card?.quote ?? '';
  } catch {
    loadError.value = 'Could not load your staff card.';
  } finally {
    loading.value = false;
  }
});

async function submit() {
  saving.value = true; submitted.value = false; unchanged.value = false; saveError.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/request-quote-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote: quote.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || String(res.status));
    // The card is NOT updated locally: nothing has changed on the site yet, and
    // showing it as though it had would set exactly the wrong expectation.
    if (data.submitted) submitted.value = true;
    else unchanged.value = true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Could not submit your request.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="mycard">
    <h1>My staff card</h1>

    <p v-if="loading" class="state">Loading…</p>
    <p v-else-if="loadError" class="state state--err">{{ loadError }}</p>

    <!-- Legitimate state: staff without a card, and cards without an account. -->
    <div v-else-if="!linked || !card" class="state state--empty">
      <p><strong>No staff card is linked to your account yet.</strong></p>
      <p>
        Once your details are on the website, your card will appear here
        automatically. Nothing for you to do.
      </p>
    </div>

    <template v-else>
      <section class="details">
        <img v-if="card.imageUrl" :src="`${card.imageUrl}?w=200&h=200&fit=crop&auto=format`" :alt="card.name || 'Staff photo'" class="details__photo" />
        <div class="details__fields">
          <dl>
            <dt>Name</dt><dd>{{ card.name || '—' }}</dd>
            <dt>Title</dt><dd>{{ card.title || '—' }}</dd>
            <dt>Department</dt>
            <dd>{{ card.departments?.length ? card.departments.map(label).join(', ') : '—' }}</dd>
            <dt>Contact email</dt><dd>{{ card.email || '—' }}</dd>
            <dt>Current quote</dt>
            <dd>{{ card.quote || '— none yet —' }}</dd>
          </dl>
          <p class="details__note">
            These are how you appear on the website. To correct anything here,
            ask an administrator — you can change your quote below yourself.
          </p>
          <p v-if="card.hidden" class="details__hidden">
            Your card is currently hidden from the website.
          </p>
        </div>
      </section>

      <section class="quote">
        <h2>My favourite quote</h2>
        <p class="quote__hint">
          Quotes are reviewed before they appear. Submitting sends your choice to
          the team — your card won't change until it's approved, and you'll see
          your current quote here until then. Submit an empty box to ask for
          yours to be removed.
        </p>
        <textarea v-model="quote" rows="3" maxlength="400" class="quote__input" placeholder="Pick one below, or write your own"></textarea>
        <div class="quote__row">
          <button type="button" class="quote__save" :disabled="saving" @click="submit">
            {{ saving ? 'Sending…' : 'Submit for review' }}
          </button>
          <span v-if="submitted" class="quote__ok">Sent for review — your card is unchanged for now.</span>
          <span v-if="unchanged" class="quote__ok">That's already your current quote.</span>
          <span v-if="saveError" class="quote__err" role="alert">{{ saveError }}</span>
        </div>

        <QuotePicker @use="(q) => { quote = `${q.text} — ${q.attribution}`; submitted = false; unchanged = false; }" />
      </section>
    </template>
  </main>
</template>

<style scoped>
.mycard { max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.35rem; margin: 0 0 1.5rem; }
h2 { font-size: 1rem; margin: 0 0 .25rem; }
.state { opacity: .75; }
.state--err { color: #8a1f1f; }
.state--empty { border: 1px solid rgba(0,0,0,.12); border-radius: .5rem; padding: 1.25rem; }
.state--empty p { margin: 0 0 .5rem; }
.details { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; }
.details__photo { width: 110px; height: 110px; object-fit: cover; border-radius: .5rem; }
.details__fields { flex: 1; min-width: 16rem; }
dl { display: grid; grid-template-columns: 9rem 1fr; gap: .4rem 1rem; margin: 0; }
dt { font-weight: 600; opacity: .75; font-size: .85rem; }
dd { margin: 0; font-size: .9rem; }
.details__note { margin: 1rem 0 0; font-size: .8rem; opacity: .7; line-height: 1.5; }
.details__hidden { margin: .5rem 0 0; font-size: .8rem; color: #8a5a1f; }
.quote { margin-top: 2.5rem; border-top: 1px solid rgba(0,0,0,.1); padding-top: 1.5rem; }
.quote__hint { margin: 0 0 .75rem; font-size: .85rem; opacity: .7; }
.quote__input { width: 100%; padding: .6rem .75rem; font: inherit; font-size: .9rem; border: 1px solid rgba(0,0,0,.18); border-radius: .4rem; resize: vertical; }
.quote__row { display: flex; align-items: center; gap: .75rem; margin-top: .6rem; }
.quote__save { background: var(--accent, #1D5F55); color: #fff; border: 0; padding: .5rem 1.1rem; border-radius: .4rem; font-weight: 600; cursor: pointer; }
.quote__save:disabled { opacity: .6; cursor: not-allowed; }
.quote__ok { font-size: .85rem; color: #1D5F55; }
.quote__err { font-size: .85rem; color: #8a1f1f; }
</style>
