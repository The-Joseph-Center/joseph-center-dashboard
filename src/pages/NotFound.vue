<script setup lang="ts">
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
</script>

<template>
  <DashboardLayout page-title="Not Found">
    <div class="not-found">
      <h2>404</h2>
      <p>This page doesn't exist.</p>
      <RouterLink to="/">Back to Dashboard</RouterLink>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.not-found {
  text-align: center;
  padding: 4rem 1.5rem;
}

.not-found h2 {
  font-size: 4rem;
  color: var(--color-primary);
  margin-bottom: 0.5rem;
}

.not-found p {
  color: var(--color-text-secondary, var(--color-text));
  margin-bottom: 1.5rem;
}
</style>
