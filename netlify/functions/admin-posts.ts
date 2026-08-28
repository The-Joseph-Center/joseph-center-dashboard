import { requireCapability, denial } from './_lib/verify-okta';
import { toText, fromText, unsupported } from './_lib/portable-text';

/**
 * Writing and publishing blog posts.
 *
 * This exists because Sanity is licensed for three editor seats and more than
 * three people have something to write. It is a real editor, not a drafting
 * aid: what it saves is the post.
 *
 * Unpublished work uses Sanity's own draft mechanism — a `drafts.` prefixed
 * copy of the document — rather than a status field, so a post drafted here
 * behaves identically to one drafted in Studio and the two cannot disagree
 * about what "published" means.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const DATASET = process.env.VITE_SANITY_DATASET || 'staging';
const SANITY = process.env.SANITY_WRITE_TOKEN!;

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const draftId = (id: string) => (id.startsWith('drafts.') ? id : `drafts.${id}`);
const publishedId = (id: string) => id.replace(/^drafts\./, '');

async function sanityQuery<T>(query: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://${PROJECT}.api.sanity.io/v2024-06-20/data/query/${DATASET}`);
  url.searchParams.set('query', query);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SANITY}` } });
  if (!res.ok) throw new Error(`Sanity query: ${res.status}`);
  return (await res.json()).result;
}

async function sanityMutate(mutations: unknown[]) {
  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/data/mutate/${DATASET}?returnIds=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${SANITY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations }),
    }
  );
  if (!res.ok) throw new Error(`Sanity mutate: ${res.status} ${await res.text()}`);
  return res.json();
}

async function uploadImage(base64: string, filename: string): Promise<string> {
  const comma = base64.indexOf(',');
  const meta = comma > -1 ? base64.slice(0, comma) : '';
  const data = comma > -1 ? base64.slice(comma + 1) : base64;
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error('Unsupported image type');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Image is larger than 10MB');
  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/assets/images/${DATASET}?filename=${encodeURIComponent(filename || 'post-image')}`,
    { method: 'POST', headers: { Authorization: `Bearer ${SANITY}`, 'Content-Type': mime }, body: bytes }
  );
  if (!res.ok) throw new Error(`Asset upload: ${res.status} ${await res.text()}`);
  return (await res.json()).document._id;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96);

interface Post {
  _id: string; title?: string; slug?: { current?: string }; excerpt?: string;
  category?: string; postType?: string; publishedAt?: string; tags?: string[];
  body?: unknown; featuredImage?: { asset?: { _ref?: string }; alt?: string };
  imageUrl?: string | null; author?: { _ref?: string };
}

const LIST_PROJECTION = `{
  _id, title, "slug": slug.current, excerpt, category, postType, publishedAt, tags,
  "imageUrl": featuredImage.asset->url, "authorName": author->name, _updatedAt
}`;

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'content');
  if (!auth.ok) return denial(auth);

  try {
    if (event.httpMethod === 'GET') {
      const id = clean(event.queryStringParameters?.id ?? '', 120);

      // ── One post, opened for editing ──
      if (id) {
        const post = await sanityQuery<Post | null>(`*[_id == $id][0]`, { id });
        if (!post) {
          return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'No such post' }) };
        }
        // Refuse rather than flatten. A body this cannot represent is content
        // somebody would lose on save, and losing it quietly is far worse than
        // being told to open it in Studio.
        const blockers = unsupported(post.body);
        const imageUrl = post.featuredImage?.asset?._ref
          ? await sanityQuery<string | null>(`*[_id == $ref][0].url`, { ref: post.featuredImage.asset._ref })
          : null;
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            post: {
              _id: post._id,
              title: post.title ?? '',
              slug: post.slug?.current ?? '',
              excerpt: post.excerpt ?? '',
              category: post.category ?? '',
              postType: post.postType ?? 'manual',
              publishedAt: post.publishedAt ?? '',
              tags: post.tags ?? [],
              imageUrl,
              imageAlt: post.featuredImage?.alt ?? '',
              bodyText: blockers.length ? '' : toText(post.body),
            },
            blockers,
          }),
        };
      }

      // ── The list ──
      const [published, drafts, categories] = await Promise.all([
        sanityQuery<Post[]>(`*[_type=="post" && !(_id in path("drafts.**"))]|order(publishedAt desc)${LIST_PROJECTION}`),
        sanityQuery<Post[]>(`*[_type=="post" && _id in path("drafts.**")]|order(_updatedAt desc)${LIST_PROJECTION}`),
        sanityQuery<string[]>(`array::unique(*[_type=="post" && defined(category)].category)`),
      ]);
      const draftedIds = new Set(drafts.map((d) => publishedId(d._id)));
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          drafts,
          // A published post with a draft alongside it has unpublished edits —
          // worth saying so, because otherwise "published" looks final when it
          // is not what a visitor is reading.
          published: published.map((p) => ({ ...p, hasDraft: draftedIds.has(p._id) })),
          categories: (categories ?? []).filter(Boolean).sort(),
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const action = clean(body.action, 20);
    const id = clean(body._id, 120);

    if (action === 'publish' || action === 'unpublish' || action === 'delete') {
      if (!id) return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing id' }) };
      const live = publishedId(id);

      if (action === 'delete') {
        await sanityMutate([{ delete: { id: live } }, { delete: { id: draftId(live) } }]);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ deleted: true }) };
      }

      if (action === 'unpublish') {
        const post = await sanityQuery<Post | null>(`*[_id == $id][0]`, { id: live });
        if (!post) return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'No such post' }) };
        const { _id, ...rest } = post as Post & Record<string, unknown>;
        await sanityMutate([
          { createOrReplace: { ...rest, _id: draftId(live), _type: 'post' } },
          { delete: { id: live } },
        ]);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ unpublished: true }) };
      }

      // Publish: promote the draft to the live id, then drop the draft. This is
      // exactly what Studio's publish button does.
      const draft = await sanityQuery<Post | null>(`*[_id == $id][0]`, { id: draftId(live) });
      if (!draft) return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Nothing to publish' }) };
      if (!draft.title || !draft.slug?.current || !draft.publishedAt) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A post needs a title, a web address and a date before it can go live.' }) };
      }
      const { _id: _drop, ...rest } = draft as Post & Record<string, unknown>;
      await sanityMutate([
        { createOrReplace: { ...rest, _id: live, _type: 'post' } },
        { delete: { id: draftId(live) } },
      ]);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ published: true, id: live }) };
    }

    // ── Save a draft ──
    const title = clean(body.title, 200);
    if (!title) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Give the post a title first.' }) };
    }
    const slug = slugify(clean(body.slug, 120) || title);
    const live = id ? publishedId(id) : `post-${slugify(title)}-${Date.now().toString(36)}`;

    // The slug is the post's web address, so a collision would take over
    // another post's URL.
    const clash = await sanityQuery<string[]>(
      `*[_type=="post" && slug.current == $slug && !(_id in path("drafts.**")) && _id != $id]._id`,
      { slug, id: live }
    );
    if (clash?.length) {
      return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: `Another post already uses the address "${slug}".` }) };
    }

    let imageField: Record<string, unknown> | undefined;
    if (typeof body.imageBase64 === 'string' && body.imageBase64) {
      const ref = await uploadImage(body.imageBase64, clean(body.imageFilename, 120));
      imageField = {
        featuredImage: {
          _type: 'image',
          asset: { _type: 'reference', _ref: ref },
          ...(clean(body.imageAlt, 200) ? { alt: clean(body.imageAlt, 200) } : {}),
        },
      };
    }

    const doc = {
      _type: 'post',
      _id: draftId(live),
      title,
      slug: { _type: 'slug', current: slug },
      excerpt: clean(body.excerpt, 500),
      category: clean(body.category, 80),
      postType: ['manual', 'newsletter'].includes(clean(body.postType, 20)) ? clean(body.postType, 20) : 'manual',
      publishedAt: clean(body.publishedAt, 20) || new Date().toISOString().slice(0, 10),
      tags: Array.isArray(body.tags) ? body.tags.map((t: unknown) => clean(t, 40)).filter(Boolean).slice(0, 20) : [],
      body: fromText(clean(body.bodyText, 200000)),
      ...(imageField ?? {}),
    };

    // Keep the existing featured image when none was uploaded this time.
    if (!imageField) {
      const existing = await sanityQuery<Post | null>(
        `coalesce(*[_id == $draft][0], *[_id == $live][0])`,
        { draft: draftId(live), live }
      );
      if (existing?.featuredImage) (doc as Record<string, unknown>).featuredImage = existing.featuredImage;
    }

    await sanityMutate([{ createOrReplace: doc }]);
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: true, id: draftId(live) }) };
  } catch (err) {
    console.error('admin-posts:', err);
    const message = err instanceof Error ? err.message : 'Request failed';
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}
