<script setup lang="ts">
import { computed } from 'vue';
import { ExternalLink } from 'lucide-vue-next';
import config from '@/config/dashboard';

// Pills (no description) render compact; cards (with description) render expanded.
const pills = computed(() => config.links.filter(l => !l.description));
const cards = computed(() => config.links.filter(l => !!l.description));
</script>

<template>
  <div class="widget" v-if="config.links.length">
    <h2 class="widget__title"><ExternalLink :size="18" /> Links</h2>

    <!-- Compact pills (no description) -->
    <div v-if="pills.length" class="widget__pills">
      <a
        v-for="link in pills"
        :key="link.url"
        :href="link.url"
        target="_blank"
        rel="noopener"
        class="widget__pill"
      >
        <span v-if="link.emoji" class="widget__pill-emoji">{{ link.emoji }}</span>
        {{ link.label }}
      </a>
    </div>

    <!-- Resource cards (with description) -->
    <ul v-if="cards.length" class="widget__cards">
      <li v-for="link in cards" :key="link.url">
        <a :href="link.url" target="_blank" rel="noopener" class="widget__card">
          <span v-if="link.emoji" class="widget__card-emoji">{{ link.emoji }}</span>
          <span class="widget__card-body">
            <span class="widget__card-label">{{ link.label }}</span>
            <span class="widget__card-desc">{{ link.description }}</span>
          </span>
        </a>
      </li>
    </ul>
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

.widget__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.widget__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  background-color: var(--color-primary);
  color: var(--color-text-inverse, #fff);
  font-size: 0.8125rem;
  font-weight: 500;
  text-decoration: none;
  transition: opacity 0.15s ease;
}

.widget__pill:hover {
  opacity: 0.9;
}

.widget__pill-emoji {
  font-size: 0.9rem;
  line-height: 1;
}

.widget__cards {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.widget__card {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  text-decoration: none;
  transition: border-color 0.15s ease;
}

.widget__card:hover {
  border-color: var(--color-primary);
}

.widget__card-emoji {
  font-size: 1.25rem;
  line-height: 1;
  flex-shrink: 0;
}

.widget__card-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.widget__card-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-primary);
}

.widget__card-desc {
  font-size: 0.8125rem;
  color: var(--color-text-secondary, var(--color-text));
}
</style>
