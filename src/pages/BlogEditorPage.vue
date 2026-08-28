<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import { apiFetch } from '@/lib/api';

// A real blog editor, because Sanity is licensed for three editor seats and
// more than three people have something to write.
//
// Unpublished work uses Sanity's own draft mechanism, so a post drafted here
// behaves exactly like one drafted in Studio — nothing here invents a second
// idea of what "published" means.

interface Row {
  _id: string; title?: string; slug?: string; excerpt?: string; category?: string;
  postType?: string; publishedAt?: string; imageUrl?: string | null;
  authorName?: string; hasDraft?: boolean; _updatedAt?: string;
}

const drafts = ref<Row[]>([]);
const published = ref<Row[]>([]);
const categories = ref<string[]>([]);
const loading = ref(true);
const error = ref('');
const busy = ref('');
const notice = ref('');
const blockers = ref<string[]>([]);
const confirmDelete = ref('');

const editing = ref(false);
const form = ref({
  _id: '', title: '', slug: '', excerpt: '', category: '', postType: 'manual',
  publishedAt: '', tags: '' , bodyText: '', imageUrl: '' as string | null, imageAlt: '',
  imageBase64: '', imageFilename: '',
});

const words = computed(() => form.value.bodyText.trim().split(/\s+/).filter(Boolean).length);
const isNew = computed(() => !form.value._id);

async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-posts');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    drafts.value = d.drafts; published.value = d.published; categories.value = d.categories;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not load posts.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function newPost() {
  form.value = {
    _id: '', title: '', slug: '', excerpt: '', category: '', postType: 'manual',
    publishedAt: new Date().toISOString().slice(0, 10), tags: '', bodyText: '',
    imageUrl: null, imageAlt: '', imageBase64: '', imageFilename: '',
  };
  blockers.value = []; error.value = ''; notice.value = ''; editing.value = true;
}

