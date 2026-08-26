<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from '@/stores/useAuthStore';
import { ADMIN_GROUP } from '@/lib/okta';

// Development-only. Okta's Token Preview lives inside API Access Management,
// which this tenant does not have, so there is no way to inspect a token in the
// admin console — this is how we confirm the groups claim is actually being
// emitted. Excluded from the production build; see the route definition.
const auth = useAuthStore();
onMounted(auth.refresh);
</script>

<template>
  <main class="whoami">
    <h1>Signed-in identity</h1>
    <p class="note">Development view — not present in the production build.</p>

    <dl>
      <dt>Authenticated</dt><dd>{{ auth.isAuthenticated }}</dd>
      <dt>Name</dt><dd>{{ auth.displayName }}</dd>
      <dt>Email</dt><dd>{{ auth.email || '—' }}</dd>
      <dt>Groups claim</dt>
      <dd>
        <span v-if="auth.groups.length">{{ auth.groups.join(', ') }}</span>
        <em v-else>absent or empty — the Okta claim is not reaching the token</em>
      </dd>
      <dt>Admin ({{ ADMIN_GROUP }})</dt>
      <dd><strong>{{ auth.isAdmin }}</strong></dd>
    </dl>

    <h2>Raw claims</h2>
    <pre>{{ JSON.stringify(auth.claims, null, 2) }}</pre>
  </main>
</template>

<style scoped>
.whoami { max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
h2 { font-size: .9rem; margin: 1.5rem 0 .5rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
.note { margin: 0 0 1.5rem; opacity: .7; font-size: .85rem; }
dl { display: grid; grid-template-columns: 12rem 1fr; gap: .5rem 1rem; margin: 0; }
dt { font-weight: 600; }
dd { margin: 0; }
em { opacity: .7; }
pre { background: rgba(0,0,0,.05); padding: 1rem; border-radius: .4rem; overflow-x: auto; font-size: .8rem; }
</style>
