<script setup lang="ts">
import { computed } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import AnalyticsWidget from '@/components/widgets/AnalyticsWidget.vue';
import TutorialsWidget from '@/components/widgets/TutorialsWidget.vue';
import LinksWidget from '@/components/widgets/LinksWidget.vue';
import MyStaffCard from '@/components/MyStaffCard.vue';
import config from '@/config/dashboard';

const widgetMap: Record<string, unknown> = {
  siteAnalytics: AnalyticsWidget,
  tutorials: TutorialsWidget,
  links: LinksWidget,
};

const activeWidgets = computed(() =>
  config.enabledWidgets
    .filter((w) => w in widgetMap)
    .map((w) => ({ key: w, component: widgetMap[w]! }))
);
</script>

<template>
  <DashboardLayout page-title="Dashboard">
    <!-- The thing a staff member actually came to do sits above the widgets.
         Hidden entirely for anyone with no linked card. -->
    <MyStaffCard class="dashboard-card" hide-when-unlinked heading="My staff card" />

    <div class="dashboard-grid">
      <component
        v-for="widget in activeWidgets"
        :is="widget.component"
        :key="widget.key"
      />
    </div>
  </DashboardLayout>
</template>

<style scoped>
.dashboard-card {
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.25rem;
}
</style>
