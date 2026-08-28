<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
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

// ── Formatting ──
// The toolbar writes the same plain format the body is stored in rather than
// driving a rich-text widget. One format means one conversion to the site's
// portable text, and that conversion is the thing that was tested against every
// real post — a second editing model would be a second way to lose content.
const bodyEl = ref<HTMLTextAreaElement | null>(null);

function apply(kind: string) {
  const el = bodyEl.value;
  if (!el) return;
  const text = form.value.bodyText;
  const [from, to] = [el.selectionStart, el.selectionEnd];
  const selected = text.slice(from, to);

  const wrap = (mark: string) => `${mark}${selected || 'text'}${mark}`;
  const linesOf = (s: string) => (s || 'List item').split('\n').filter(Boolean);
  // Line-level formats need to start on their own line.
  const atLineStart = from === 0 || text[from - 1] === '\n';
  const lead = atLineStart ? '' : '\n\n';

  let insert = '';
  switch (kind) {
    case 'bold':   insert = wrap('**'); break;
    case 'italic': insert = wrap('*'); break;
    case 'link': {
      const url = window.prompt('Where should this link go?', 'https://');
      if (!url) return;
      insert = `[${selected || 'link text'}](${url})`;
      break;
    }
    case 'h2':     insert = `${lead}## ${selected || 'Heading'}`; break;
    case 'h3':     insert = `${lead}### ${selected || 'Smaller heading'}`; break;
    case 'quote':  insert = `${lead}> ${selected || 'Quote'}`; break;
    case 'ul':     insert = lead + linesOf(selected).map((l) => `- ${l}`).join('\n'); break;
    case 'ol':     insert = lead + linesOf(selected).map((l, i) => `${i + 1}. ${l}`).join('\n'); break;
    default: return;
  }

  form.value.bodyText = text.slice(0, from) + insert + text.slice(to);
  nextTick(() => {
    el.focus();
    const end = from + insert.length;
    el.setSelectionRange(end, end);
  });
}

const uploadingBody = ref(false);
async function insertImage(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  uploadingBody.value = true; error.value = '';
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read that file'));
      r.readAsDataURL(file);
    });
    const res = await apiFetch('/.netlify/functions/admin-posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upload', imageBase64: base64, imageFilename: file.name }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    const alt = window.prompt('Describe the image for screen readers:', '') ?? '';
    const el = bodyEl.value;
    const at = el ? el.selectionStart : form.value.bodyText.length;
    const line = `![image](${d.ref}${alt ? ` "${alt}"` : ''})`;
    const before = form.value.bodyText.slice(0, at);
    const sep = before && !before.endsWith('\n\n') ? '\n\n' : '';
    form.value.bodyText = before + sep + line + '\n\n' + form.value.bodyText.slice(at);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not add the image.';
  } finally {
    uploadingBody.value = false;
    (e.target as HTMLInputElement).value = '';
  }
}

// ── Preview ──
// Renders the same shapes the site does, so what is on screen is what the post
// will look like rather than a description of it.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s: string) =>
  escapeHtml(s)
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

const previewHtml = computed(() => {
  const out: string[] = [];
  for (const raw of form.value.bodyText.split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    if (/^!\[image\]\(/.test(chunk)) { out.push('<p class="ph">[image]</p>'); continue; }
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^- /.test(l))) {
      out.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => /^\d+[.)] /.test(l))) {
      out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+[.)] /, ''))}</li>`).join('')}</ol>`);
    } else if (chunk.startsWith('### ')) out.push(`<h3>${inline(chunk.slice(4))}</h3>`);
    else if (chunk.startsWith('## ')) out.push(`<h2>${inline(chunk.slice(3))}</h2>`);
    else if (chunk.startsWith('> ')) out.push(`<blockquote>${inline(chunk.slice(2))}</blockquote>`);
    else out.push(`<p>${inline(chunk)}</p>`);
  }
  return out.join('');
});
const showPreview = ref(false);

// ── Suggestions ──
const suggesting = ref(false);
const suggestions = ref<{ titles: string[]; excerpt: string; category: string; tags: string[] } | null>(null);
const suggestError = ref('');

