<script setup lang="ts">
import { ADMIN_GROUP } from '@/lib/okta';
</script>

<template>
  <main class="forbidden">
    <h1>Not available to your account</h1>
    <p>
      This area is limited to dashboard administrators. If you think you should
      have access, ask to be added to the
      <code>{{ ADMIN_GROUP }}</code> group.
    </p>
    <RouterLink to="/">← Back to the dashboard</RouterLink>
  </main>
</template>

<style scoped>
.forbidden {
  max-width: 32rem;
  margin: 4rem auto;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
h1 { font-size: 1.25rem; margin: 0; }
p  { margin: 0; opacity: 0.75; line-height: 1.6; }
code { background: rgba(0,0,0,.06); padding: 0.1rem 0.35rem; border-radius: 0.25rem; }
</style>
