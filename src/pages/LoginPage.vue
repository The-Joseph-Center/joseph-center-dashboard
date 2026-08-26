<script setup lang="ts">
import { onMounted } from 'vue';
import { oktaAuth } from '@/lib/okta';
import config from '@/config/dashboard';

// Sends the user straight to Okta. Rendered only for the moment it takes to
// redirect, so it stays deliberately plain — but it is a real route, which
// means an unauthenticated deep link lands somewhere sensible instead of
// bouncing mid-navigation.
onMounted(() => {
  oktaAuth.signInWithRedirect({ originalUri: sessionStorage.getItem('postLoginUri') || '/' });
});
</script>

<template>
  <main class="login">
    <h1>{{ config.clientName }}</h1>
    <p>Taking you to sign in…</p>
    <noscript><p>JavaScript is required to sign in.</p></noscript>
  </main>
</template>

<style scoped>
.login {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
}
h1 { font-size: 1.25rem; margin: 0; }
p  { margin: 0; opacity: 0.7; }
</style>
