<script setup lang="ts">
import { FileEdit } from 'lucide-vue-next';
import config from '@/config/dashboard';
</script>

<template>
  <div class="widget">
    <h2 class="widget__title"><FileEdit :size="18" /> Content Editors</h2>
    <div v-if="config.contentEditors.length" class="widget__editors">
      <div v-for="editor in config.contentEditors" :key="editor.documentType" class="widget__editor">
        <div class="widget__editor-name">{{ editor.label }}</div>
        <div class="widget__editor-meta">
          <span class="widget__editor-type">{{ editor.documentType }}</span>
          <span v-if="editor.description">{{ editor.description }}</span>
        </div>
      </div>
    </div>
    <p v-else class="widget__empty">No content editors configured.</p>
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

.widget__editors {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.widget__editor {
  padding: 0.75rem;
  background-color: var(--color-bg);
  border-radius: var(--border-radius);
}

.widget__editor-name {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--color-text);
}

.widget__editor-meta {
  font-size: 0.75rem;
  color: var(--color-text-secondary, var(--color-text));
  display: flex;
  gap: 0.75rem;
  margin-top: 0.25rem;
}

.widget__editor-type {
  background-color: var(--color-border);
  padding: 0.125rem 0.5rem;
  border-radius: var(--border-radius);
  font-family: monospace;
}

.widget__empty {
  font-size: 0.875rem;
  color: var(--color-text-secondary, var(--color-text));
}
</style>
