<script setup lang="ts">
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

// Helps staff choose a quote. The blank box is why nobody submits one, so this
// shows real options up front and makes taking one a single click.

interface Quote { text: string; attribution: string; source: 'famous' | 'scripture' }

const emit = defineEmits<{ (e: 'use', quote: Quote): void }>();

const source = ref<'famous' | 'scripture'>('famous');
const quotes = ref<Quote[]>([]);
const loading = ref(false);
const error = ref('');
const copied = ref<number | null>(null);

async function load(next: 'famous' | 'scripture' = source.value) {
  source.value = next;
  loading.value = true;
  error.value = '';
  try {
    // Six rather than eight: at two or three columns that is two rows, which
    // keeps the disclosure from dominating the card when it opens.
    const res = await apiFetch(`/.netlify/functions/quotes-proxy?source=${next}&count=6`);
    if (!res.ok) throw new Error(String(res.status));
    quotes.value = (await res.json()).quotes ?? [];
    if (!quotes.value.length) error.value = 'No quotes came back — try again in a moment.';
  } catch {
    error.value = 'Could not load quotes just now.';
  } finally {
    loading.value = false;
  }
}

async function copy(q: Quote, i: number) {
  try {
    await navigator.clipboard.writeText(`${q.text} — ${q.attribution}`);
    copied.value = i;
    setTimeout(() => { if (copied.value === i) copied.value = null; }, 1600);
  } catch {
    error.value = 'Copying is blocked in this browser — select the text instead.';
  }
}

load();
</script>

<template>
  <section class="picker">
    <header class="picker__head">
      <div class="picker__tabs" role="tablist">
        <button
          type="button" role="tab" :aria-selected="source === 'famous'"
          :class="['picker__tab', { 'picker__tab--on': source === 'famous' }]"
          @click="load('famous')"
        >Quotes</button>
        <button
          type="button" role="tab" :aria-selected="source === 'scripture'"
          :class="['picker__tab', { 'picker__tab--on': source === 'scripture' }]"
          @click="load('scripture')"
        >Scripture</button>
      </div>
      <button type="button" class="picker__more" :disabled="loading" @click="load()">
        {{ loading ? 'Loading…' : 'Show different ones' }}
      </button>
    </header>

    <p v-if="error" class="picker__error" role="alert">{{ error }}</p>

    <ul v-else class="picker__list">
      <li v-for="(q, i) in quotes" :key="`${source}-${i}`" class="picker__item">
        <blockquote class="picker__text">{{ q.text }}</blockquote>
        <p class="picker__attr">— {{ q.attribution }}</p>
        <div class="picker__actions">
          <button type="button" class="picker__use" @click="emit('use', q)">Use this</button>
          <button type="button" class="picker__copy" @click="copy(q, i)">
            {{ copied === i ? 'Copied' : 'Copy' }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.picker { margin-top: 2rem; }
.picker__head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
.picker__tabs { display: inline-flex; gap: .25rem; background: rgba(0,0,0,.05); padding: .2rem; border-radius: 999px; }
.picker__tab { border: 0; background: transparent; padding: .4rem 1rem; border-radius: 999px; font-size: .85rem; font-weight: 600; cursor: pointer; color: inherit; opacity: .7; }
.picker__tab--on { background: var(--surface, #fff); opacity: 1; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.picker__more { border: 1px solid rgba(0,0,0,.15); background: transparent; padding: .4rem .9rem; border-radius: .4rem; font-size: .8rem; cursor: pointer; color: inherit; }
.picker__more:disabled { opacity: .5; cursor: not-allowed; }
.picker__list {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: .75rem;
  /* Flows to two or three columns wherever there is room, so opening the
     disclosure costs a couple of rows rather than a screenful. Falls back to a
     single column on narrow screens, where vertical space is the cheap axis. */
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
}
.picker__item { display: flex; flex-direction: column; }
.picker__actions { margin-top: auto; }
.picker__item { border: 1px solid rgba(0,0,0,.1); border-radius: .5rem; padding: .9rem 1rem; }
.picker__text { margin: 0; font-size: .95rem; line-height: 1.55; }
.picker__attr { margin: .4rem 0 .65rem; font-size: .8rem; opacity: .7; }
.picker__actions { display: flex; gap: .5rem; }
.picker__use, .picker__copy { border-radius: .35rem; padding: .35rem .8rem; font-size: .8rem; cursor: pointer; border: 1px solid rgba(0,0,0,.15); background: transparent; color: inherit; }
.picker__use { background: var(--color-primary-strong); color: #fff; border-color: transparent; font-weight: 600; }
.picker__error { font-size: .85rem; color: #8a1f1f; }
</style>
