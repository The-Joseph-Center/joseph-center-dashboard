<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { BarChart3, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-vue-next';
import config from '@/config/dashboard';

const analytics = config.analytics;
const hasAnalytics = !!analytics?.provider;
const isSA = analytics?.provider === 'simple-analytics';

const loading = ref(false);
const visitors = ref(0);
const pageviews = ref(0);
const avgTime = ref(0);
const prevVisitors = ref(0);

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

function trendDir(): 'up' | 'down' | 'flat' {
  if (!prevVisitors.value) return visitors.value > 0 ? 'up' : 'flat';
  const change = ((visitors.value - prevVisitors.value) / prevVisitors.value) * 100;
  if (change > 5) return 'up';
  if (change < -5) return 'down';
  return 'flat';
}

async function fetchStats() {
  if (!isSA) return;
  loading.value = true;
  try {
    const hostname = analytics?.simpleAnalyticsId || config.clientDomain;
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(now); start.setDate(now.getDate() - 30);
    const prevStart = new Date(start); prevStart.setDate(start.getDate() - 30);
    const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1);

    const [curRes, prevRes] = await Promise.all([
      fetch(`/.netlify/functions/analytics-proxy?hostname=${hostname}&start=${fmt(start)}&end=${fmt(now)}`),
      fetch(`/.netlify/functions/analytics-proxy?hostname=${hostname}&start=${fmt(prevStart)}&end=${fmt(prevEnd)}`),
    ]);

    if (curRes.ok) {
      const data = await curRes.json();
      visitors.value = data.visitors ?? 0;
      pageviews.value = data.pageviews ?? 0;
      avgTime.value = data.seconds_on_page ?? 0;
    }
    if (prevRes.ok) {
      const data = await prevRes.json();
      prevVisitors.value = data.visitors ?? 0;
    }
  } catch {
    // Silently fail — widget is non-critical
  } finally {
    loading.value = false;
  }
}

onMounted(fetchStats);
</script>

<template>
  <div class="widget">
    <h2 class="widget__title"><BarChart3 :size="18" /> Site Analytics</h2>

    <div v-if="!hasAnalytics" class="widget__placeholder">
      <p>Analytics integration will be connected during setup.</p>
    </div>

    <div v-else-if="loading" class="widget__loading">
      <Loader2 :size="18" class="widget__spinner" />
      <span>Loading...</span>
    </div>

    <div v-else-if="isSA" class="widget__content">
      <div class="widget__stats">
        <div class="widget__pill">
          <span class="widget__pill-value">{{ visitors.toLocaleString() }}</span>
          <span class="widget__pill-label">visitors</span>
          <span
            class="widget__pill-trend"
            :class="{
              'widget__pill-trend--up': trendDir() === 'up',
              'widget__pill-trend--down': trendDir() === 'down',
            }"
          >
            <TrendingUp v-if="trendDir() === 'up'" :size="12" />
            <TrendingDown v-else-if="trendDir() === 'down'" :size="12" />
            <Minus v-else :size="12" />
          </span>
        </div>
        <div class="widget__pill">
          <span class="widget__pill-value">{{ pageviews.toLocaleString() }}</span>
          <span class="widget__pill-label">page views</span>
        </div>
        <div class="widget__pill">
          <span class="widget__pill-value">{{ formatDuration(avgTime) }}</span>
          <span class="widget__pill-label">avg. time</span>
        </div>
      </div>
      <RouterLink to="/analytics" class="widget__link">View full analytics &rarr;</RouterLink>
    </div>

    <div v-else class="widget__content">
      <p class="widget__provider">Google Analytics 4</p>
      <RouterLink to="/analytics" class="widget__link">View analytics &rarr;</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.widget {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 1.25rem;
}

.widget__title {
  font-size: 1rem;
  font-family: var(--font-heading);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  color: var(--color-text);
}

.widget__content {
  padding: 0.5rem 0;
}

.widget__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.widget__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.8125rem;
}

.widget__pill-value {
  font-weight: 600;
  color: var(--color-text);
}

.widget__pill-label {
  color: var(--color-text-secondary, var(--color-text));
}

.widget__pill-trend {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-secondary, var(--color-text));
}

.widget__pill-trend--up { color: #16a34a; }
.widget__pill-trend--down { color: #dc2626; }

.widget__provider {
  font-size: 0.875rem;
  color: var(--color-text-secondary, var(--color-text));
  margin-bottom: 0.75rem;
}

.widget__link {
  display: inline-block;
  color: var(--color-primary);
  font-size: 0.875rem;
  text-decoration: none;
}

.widget__link:hover {
  text-decoration: underline;
}

.widget__placeholder {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary, var(--color-text));
  font-size: 0.875rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--border-radius);
}

.widget__loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem;
  justify-content: center;
  color: var(--color-text-secondary, var(--color-text));
  font-size: 0.875rem;
}

.widget__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
