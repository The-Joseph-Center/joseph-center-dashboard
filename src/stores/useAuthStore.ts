import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<{ name?: string; email?: string; picture?: string } | null>(null);
  const isAuthenticated = ref(false);

  const displayName = computed(() => user.value?.name || user.value?.email || 'User');

  function setUser(authUser: typeof user.value) {
    user.value = authUser;
    isAuthenticated.value = !!authUser;
  }

  function clearUser() {
    user.value = null;
    isAuthenticated.value = false;
  }

  return { user, isAuthenticated, displayName, setUser, clearUser };
});