async function open(row: Row) {
  busy.value = row._id; error.value = ''; notice.value = '';
  try {
    const res = await apiFetch(`/.netlify/functions/admin-posts?id=${encodeURIComponent(row._id)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || String(res.status));
    const d = await res.json();
    blockers.value = d.blockers ?? [];
    form.value = {
      _id: d.post._id, title: d.post.title, slug: d.post.slug, excerpt: d.post.excerpt,
      category: d.post.category, postType: d.post.postType, publishedAt: d.post.publishedAt,
      tags: (d.post.tags ?? []).join(', '), bodyText: d.post.bodyText,
      imageUrl: d.post.imageUrl, imageAlt: d.post.imageAlt, imageBase64: '', imageFilename: '',
    };
    editing.value = true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not open that post.';
  } finally {
    busy.value = '';
  }
}

function pickImage(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    form.value.imageBase64 = String(reader.result);
    form.value.imageFilename = file.name;
  };
  reader.readAsDataURL(file);
}

async function post(payload: Record<string, unknown>, id = 'form') {
  busy.value = id; error.value = '';
  try {
    const res = await apiFetch('/.netlify/functions/admin-posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || String(res.status));
    await load();
    return data;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save.';
    return null;
  } finally {
    busy.value = '';
  }
}

async function saveDraft() {
  const d = await post({
    ...form.value,
    tags: form.value.tags.split(',').map((t) => t.trim()).filter(Boolean),
  });
  if (d?.id) { form.value._id = d.id; form.value.imageBase64 = ''; notice.value = 'Draft saved. It is not on the website yet.'; }
}

async function publish() {
  const saved = await post({
    ...form.value,
    tags: form.value.tags.split(',').map((t) => t.trim()).filter(Boolean),
  });
  if (!saved?.id) return;
  const done = await post({ action: 'publish', _id: saved.id });
  if (done?.published) { notice.value = 'Published. It is live on the website now.'; editing.value = false; }
}

const unpublish = (row: Row) => post({ action: 'unpublish', _id: row._id }, row._id);
const remove = async (row: Row) => { await post({ action: 'delete', _id: row._id }, row._id); confirmDelete.value = ''; };
const publishRow = (row: Row) => post({ action: 'publish', _id: row._id }, row._id);
</script>

<template>
  <DashboardLayout page-title="Blog">
    <p v-if="loading" class="state">Loading…</p>

    <template v-else>
      <p v-if="error" class="state state--err" role="alert">{{ error }}</p>
      <p v-if="notice" class="state state--ok">{{ notice }}</p>

      <!-- ── The editor ── -->
      <section v-if="editing" class="widget block">
        <h2 class="block__title">{{ isNew ? 'New post' : 'Edit post' }}</h2>

        <p v-if="blockers.length" class="warn" role="alert">
          This post uses formatting this editor cannot handle ({{ blockers.join(', ') }}), so its
          text has not been loaded. Editing it here would lose that formatting — open it in Sanity
          Studio instead.
        </p>

        <template v-else>
          <label class="f"><span>Title</span><input v-model="form.title" type="text" maxlength="200" /></label>

          <div class="grid2">
            <label class="f">
              <span>Web address</span>
              <input v-model="form.slug" type="text" placeholder="left blank, made from the title" />
            </label>
            <label class="f"><span>Date</span><input v-model="form.publishedAt" type="date" /></label>
          </div>

          <label class="f">
            <span>Summary shown on the blog index</span>
            <textarea v-model="form.excerpt" rows="2" maxlength="500" />
          </label>

          <div class="grid2">
            <label class="f">
              <span>Category</span>
              <input v-model="form.category" type="text" list="cats" placeholder="e.g. Community" />
              <datalist id="cats"><option v-for="c in categories" :key="c" :value="c" /></datalist>
            </label>
            <label class="f">
              <span>Kind of post</span>
              <select v-model="form.postType">
                <option value="manual">Article / update</option>
                <option value="newsletter">Newsletter recap</option>
              </select>
            </label>
          </div>

          <label class="f"><span>Tags, separated by commas</span><input v-model="form.tags" type="text" /></label>

          <div class="image">
            <img v-if="form.imageUrl" :src="`${form.imageUrl}?w=200&h=120&fit=crop&auto=format`" alt="" class="image__thumb" />
            <div v-else class="image__none">No cover image</div>
            <div class="image__side">
              <label class="upload">
                {{ form.imageBase64 ? 'New image ready' : 'Choose a cover image' }}
                <input type="file" accept="image/*" @change="pickImage" />
              </label>
              <input v-model="form.imageAlt" type="text" class="image__alt" placeholder="Describe the image for screen readers" />
            </div>
          </div>

          <label class="f">
            <span>The post <span class="count">{{ words }} words</span></span>
            <textarea v-model="form.bodyText" rows="20" class="body" spellcheck="true"></textarea>
          </label>
          <p class="hint">
            Leave a blank line between paragraphs. <code>## Heading</code> and <code>### Smaller heading</code>,
            <code>**bold**</code>, <code>*italic*</code>, <code>[link text](https://…)</code>,
            <code>- bullets</code>, <code>1. numbered</code>, <code>&gt; quote</code>.
            Images already in a post appear as <code>![image](…)</code> — leave those lines alone and they stay put.
          </p>

          <div class="actions">
            <button type="button" class="btn btn--sm" :disabled="busy === 'form' || !form.title" @click="publish">
              {{ busy === 'form' ? 'Working…' : 'Publish' }}
            </button>
            <button type="button" class="btn btn--ghost btn--sm" :disabled="busy === 'form' || !form.title" @click="saveDraft">
              Save as draft
            </button>
            <button type="button" class="linkish" @click="editing = false">Close</button>
          </div>
        </template>
      </section>

      <div v-else class="widget block newbar">
        <p class="newbar__text">Write a post, or pick one up below. Drafts are not on the website until you publish them.</p>
        <button type="button" class="btn btn--sm" @click="newPost">Write a post</button>
      </div>

      <!-- ── Drafts ── -->
      <section v-if="drafts.length" class="widget block">
        <h2 class="block__title">Drafts ({{ drafts.length }})</h2>
        <ul class="list">
          <li v-for="p in drafts" :key="p._id" class="item">
            <div>
              <p class="item__title">{{ p.title || '(untitled)' }}</p>
              <p class="item__meta">{{ p.category || 'No category' }} · edited {{ new Date(p._updatedAt!).toLocaleDateString() }}</p>
            </div>
            <div class="item__actions">
              <button type="button" class="linkish" :disabled="busy === p._id" @click="open(p)">Edit</button>
              <button type="button" class="linkish" :disabled="busy === p._id" @click="publishRow(p)">Publish</button>
              <template v-if="confirmDelete === p._id">
                <span class="warn-inline">Delete?</span>
                <button type="button" class="linkish linkish--danger" @click="remove(p)">Yes</button>
                <button type="button" class="linkish" @click="confirmDelete = ''">No</button>
              </template>
              <button v-else type="button" class="linkish linkish--danger" @click="confirmDelete = p._id">Delete</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- ── Published ── -->
      <section class="widget block">
        <h2 class="block__title">On the website ({{ published.length }})</h2>
        <ul class="list">
          <li v-for="p in published" :key="p._id" class="item">
            <div>
              <p class="item__title">
                {{ p.title }}
                <span v-if="p.hasDraft" class="pill">unpublished edits</span>
              </p>
              <p class="item__meta">{{ p.publishedAt }} · {{ p.category || 'No category' }} · /blog/{{ p.slug }}</p>
            </div>
            <div class="item__actions">
              <button type="button" class="linkish" :disabled="busy === p._id" @click="open(p)">Edit</button>
              <button type="button" class="linkish" :disabled="busy === p._id" @click="unpublish(p)">Unpublish</button>
              <template v-if="confirmDelete === p._id">
                <span class="warn-inline">Delete for good?</span>
                <button type="button" class="linkish linkish--danger" @click="remove(p)">Yes</button>
                <button type="button" class="linkish" @click="confirmDelete = ''">No</button>
              </template>
              <button v-else type="button" class="linkish linkish--danger" @click="confirmDelete = p._id">Delete</button>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </DashboardLayout>
</template>

<style scoped>
.widget { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: 1.25rem; }
.block { margin-bottom: 1.25rem; }
.block__title { font-family: var(--font-heading); font-size: 1rem; margin: 0 0 .75rem; }
.state { color: var(--color-text-secondary); font-size: .875rem; margin-bottom: .75rem; }
.state--err { color: #8a1f1f; }
.state--ok { color: var(--color-primary-strong); }
.warn { font-size: .8125rem; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 8%, transparent); border-radius: var(--border-radius); padding: .7rem .8rem; margin: 0; line-height: 1.5; }
.warn-inline { font-size: .75rem; color: #8a1f1f; font-weight: 600; }

.newbar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.newbar__text { margin: 0; font-size: .8125rem; color: var(--color-text-secondary); }

.f { display: block; margin-bottom: .7rem; }
.f > span { display: block; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: .25rem; }
.count { float: right; text-transform: none; letter-spacing: 0; font-weight: 400; }
.f input, .f select, .f textarea { width: 100%; padding: .45rem .55rem; font: inherit; font-size: .8125rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; line-height: 1.65; resize: vertical; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
.hint { font-size: .75rem; color: var(--color-text-secondary); margin: -.3rem 0 1rem; line-height: 1.6; }
.hint code { background: var(--color-bg); padding: .05rem .3rem; border-radius: 3px; font-size: .95em; }

.image { display: flex; gap: .8rem; align-items: flex-start; margin-bottom: .9rem; }
.image__thumb { width: 120px; height: 72px; object-fit: cover; border-radius: var(--border-radius); }
.image__none { width: 120px; height: 72px; border: 1px dashed var(--color-border); border-radius: var(--border-radius); display: flex; align-items: center; justify-content: center; font-size: .7rem; color: var(--color-text-secondary); text-align: center; }
.image__side { flex: 1; display: flex; flex-direction: column; gap: .4rem; }
.image__alt { padding: .4rem .5rem; font: inherit; font-size: .75rem; border: 1px solid var(--color-border); border-radius: var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.upload { font-size: .75rem; color: var(--color-primary-strong); font-weight: 600; cursor: pointer; }
.upload input { display: none; }

.actions { display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
.list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
.item { display: flex; justify-content: space-between; gap: 1rem; padding: .65rem .8rem; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--border-radius); flex-wrap: wrap; }
.item__title { margin: 0; font-size: .875rem; font-weight: 600; }
.item__meta { margin: .2rem 0 0; font-size: .7rem; color: var(--color-text-secondary); }
.item__actions { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
.pill { font-size: .65rem; font-weight: 600; padding: .1rem .45rem; border-radius: 999px; color: #8a5a1f; background: color-mix(in srgb, #8a5a1f 12%, transparent); margin-left: .4rem; }

.btn { background: var(--color-primary-strong); color: #fff; border: 0; border-radius: var(--border-radius); font-weight: 600; cursor: pointer; }
.btn--sm { padding: .4rem .9rem; font-size: .8125rem; }
.btn--ghost { background: none; color: var(--color-text-secondary); border: 1px solid var(--color-border); }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.linkish { background: none; border: 0; padding: 0; font: inherit; font-size: .75rem; color: var(--color-text-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.linkish:hover { color: var(--color-text); }
.linkish:disabled { opacity: .5; cursor: not-allowed; }
.linkish--danger { color: #8a1f1f; }
</style>