async function suggest() {
  suggesting.value = true; suggestError.value = ''; suggestions.value = null;
  try {
    const res = await apiFetch('/.netlify/functions/ai-assist', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bodyText: form.value.bodyText, categories: categories.value }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || String(res.status));
    suggestions.value = d;
  } catch (e) {
    suggestError.value = e instanceof Error ? e.message : 'Could not get suggestions.';
  } finally {
    suggesting.value = false;
  }
}

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

          <div class="f">
            <span class="f__label">The post <span class="count">{{ words }} words</span></span>

            <div class="toolbar">
              <button type="button" class="tb tb--b" title="Bold" @click="apply('bold')">B</button>
              <button type="button" class="tb tb--i" title="Italic" @click="apply('italic')">I</button>
              <button type="button" class="tb" title="Link" @click="apply('link')">Link</button>
              <span class="tb__sep"></span>
              <button type="button" class="tb" title="Heading" @click="apply('h2')">H2</button>
              <button type="button" class="tb" title="Smaller heading" @click="apply('h3')">H3</button>
              <button type="button" class="tb" title="Quote" @click="apply('quote')">&ldquo;</button>
              <span class="tb__sep"></span>
              <button type="button" class="tb" title="Bulleted list" @click="apply('ul')">• List</button>
              <button type="button" class="tb" title="Numbered list" @click="apply('ol')">1. List</button>
              <span class="tb__sep"></span>
              <label class="tb tb--file" :class="{ 'tb--busy': uploadingBody }">
                {{ uploadingBody ? 'Uploading…' : 'Image' }}
                <input type="file" accept="image/*" :disabled="uploadingBody" @change="insertImage" />
              </label>
              <button type="button" class="tb tb--right" @click="showPreview = !showPreview">
                {{ showPreview ? 'Hide preview' : 'Preview' }}
              </button>
            </div>

            <div class="editor-panes" :class="{ 'editor-panes--split': showPreview }">
              <textarea ref="bodyEl" v-model="form.bodyText" rows="20" class="body" spellcheck="true"></textarea>
              <div v-if="showPreview" class="preview" v-html="previewHtml"></div>
            </div>
          </div>
          <p class="hint">
            Select some text and use the buttons, or type it directly:
            <code>## Heading</code>, <code>**bold**</code>, <code>*italic*</code>,
            <code>[link text](https://…)</code>, <code>- bullets</code>, <code>1. numbered</code>, <code>&gt; quote</code>.
            Leave a blank line between paragraphs. Images appear as <code>![image](…)</code> lines — leave those alone and they stay put.
          </p>

          <!-- Suggestions -->
          <div class="suggest">
            <div class="suggest__head">
              <button type="button" class="btn btn--ghost btn--sm" :disabled="suggesting || words < 30" @click="suggest">
                {{ suggesting ? 'Reading the post…' : 'Suggest title, summary, category and tags' }}
              </button>
              <span v-if="words < 30" class="hint hint--inline">Write a little more first.</span>
            </div>
            <p v-if="suggestError" class="warn" role="alert">{{ suggestError }}</p>

            <div v-if="suggestions" class="suggest__body">
              <p class="suggest__note">Suggestions only — nothing changes until you pick one.</p>

              <div v-if="suggestions.titles.length" class="suggest__row">
                <span class="suggest__label">Title</span>
                <div class="suggest__opts">
                  <button v-for="t in suggestions.titles" :key="t" type="button" class="chip" @click="form.title = t">{{ t }}</button>
                </div>
              </div>
              <div v-if="suggestions.excerpt" class="suggest__row">
                <span class="suggest__label">Summary</span>
                <div class="suggest__opts">
                  <button type="button" class="chip chip--wide" @click="form.excerpt = suggestions.excerpt">{{ suggestions.excerpt }}</button>
                </div>
              </div>
              <div v-if="suggestions.category" class="suggest__row">
                <span class="suggest__label">Category</span>
                <div class="suggest__opts">
                  <button type="button" class="chip" @click="form.category = suggestions.category">{{ suggestions.category }}</button>
                </div>
              </div>
              <div v-if="suggestions.tags.length" class="suggest__row">
                <span class="suggest__label">Tags</span>
                <div class="suggest__opts">
                  <button type="button" class="chip" @click="form.tags = suggestions.tags.join(', ')">{{ suggestions.tags.join(', ') }}</button>
                </div>
              </div>
            </div>
          </div>

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
.body { width: 100%; padding: .55rem .65rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8125rem; line-height: 1.65; resize: vertical; border: 1px solid var(--color-border); border-top: 0; border-radius: 0 0 var(--border-radius) var(--border-radius); background: var(--color-surface); color: var(--color-text); }
.f__label { display: block; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); margin-bottom: .25rem; }

