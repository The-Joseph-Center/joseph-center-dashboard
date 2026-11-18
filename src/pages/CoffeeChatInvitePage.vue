<script setup lang="ts">
/**
 * Invite someone to apply as a Coffee Chat guest.
 *
 * The preview is rendered by the Function, not here, and the same render is
 * what gets sent. That is deliberate: a preview assembled in the browser from
 * its own copy of the wording would be a second email that merely resembled
 * the real one, and the first time the two drifted nobody would know which was
 * on screen. What you see is the message.
 */
import { ref, computed, watch, onMounted } from 'vue';
import { Send, Mail, CheckCircle, AlertTriangle, History } from 'lucide-vue-next';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

const name = ref('');
const email = ref('');

const subject = ref('');
const html = ref('');
const applyUrl = ref('');
const senderName = ref('');
const senderTitle = ref<string | null>(null);
const unlinked = ref(false);

const previewing = ref(false);
const sending = ref(false);
const error = ref('');
const sentTo = ref('');
const recorded = ref(true);

interface Invite {
  id: string;
  name: string;
  email: string;
  sentBy: string;
  sentAt: number;
}

const invites = ref<Invite[]>([]);
const historyUnavailable = ref(false);

async function loadInvites() {
  try {
    const res = await apiFetch('/.netlify/functions/coffee-chat-invite');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    invites.value = data.invites ?? [];
    historyUnavailable.value = data.unavailable === true;
  } catch {
    // The tool works without its history; a failure here stays quiet.
  }
}

onMounted(loadInvites);

/** The most recent invitation already sent to the address being typed. */
const priorInvite = computed(() => {
  const addr = email.value.trim().toLowerCase();
  if (!addr) return null;
  return invites.value.find((i) => i.email.toLowerCase() === addr) ?? null;
});

const fmtWhen = (epoch: number) =>
  new Date(epoch * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailLooksRight = computed(() => EMAIL_RE.test(email.value.trim()));
const canSend = computed(
  () => !!name.value.trim() && emailLooksRight.value && !!html.value && !sending.value,
);

async function loadPreview() {
  if (!name.value.trim()) {
    html.value = '';
    return;
  }
  previewing.value = true;
  error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/coffee-chat-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value, mode: 'preview' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Preview failed (${res.status})`);
    subject.value = data.subject;
    html.value = data.html;
    applyUrl.value = data.applyUrl;
    senderName.value = data.senderName;
    senderTitle.value = data.senderTitle ?? null;
    unlinked.value = data.unlinked === true;
  } catch (err) {
    html.value = '';
    error.value = err instanceof Error ? err.message : 'Could not build the preview.';
  } finally {
    previewing.value = false;
  }
}

// Typing a name shouldn't fire a request per keystroke.
let timer: ReturnType<typeof setTimeout> | undefined;
watch(name, () => {
  clearTimeout(timer);
  timer = setTimeout(loadPreview, 350);
});

// Deliberately NOT pre-filled with a placeholder greeting. Seeding the field
// with something like "Friend" would render a preview immediately, but it also
// means a forgotten field sends a real guest an invitation addressed "Hi
// Friend," — worse than the two seconds it takes to type a name and watch the
// preview appear.

async function send() {
  if (!canSend.value) return;
  sending.value = true;
  error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/coffee-chat-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value, email: email.value, mode: 'send' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`);
    sentTo.value = data.to;
    recorded.value = data.recorded !== false;
    await loadInvites();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not send the invitation.';
  } finally {
    sending.value = false;
  }
}

function again() {
  sentTo.value = '';
  name.value = '';
  email.value = '';
  html.value = '';
}
</script>

