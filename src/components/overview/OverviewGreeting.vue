<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/useAuthStore';
import type { Capability } from '@/lib/capabilities';

/**
 * Who is here, and the two or three things they are most likely to have come
 * to do.
 *
 * The actions are drawn from what this person can actually reach, so nobody is
 * shown a door they cannot open — the front desk gets the inbox, the social
 * media team gets the newsletter, and only the people who write for the site
 * get the blog.
 */
const auth = useAuthStore();

const firstName = computed(() => {
  const name = auth.displayName.trim();
  // displayName falls back to the email address; a greeting by email address
  // is worse than no name at all.
  return name.includes('@') ? '' : (name.split(' ')[0] ?? '');
});

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
});

const today = computed(() =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
);

interface Action { label: string; to: string; capability?: Capability }

const ACTIONS: Action[] = [
  { label: 'Read the inbox', to: '/submissions', capability: 'submissions' },
  { label: 'Write the newsletter', to: '/newsletter', capability: 'newsletter' },
  { label: 'Write a post', to: '/blog', capability: 'content' },
  { label: 'Open or close a form', to: '/forms', capability: 'formsAdmin' },
  { label: 'Write the letters', to: '/letters', capability: 'letterQueue' },
];

const actions = computed(() =>
  ACTIONS.filter((a) => !a.capability || auth.can(a.capability)).slice(0, 3)
);
</script>

<template>
  <header class="greet">
    <div>
      <h2 class="greet__hello">{{ greeting }}<template v-if="firstName">, {{ firstName }}</template></h2>
      <p class="greet__sub">{{ today }}</p>
    </div>
    <nav v-if="actions.length" class="greet__actions" aria-label="Quick actions">
      <RouterLink v-for="a in actions" :key="a.to" :to="a.to" class="greet__action">{{ a.label }}</RouterLink>
      <a class="greet__action greet__action--out" href="https://josephcentergj.com" target="_blank" rel="noopener">
        View the website<span class="sr-only"> (opens in a new tab)</span>
      </a>
    </nav>
  </header>
</template>

<style scoped>
.greet {
  display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between;
  gap: .5rem 1.5rem; margin-bottom: 1rem;
}
.greet__hello { font-family: var(--font-heading); font-size: 1.35rem; margin: 0; }
.greet__sub { margin: .15rem 0 0; font-size: .8125rem; color: var(--color-text-secondary); }
.greet__actions { display: flex; flex-wrap: wrap; gap: .4rem; }
.greet__action {
  font-size: .8125rem; font-weight: 600; padding: .35rem .8rem; border-radius: 999px;
  border: 1px solid var(--color-border); color: var(--color-text); text-decoration: none;
  background: var(--color-surface);
}
.greet__action:hover { border-color: var(--color-primary); color: var(--color-primary-strong); }
.greet__action--out { color: var(--color-text-secondary); }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
</style>
