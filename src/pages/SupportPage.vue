<script setup lang="ts">
import { ref } from 'vue';
import { useAuth0 } from '@auth0/auth0-vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { Send, CheckCircle } from 'lucide-vue-next';
import config from '@/config/dashboard';

const { user } = useAuth0();

const form = ref({
  name: user.value?.name || '',
  email: user.value?.email || config.clientEmail || '',
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
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

async function submit() {
  if (!form.value.subject.trim() || !form.value.message.trim()) return;

  sending.value = true;
  error.value = null;

  const payload = {
    ...form.value,
    clientName: config.clientName,
    clientDomain: config.clientDomain,
    timestamp: new Date().toISOString(),
  };

  try {
    // Primary: Netlify function
    const res = await fetch('/.netlify/functions/receive-support-request', {
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
  <DashboardLayout page-title="Contact & Support">
    <div class="support">
      <!-- Success state -->
      <div v-if="sent" class="support__success">
        <CheckCircle :size="48" class="support__success-icon" />
        <h2 class="support__success-title">Request Submitted</h2>
        <p class="support__success-text">
          We've received your message and will get back to you within 1 business day.
        </p>
        <button class="support__reset" @click="sent = false; form.subject = ''; form.message = '';">
          Submit Another Request
        </button>
      </div>

      <!-- Form -->
      <form v-else class="support__form" @submit.prevent="submit">
        <p class="support__intro">
          Need help with your website? Describe your request below and we'll get back to you as soon as possible.
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

        <div class="support__field">
          <label class="support__label">Subject *</label>
          <input v-model="form.subject" type="text" class="support__input" placeholder="Brief summary of your request" required />
        </div>

        <div class="support__field">
          <label class="support__label">Message *</label>
          <textarea v-model="form.message" class="support__textarea" rows="6" placeholder="Describe what you need help with in detail" required></textarea>
        </div>

        <p v-if="error" class="support__error">{{ error }}</p>

        <button type="submit" class="support__submit" :disabled="sending">
          <Send :size="16" />
          {{ sending ? 'Sending...' : 'Send Request' }}
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