<template>
  <DashboardLayout page-title="Coffee Chat invitation">
    <div class="invite">
      <!-- Sent -->
      <div v-if="sentTo" class="invite__sent">
        <CheckCircle :size="44" class="invite__sent-icon" />
        <h2 class="invite__sent-title">Invitation sent</h2>
        <p class="invite__sent-text">
          It went to <strong>{{ sentTo }}</strong>. Replies come back to you, not to a shared
          inbox. When they fill the application in, it appears on the
          <RouterLink to="/submissions" class="invite__link">Submissions</RouterLink> page, where
          you can work out filming times from the days they picked.
        </p>
        <p v-if="!recorded" class="invite__note invite__note--warn">
          The email went, but it could not be added to the sent list — so it will not show as
          already invited. Worth noting somewhere.
        </p>
        <button class="invite__reset" @click="again">Invite someone else</button>
      </div>

      <template v-else>
        <p class="invite__intro">
          Sends one person a short, personal invitation to apply as a guest. The email does not
          propose a time — the application asks which days and times suit them, and the times come
          from their answers.
        </p>

        <div class="invite__grid">
          <!-- Compose -->
          <section class="invite__compose">
            <div class="invite__field">
              <label class="invite__label" for="inv-name">Name</label>
              <input
                id="inv-name"
                v-model="name"
                type="text"
                class="invite__input"
                maxlength="120"
                placeholder="Jane"
              />
              <p class="invite__note">
                Used exactly as typed, in “Hi {{ name.trim() || '…' }},”. Type just a first name if
                that is what you want it to say.
              </p>
            </div>

            <div class="invite__field">
              <label class="invite__label" for="inv-email">Email address</label>
              <input
                id="inv-email"
                v-model="email"
                type="email"
                class="invite__input"
                autocomplete="off"
                placeholder="jane@example.org"
              />
              <p v-if="email && !emailLooksRight" class="invite__note invite__note--warn">
                That address does not look right yet.
              </p>
              <p v-else-if="priorInvite" class="invite__warn invite__warn--prior">
                <AlertTriangle :size="15" />
                <span>
                  Already invited <strong>{{ fmtWhen(priorInvite.sentAt) }}</strong> as
                  “{{ priorInvite.name }}”, by {{ priorInvite.sentBy }}. Sending again is fine if
                  this is a follow-up.
                </span>
              </p>
            </div>

            <dl class="invite__meta">
              <div><dt>Subject</dt><dd>{{ subject || '—' }}</dd></div>
              <div><dt>Signed</dt><dd>{{ senderName || '—' }}<span v-if="senderTitle">, {{ senderTitle }}</span></dd></div>
              <div><dt>Replies to</dt><dd>You</dd></div>
              <div><dt>Button goes to</dt><dd class="invite__url">{{ applyUrl || '—' }}</dd></div>
            </dl>

            <p v-if="unlinked" class="invite__warn">
              <AlertTriangle :size="15" />
              You have no staff card, so the signature falls back to your email address. Make a
              card on the Staff page and it will sign with your name and title.
            </p>

            <p v-if="error" class="invite__error">{{ error }}</p>

            <button class="invite__send" :disabled="!canSend" @click="send">
              <Send :size="16" />
              {{ sending ? 'Sending…' : 'Send the invitation' }}
            </button>
            <p v-if="!canSend && !sending" class="invite__note">
              Needs a name and a valid email address.
            </p>
          </section>

          <!-- Preview -->
          <section class="invite__preview">
            <h2 class="invite__preview-title">
              <Mail :size="15" />
              Exactly what they receive
            </h2>
            <div v-if="previewing && !html" class="invite__preview-state">Building…</div>
            <div v-else-if="!html" class="invite__preview-state">
              Add a name to see the email.
            </div>
            <iframe
              v-else
              class="invite__frame"
              title="Email preview"
              sandbox=""
              :srcdoc="html"
            />
          </section>
        </div>

        <section class="invite__history">
          <h2 class="invite__history-title">
            <History :size="15" />
            Sent invitations
          </h2>

          <p v-if="historyUnavailable" class="invite__note invite__note--warn">
            The invitation history is unavailable — migration 021 may not be applied yet.
            Sending still works; it just will not be recorded.
          </p>
          <p v-else-if="!invites.length" class="invite__note">
            Nothing sent yet. Invitations you send from here will be listed, so you can see who
            has already been asked.
          </p>
          <table v-else class="invite__table">
            <thead>
              <tr><th>Sent</th><th>Name used</th><th>Address</th><th>By</th></tr>
            </thead>
            <tbody>
              <tr v-for="i in invites" :key="i.id">
                <td class="invite__when">{{ fmtWhen(i.sentAt) }}</td>
                <td>{{ i.name }}</td>
                <td class="invite__addr">{{ i.email }}</td>
                <td class="invite__addr">{{ i.sentBy }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.invite__intro {
  max-width: 68ch;
  color: var(--color-text-muted, #5c5c5c);
  font-size: 0.9375rem;
  line-height: 1.65;
  margin: 0 0 1.5rem;
}

.invite__grid {
  display: grid;
  grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
  gap: 1.75rem;
  align-items: start;
}

.invite__field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 1.25rem;
}

.invite__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text, #262626);
}

