<!-- CANONICAL SOURCE — matches Build Tools dashboard preview
     To update: edit this file AND the corresponding section in
     build-tools/src/views/PreviewDashboardView.vue
     Do not edit the copy in pws-dashboard-template — it will be overwritten at scaffold time -->
<script setup lang="ts">
import { ref } from 'vue';
import DashboardSidebar from './DashboardSidebar.vue';
import DashboardTopbar from './DashboardTopbar.vue';

defineProps<{ pageTitle: string }>();

const mobileOpen = ref(false);
</script>

<template>
  <div class="dashboard" :class="{ 'dashboard--mobile-open': mobileOpen }">
    <!-- Mobile backdrop -->
    <div
      v-if="mobileOpen"
      class="dashboard__backdrop"
      @click="mobileOpen = false"
    />

    <DashboardSidebar
      :mobile-open="mobileOpen"
      @toggle-mobile="mobileOpen = !mobileOpen"
    />

    <div class="dashboard__main">
      <DashboardTopbar
        :page-title="pageTitle"
        @toggle-mobile="mobileOpen = !mobileOpen"
      />

      <main class="dashboard__content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  height: 100dvh;
  overflow: hidden;
  background-color: var(--color-bg);
}

.dashboard__backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 30;
}

@media (min-width: 640px) {
  .dashboard__backdrop {
    display: none;
  }
}

.dashboard__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.dashboard__content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

@media (min-width: 640px) {
  .dashboard__content {
    padding: 1.5rem;
  }
}

@media (min-width: 1024px) {
  .dashboard__content {
    padding: 2rem;
  }
}
</style>
