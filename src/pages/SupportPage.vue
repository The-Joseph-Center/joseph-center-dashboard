<script setup lang="ts">
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';
import { computed, ref } from 'vue';
import { CAPABILITY_LABELS, requestableCapabilities, type Capability } from '@/lib/capabilities';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { Send, CheckCircle } from 'lucide-vue-next';
import config from '@/config/dashboard';

const auth = useAuthStore();

const form = ref({
  name: auth.displayName,
  email: auth.email || config.clientEmail || '',
  subject: '',
  category: 'question',
  message: '',
});

const sending = ref(false);
const sent = ref(false);
const error = ref<string | null>(null);

const CATEGORIES = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'update', label: 'Update Request' },
  { value: 'access', label: 'Request Access' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

/**
 * Request Access.
 *
 * The grid offers only what this person cannot already reach, computed from
 * the same capability table the dashboard enforces — so it can never offer
 * something they already have, and the list stays right when a rule changes
 * without anyone remembering to update this page.
 *
 * A nav that simply hides what you may not open is honest but silent: there is
 * no way to tell a tool you have not been given from a tool that does not
 * exist. This is the missing half of that — the hidden thing is nameable, and
 * asking for it takes a tick rather than knowing who to email.
 */
const requestable = computed(() =>
  requestableCapabilities(auth.groups).map((c) => ({ value: c, label: CAPABILITY_LABELS[c] })),
);
const requested = ref<Capability[]>([]);
const isAccess = computed(() => form.value.category === 'access');

function toggleRequested(c: Capability) {
  const i = requested.value.indexOf(c);
  if (i === -1) requested.value.push(c);
  else requested.value.splice(i, 1);
}

// An access request is complete once something is ticked; the subject and the
// explanation are both optional, because the grid already says what is wanted.
const canSubmit = computed(() =>
  isAccess.value
    ? requested.value.length > 0
    : !!form.value.subject.trim() && !!form.value.message.trim(),
);

async function submit() {
  if (!canSubmit.value) return;

  sending.value = true;
  error.value = null;

  const payload = {
    ...form.value,
    requested: isAccess.value ? requested.value : undefined,
    clientName: config.clientName,
    clientDomain: config.clientDomain,
    timestamp: new Date().toISOString(),
  };

  try {
    // Primary: Netlify function
    const res = await apiFetch('/.netlify/functions/receive-support-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);

    // Optional: webhook notification (Slack, email, etc.)
    const webhookUrl = import.meta.env.VITE_SUPPORT_WEBHOOK_URL;
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {}); // fire-and-forget
    }

    sent.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <DashboardLayout page-title="Support">
    <div class="support">
      <!-- Success state -->
      <div v-if="sent" class="support__success">
        <CheckCircle :size="48" class="support__success-icon" />
        <h2 class="support__success-title">Request Submitted</h2>
        <p class="support__success-text">
          {{ isAccess
            ? "Your access request has been sent. You'll be added to the right group, or told why not — either way you'll hear back."
            : "We've received your message and will get back to you within 1 business day." }}
        </p>
        <button class="support__reset" @click="sent = false; form.subject = ''; form.message = ''; requested = [];">
          Submit Another Request
        </button>
      </div>

      <!-- Form -->
      <form v-else class="support__form" @submit.prevent="submit">
        <p class="support__intro">
          {{ isAccess
            ? 'Tick what you need to get to. The request goes to the Director of Technology with the groups that grant it, so it can be turned on without any back-and-forth.'
            : "Need help with your website? Describe your request below and we'll get back to you as soon as possible." }}
        </p>

        <div class="support__field">
          <label class="support__label">Name</label>
          <input v-model="form.name" type="text" class="support__input" />
        </div>

        <div class="support__field">
          <label class="support__label">Email</label>
          <input v-model="form.email" type="email" class="support__input" />
        </div>

        <div class="support__field">
          <label class="support__label">Category</label>
          <select v-model="form.category" class="support__select">
            <option v-for="cat in CATEGORIES" :key="cat.value" :value="cat.value">
              {{ cat.label }}
            </option>
          </select>
        </div>

        <!--
          Only shown for an access request, and only ever listing what this
          person cannot already reach.
        -->
        <fieldset v-if="isAccess" class="support__field grid">
          <legend class="support__label">What do you need access to? *</legend>
          <p v-if="!requestable.length" class="grid__none">
            You already have every feature the dashboard can grant. If something still
            isn't working, pick another category above and describe it.
          </p>
          <div v-else class="grid__items">
            <label
              v-for="c in requestable"
              :key="c.value"
              class="grid__item"
              :class="{ 'grid__item--on': requested.includes(c.value) }"
            >
              <input
                type="checkbox"
                :checked="requested.includes(c.value)"
                @change="toggleRequested(c.value)"
              />
              <span>{{ c.label }}</span>
            </label>
          </div>
        </fieldset>

        <div v-if="!isAccess" class="support__field">
          <label class="support__label">Subject *</label>
          <input v-model="form.subject" type="text" class="support__input" placeholder="Brief summary of your request" required />
        </div>

        <div class="support__field">
          <label class="support__label">{{ isAccess ? 'Anything else?' : 'Message *' }}</label>
          <textarea
            v-model="form.message"
            class="support__textarea"
            :rows="isAccess ? 3 : 6"
            :placeholder="isAccess
              ? 'Optional — what you are trying to do, if it helps'
              : 'Describe what you need help with in detail'"
            :required="!isAccess"
          ></textarea>
        </div>

        <p v-if="error" class="support__error">{{ error }}</p>

        <button type="submit" class="support__submit" :disabled="sending || !canSubmit">
          <Send :size="16" />
          {{ sending ? 'Sending...' : isAccess ? 'Request access' : 'Send Request' }}
        </button>
      </form>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.support {
  max-width: 560px;
}

.support__intro {
  font-size: 0.9375rem;
  color: var(--color-text-secondary, var(--color-text));
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.support__form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.support__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.support__label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text);
}

.grid {
  border: 0;
  padding: 0;
  margin: 0;
}

.grid__items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.grid__item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  font-size: 0.875rem;
  line-height: 1.35;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.grid__item:hover {
  border-color: var(--color-text-secondary, var(--color-text));
}

.grid__item--on {
  border-color: #1D5F55;
  background-color: rgba(29, 95, 85, 0.06);
}

.grid__item input {
  margin: 0.15rem 0 0;
  flex-shrink: 0;
}

.grid__none {
  margin: 0.5rem 0 0;
  font-size: 0.875rem;
  color: var(--color-text-secondary, var(--color-text));
  line-height: 1.5;
}

.support__submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.support__input,
.support__select,
.support__textarea {
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  background-color: var(--color-bg);
  color: var(--color-text);
  font-size: 0.875rem;
  font-family: var(--font-body);
  transition: border-color 0.15s ease;
}

.support__input:focus,
.support__select:focus,
.support__textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.support__textarea {
  resize: vertical;
  min-height: 6rem;
}

.support__select {
  cursor: pointer;
}

.support__error {
  font-size: 0.8125rem;
  color: var(--color-danger, #dc2626);
}

.support__submit {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.5rem;
  background-color: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: 0.875rem;
  font-weight: 600;
  border: none;
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: opacity 0.15s ease;
  align-self: flex-start;
}

.support__submit:hover:not(:disabled) {
  opacity: 0.9;
}

.support__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.support__success {
  text-align: center;
  padding: 3rem 1rem;
}

.support__success-icon {
  color: var(--color-primary);
  margin: 0 auto 1rem;
}

.support__success-title {
  font-family: var(--font-heading);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text);
  margin-bottom: 0.5rem;
}

.support__success-text {
  font-size: 0.9375rem;
  color: var(--color-text-secondary, var(--color-text));
  margin-bottom: 1.5rem;
}

.support__reset {
  padding: 0.5rem 1.25rem;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.support__reset:hover {
  background-color: var(--color-surface);
}
</style>