.invite__input {
  padding: 0.5rem 0.625rem;
  border: 1px solid var(--color-border, #ddd6c6);
  border-radius: 0.375rem;
  font: inherit;
  font-size: 0.9375rem;
  background: var(--color-surface, #fff);
  color: var(--color-text, #262626);
  min-width: 0;
}

.invite__note {
  font-size: 0.75rem;
  color: var(--color-text-muted, #5c5c5c);
  line-height: 1.5;
  margin: 0;
}

.invite__note--warn { color: #8a5a1f; }

.invite__meta {
  margin: 0 0 1rem;
  padding: 0.75rem 0.875rem;
  background: var(--color-bg-subtle, #f7f5ee);
  border: 1px solid var(--color-border, #e7e1d3);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
}

.invite__meta > div {
  display: flex;
  gap: 0.5rem;
  padding: 0.1875rem 0;
  min-width: 0;
}

.invite__meta dt { color: var(--color-text-muted, #5c5c5c); flex: 0 0 8.5rem; }
.invite__meta dd { margin: 0; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.invite__url { font-weight: 400; font-size: 0.75rem; }

.invite__warn {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  padding: 0.625rem 0.75rem;
  background: #fbf4dc;
  border-left: 3px solid #caa230;
  border-radius: 0.25rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  margin: 0 0 1rem;
}

.invite__error {
  padding: 0.625rem 0.75rem;
  background: #fff4f4;
  border: 1px solid #f5c2c2;
  color: #8a1f1f;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  margin: 0 0 1rem;
}

.invite__send {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.375rem;
  background: var(--color-primary, #1b4d4a);
  color: #fff;
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 0.5rem;
}

.invite__send:disabled { opacity: 0.5; cursor: not-allowed; }

.invite__preview-title {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted, #5c5c5c);
  margin: 0 0 0.625rem;
}

.invite__frame {
  width: 100%;
  height: 620px;
  border: 1px solid var(--color-border, #e7e1d3);
  border-radius: 0.5rem;
  background: #f7f5ee;
}

.invite__preview-state {
  padding: 3rem 1rem;
  text-align: center;
  color: var(--color-text-muted, #5c5c5c);
  font-style: italic;
  font-size: 0.875rem;
  border: 1px dashed var(--color-border, #ddd6c6);
  border-radius: 0.5rem;
}

.invite__sent { max-width: 48ch; padding: 2rem 0; }
.invite__sent-icon { color: var(--color-primary, #1b4d4a); }
.invite__sent-title { font-size: 1.25rem; margin: 0.75rem 0 0.5rem; }
.invite__sent-text { color: var(--color-text-muted, #5c5c5c); line-height: 1.65; margin: 0 0 1.5rem; }
.invite__link { color: var(--color-primary, #1b4d4a); }

.invite__reset {
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border, #ddd6c6);
  border-radius: 0.375rem;
  background: var(--color-surface, #fff);
  font: inherit;
  font-size: 0.9375rem;
  cursor: pointer;
}

.invite__warn--prior { margin: 0; }

.invite__history { margin-top: 2.5rem; }

.invite__history-title {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted, #5c5c5c);
  margin: 0 0 0.75rem;
}

.invite__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.invite__table th {
  text-align: left;
  font-weight: 600;
  color: var(--color-text-muted, #5c5c5c);
  padding: 0.375rem 0.75rem 0.375rem 0;
  border-bottom: 1px solid var(--color-border, #e7e1d3);
  white-space: nowrap;
}

.invite__table td {
  padding: 0.5rem 0.75rem 0.5rem 0;
  border-bottom: 1px solid var(--color-border-subtle, #f0ece0);
  min-width: 0;
  overflow-wrap: anywhere;
}

.invite__when { white-space: nowrap; color: var(--color-text-muted, #5c5c5c); }
.invite__addr { font-size: 0.75rem; }

@media (max-width: 900px) {
  .invite__grid { grid-template-columns: minmax(0, 1fr); }
  .invite__frame { height: 460px; }
}
</style>
