<script setup lang="ts">
import { computed } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import AnalyticsWidget from '@/components/widgets/AnalyticsWidget.vue';
import TutorialsWidget from '@/components/widgets/TutorialsWidget.vue';
import LinksWidget from '@/components/widgets/LinksWidget.vue';
import ContentEditorWidget from '@/components/widgets/ContentEditorWidget.vue';
import config from '@/config/dashboard';

const widgetMap: Record<string, unknown> = {
  siteAnalytics: AnalyticsWidget,
  tutorials: TutorialsWidget,
  links: LinksWidget,
  contentEditors: ContentEditorWidget,
};

const activeWidgets = computed(() =>
  config.enabledWidgets
    .filter((w) => w in widgetMap)
    .map((w) => ({ key: w, component: widgetMap[w]! }))
);
</script>

<template>
  <DashboardLayout page-title="Dashboard">
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
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.25rem;
}
</style>