.toolbar { display: flex; align-items: center; gap: .2rem; flex-wrap: wrap; padding: .35rem .4rem; border: 1px solid var(--color-border); border-radius: var(--border-radius) var(--border-radius) 0 0; background: var(--color-bg); }
.tb { background: none; border: 0; border-radius: 4px; padding: .25rem .5rem; font: inherit; font-size: .75rem; color: var(--color-text); cursor: pointer; }
.tb:hover { background: var(--color-surface); }
.tb--b { font-weight: 700; }
.tb--i { font-style: italic; }
.tb--file { position: relative; overflow: hidden; }
.tb--file input { display: none; }
.tb--busy { opacity: .6; cursor: wait; }
.tb--right { margin-left: auto; color: var(--color-primary-strong); font-weight: 600; }
.tb__sep { width: 1px; height: 1rem; background: var(--color-border); margin: 0 .25rem; }

.editor-panes { display: grid; grid-template-columns: 1fr; }
.editor-panes--split { grid-template-columns: 1fr 1fr; gap: 0; }
.editor-panes--split .body { border-radius: 0 0 0 var(--border-radius); }
.preview { border: 1px solid var(--color-border); border-top: 0; border-left: 0; border-radius: 0 0 var(--border-radius) 0; padding: .75rem 1rem; overflow-y: auto; max-height: 32rem; font-size: .875rem; line-height: 1.65; }
.preview :deep(h2) { font-family: var(--font-heading); font-size: 1.05rem; margin: 1rem 0 .4rem; }
.preview :deep(h3) { font-family: var(--font-heading); font-size: .95rem; margin: .9rem 0 .35rem; }
.preview :deep(p) { margin: 0 0 .7rem; }
.preview :deep(blockquote) { margin: 0 0 .7rem; padding-left: .8rem; border-left: 3px solid var(--color-border); color: var(--color-text-secondary); font-style: italic; }
.preview :deep(ul), .preview :deep(ol) { margin: 0 0 .7rem; padding-left: 1.2rem; }
.preview :deep(li) { margin-bottom: .2rem; }
.preview :deep(a) { color: var(--color-primary-strong); }
.preview :deep(.ph) { color: var(--color-text-secondary); font-size: .75rem; background: var(--color-bg); border-radius: 4px; padding: .3rem .5rem; display: inline-block; }
@media (max-width: 860px) { .editor-panes--split { grid-template-columns: 1fr; } .preview { border-left: 1px solid var(--color-border); } }

.suggest { border: 1px solid var(--color-border); border-radius: var(--border-radius); padding: .8rem; margin-bottom: 1rem; background: var(--color-bg); }
.suggest__head { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
.suggest__note { margin: .7rem 0 .5rem; font-size: .75rem; color: var(--color-text-secondary); }
.suggest__row { display: flex; gap: .6rem; align-items: flex-start; margin-bottom: .5rem; }
.suggest__label { flex: 0 0 4.5rem; font-family: var(--font-heading); font-size: .65rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-secondary); padding-top: .3rem; }
.suggest__opts { display: flex; flex-wrap: wrap; gap: .35rem; }
.chip { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 999px; padding: .25rem .7rem; font: inherit; font-size: .75rem; cursor: pointer; text-align: left; color: var(--color-text); }
.chip:hover { border-color: var(--color-primary-strong); color: var(--color-primary-strong); }
.chip--wide { border-radius: var(--border-radius); max-width: 100%; }
.hint--inline { margin: 0; }
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
