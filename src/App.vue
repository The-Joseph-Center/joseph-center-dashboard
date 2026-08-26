<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useAuthStore } from '@/stores/useAuthStore';

const authStore = useAuthStore();

// Populate the store from the Okta session once at startup, so components can
// read identity and group membership without each awaiting the SDK.
onMounted(authStore.refresh);
</script>

<template>
  <RouterView />
</template>
