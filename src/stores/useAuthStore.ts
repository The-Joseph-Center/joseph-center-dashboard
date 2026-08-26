import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { oktaAuth, groupsFromClaims, ADMIN_GROUP } from '@/lib/okta';

export const useAuthStore = defineStore('auth', () => {
  const claims = ref<Record<string, unknown> | null>(null);
  const isAuthenticated = ref(false);
  const ready = ref(false);

  const displayName = computed(
    () => (claims.value?.name as string) || (claims.value?.email as string) || 'User'
  );
  const email = computed(() => (claims.value?.email as string) || '');
  const groups = computed(() => groupsFromClaims(claims.value ?? undefined));
  // Mirrors the server-side check in netlify/functions/_lib/verify-okta.ts.
  // This one only decides what to render; the Functions decide what is allowed.
  const isAdmin = computed(() => groups.value.includes(ADMIN_GROUP));

  async function refresh() {
    try {
      isAuthenticated.value = await oktaAuth.isAuthenticated();
      claims.value = isAuthenticated.value
        ? ((await oktaAuth.getUser()) as unknown as Record<string, unknown>)
        : null;
    } catch {
      isAuthenticated.value = false;
      claims.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function signOut() {
    await oktaAuth.signOut();
    claims.value = null;
    isAuthenticated.value = false;
  }

  return { claims, isAuthenticated, ready, displayName, email, groups, isAdmin, refresh, signOut };
});
