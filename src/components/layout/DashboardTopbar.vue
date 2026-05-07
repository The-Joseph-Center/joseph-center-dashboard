<!-- CANONICAL SOURCE — matches Build Tools dashboard preview
     To update: edit this file AND the corresponding section in
     build-tools/src/views/PreviewDashboardView.vue
     Do not edit the copy in pws-dashboard-template — it will be overwritten at scaffold time -->
<script setup lang="ts">
import { computed } from 'vue';
import { Menu } from 'lucide-vue-next';

defineProps<{ pageTitle: string }>();
const emit = defineEmits<{ (e: 'toggle-mobile'): void }>();

const today = computed(() =>
  new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
);
</script>

<template>
  <header class="topbar">
    <!-- Mobile hamburger -->
    <button class="topbar__hamburger" @click="emit('toggle-mobile')">
      <Menu :size="20" />
    </button>

    <h1 class="topbar__title">{{ pageTitle }}</h1>
    <span class="topbar__date">{{ today }}</span>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface);
  flex-shrink: 0;
}

@media (min-width: 640px) {
  .topbar {
    padding: 0.75rem 1.5rem;
  }
}

.topbar__hamburger {
  display: flex;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text-secondary, var(--color-text));
  padding: 0.125rem;
  margin-left: -0.25rem;
  margin-right: 0.25rem;
}

.topbar__hamburger:hover {
  color: var(--color-text);
}

@media (min-width: 640px) {
  .topbar__hamburger {
    display: none;
  }
}

.topbar__title {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--color-text);
}

@media (min-width: 640px) {
  .topbar__title {
    font-size: 1rem;
  }
}

.topbar__date {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--color-text-secondary, var(--color-text));
  display: none;
}

@media (min-width: 640px) {
  .topbar__date {
    display: block;
  }
}
</style>
