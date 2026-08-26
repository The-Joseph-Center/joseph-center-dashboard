<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { apiFetch } from '@/lib/api';
import QuotePicker from '@/components/QuotePicker.vue';

// The signed-in user's own staff card, styled as a dashboard widget so it sits
// alongside Links and Analytics rather than looking like a page that wandered in.
//
// Name, title, department and contact email are read-only: they are the
// organisation's record of a role, and admins change them. The quote is the one
// field the person owns, and even that is a request rather than a save.

interface Card {
  _id: string; name?: string; title?: string; email?: string;
  quote?: string; departments?: string[]; hidden?: boolean; imageUrl?: string | null;
}

// The overview hides this entirely for anyone with no linked card — being met
// by an apology at every sign-in is worse than the card simply not being there.
const props = withDefaults(defineProps<{ hideWhenUnlinked?: boolean }>(), {
  hideWhenUnlinked: false,
});

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
    // The card is deliberately NOT updated locally. Nothing has changed on the
    // website yet, and showing it as though it had sets the wrong expectation.
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
  <div
    v-if="!(props.hideWhenUnlinked && !loading && (!linked || !card))"
    class="widget"
  >
    <p v-if="loading" class="widget__state">Loading…</p>
    <p v-else-if="loadError" class="widget__state widget__state--err">{{ loadError }}</p>

    <div v-else-if="!linked || !card" class="widget__state">
      <p><strong>No staff card is linked to your account yet.</strong></p>
      <p>It will appear here automatically once your details are on the website.</p>
    </div>

    <template v-else>
      <!-- Identity. The person's name is the heading; a separate title above it
           would only repeat what the card already shows. -->
      <div class="who">
        <img
          v-if="card.imageUrl"
          :src="`${card.imageUrl}?w=160&h=160&fit=crop&auto=format`"
          :alt="card.name || 'Staff photo'"
          class="who__photo"
        />
        <div class="who__text">
          <p class="who__name">{{ card.name || '—' }}</p>
          <p class="who__meta">
            {{ card.title || 'No title set' }}
            <template v-if="card.departments?.length">
              · {{ card.departments.map(label).join(', ') }}
            </template>
          </p>
          <p v-if="card.email" class="who__email">{{ card.email }}</p>
          <p v-if="card.hidden" class="who__hidden">Hidden from the website</p>
        </div>
      </div>

      <p class="note">
        Something wrong above?
        <RouterLink to="/support" class="note__link">Ask an administrator</RouterLink>.
      </p>

      <!-- Quote -->
      <div class="quote">
        <label class="quote__label" for="my-quote">My quote</label>
        <p v-if="card.quote" class="quote__current">Currently live: “{{ card.quote }}”</p>
        <textarea
          id="my-quote" v-model="quote" rows="2" maxlength="400"
          class="quote__input" placeholder="Add a quote, or leave blank for none"
        ></textarea>

        <div class="quote__row">
          <button type="button" class="quote__submit" :disabled="saving" @click="submit">
            {{ saving ? 'Sending…' : 'Submit for review' }}
          </button>
          <span v-if="submitted" class="quote__msg">Sent — your card is unchanged until it's approved.</span>
          <span v-else-if="unchanged" class="quote__msg">That's already your quote.</span>
          <span v-else-if="saveError" class="quote__msg quote__msg--err" role="alert">{{ saveError }}</span>
          <span v-else class="quote__msg quote__msg--muted">Reviewed before it appears.</span>
        </div>

        <!-- Collapsed by default. Most people arrive knowing what they want; the
             picker is for the ones who do not. -->
        <details class="help">
          <summary class="help__summary">Need help choosing?</summary>
          <QuotePicker
            @use="(q) => { quote = `${q.text} — ${q.attribution}`; submitted = false; unchanged = false; }"
          />
        </details>
      </div>
    </template>
  </div>
</template>

<style scoped>
.widget {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 1.25rem;
}

.widget__state { font-size: 0.875rem; color: var(--color-text-secondary); }
.widget__state--err { color: #8a1f1f; }
.widget__state p { margin: 0 0 0.35rem; }

/* Identity */
.who { display: flex; gap: 0.9rem; align-items: center; }
.who__photo {
  width: 56px; height: 56px; border-radius: 50%;
  object-fit: cover; flex-shrink: 0;
  border: 1px solid var(--color-border);
}
.who__text { min-width: 0; }
.who__name {
  font-family: var(--font-heading);
  font-size: 1rem; font-weight: 600;
  color: var(--color-text); margin: 0;
}
.who__meta { font-size: 0.8125rem; color: var(--color-text-secondary); margin: 0.1rem 0 0; }
.who__email { font-size: 0.75rem; color: var(--color-text-secondary); margin: 0.15rem 0 0; opacity: 0.85; }
.who__hidden { font-size: 0.75rem; color: #8a5a1f; margin: 0.25rem 0 0; }

.note {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
  margin: 0.85rem 0 0;
}
.note__link {
  color: var(--color-primary-strong);
  font-weight: 600;
  /* Was 0.75rem inside an 0.8-opacity paragraph — small and washed out. */
  font-size: 0.8125rem;
  text-decoration: underline;
}

/* Quote */
.quote {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}
.quote__label {
  display: block;
  font-family: var(--font-heading);
  font-size: 0.8125rem; font-weight: 600;
  color: var(--color-text); margin-bottom: 0.35rem;
}
.quote__current {
  font-size: 0.75rem; color: var(--color-text-secondary);
  margin: 0 0 0.4rem; font-style: italic;
}
.quote__input {
  width: 100%; padding: 0.5rem 0.6rem;
  font: inherit; font-size: 0.8125rem;
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  resize: vertical;
}
.quote__row {
  display: flex; align-items: center; gap: 0.6rem;
  margin-top: 0.5rem; flex-wrap: wrap;
}
.quote__submit {
  background: var(--color-primary-strong);
  color: var(--color-text-inverse, #fff);
  border: 0; padding: 0.4rem 0.9rem;
  border-radius: var(--border-radius);
  font-size: 0.8125rem; font-weight: 600; cursor: pointer;
}
.quote__submit:disabled { opacity: 0.6; cursor: not-allowed; }
.quote__msg { font-size: 0.75rem; color: var(--color-primary-strong); }
.quote__msg--muted { color: var(--color-text-secondary); opacity: 0.8; }
.quote__msg--err { color: #8a1f1f; }

/* Picker, collapsed */
.help { margin-top: 0.85rem; }
.help__summary {
  cursor: pointer;
  font-size: 0.8125rem;
  color: var(--color-primary-strong);
  font-weight: 600;
}
.help__summary::marker { color: var(--color-text-secondary); }
</style>
