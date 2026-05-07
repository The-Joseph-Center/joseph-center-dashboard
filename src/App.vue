<script setup lang="ts">
import { RouterView } from 'vue-router';
import { watch } from 'vue';
import { useAuth0 } from '@auth0/auth0-vue';
import { useAuthStore } from '@/stores/useAuthStore';

const { user, isAuthenticated } = useAuth0();
const authStore = useAuthStore();

watch(
  [isAuthenticated, user],
  ([authed, u]) => {
    if (authed && u) {
      authStore.setUser({ name: u.name, email: u.email, picture: u.picture });
    }
  },
  { immediate: true }
);
</script>

<template>
  <RouterView />
</template>
