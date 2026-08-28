import { requireCapability, denial } from './_lib/verify-okta';

/**
 * The site-wide notice — closures, changed hours, announcements.
 *
 * The banner lives in Sanity as portable text, which is the right storage for a
 * message that can carry an inline link and the wrong thing to put in front of
 * someone who needs to say "we are closed today" in a hurry. This edits plain
 * text plus an optional link and writes valid portable text back, so Studio and
 * the website keep working with exactly the shape they already expect.
 *
 * Only one banner can show at a time — the site takes the first match — so
 * switching one on switches the others off. Leaving that to whoever is posting
 * means the day it is forgotten, which banner appears is decided by the order
 * Sanity happens to return.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const DATASET = process.env.VITE_SANITY_DATASET || 'staging';
const SANITY = process.env.SANITY_WRITE_TOKEN!;

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function sanityQuery<T>(query: string): Promise<T> {
  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/data/query/${DATASET}?query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Bearer ${SANITY}` } }
  );
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

/** Random enough for a _key; Sanity only requires uniqueness within the array. */
const key = () => Math.random().toString(36).slice(2, 14);

interface Span { _key: string; _type: 'span'; marks: string[]; text: string }

/**
 * Plain text (+ an optional trailing link) as a portable-text block.
 *
 * Matches the shape the existing banner document already uses — one block, spans
 * with a link annotation in markDefs — so the site renders a banner written here
 * identically to one written in Studio.
 */
export function toPortableText(text: string, linkLabel: string, linkHref: string) {
  const children: Span[] = [];
  const markDefs: { _key: string; _type: 'link'; href: string }[] = [];

  if (text) children.push({ _key: key(), _type: 'span', marks: [], text });

  if (linkHref && linkLabel) {
    const linkKey = key();
    markDefs.push({ _key: linkKey, _type: 'link', href: linkHref });
    // A space between the sentence and the link, so they do not run together.
    if (text) children.push({ _key: key(), _type: 'span', marks: [], text: ' ' });
    children.push({ _key: key(), _type: 'span', marks: ['strong', linkKey], text: linkLabel });
  }

  return [{ _key: key(), _type: 'block', style: 'normal', markDefs, children }];
}

/** The reverse, for editing something written in Studio. */
export function fromPortableText(blocks: unknown): { text: string; linkLabel: string; linkHref: string } {
  const out = { text: '', linkLabel: '', linkHref: '' };
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks as { children?: Span[]; markDefs?: { _key: string; href?: string }[] }[]) {
    const defs = new Map((block.markDefs ?? []).map((d) => [d._key, d.href ?? '']));
    for (const child of block.children ?? []) {
      const linkMark = (child.marks ?? []).find((m) => defs.has(m));
      if (linkMark) {
        out.linkLabel = child.text;
        out.linkHref = defs.get(linkMark) ?? '';
      } else {
        out.text += child.text;
      }
    }
  }
  out.text = out.text.trim();
  return out;
}

/**
 * Starting points, because a blank box at the moment the building shuts is the
 * reason a notice does not go up at all. Wording is theirs to change.
 */
const TEMPLATES = [
  { id: 'weather', label: 'Weather closure',
    text: 'The Joseph Center is closed today due to weather. We will reopen at our usual time tomorrow.' },
  { id: 'early', label: 'Closing early',
    text: 'We are closing early today at 2:00pm. Normal hours resume tomorrow.' },
  { id: 'holiday', label: 'Holiday hours',
    text: 'We are closed for the holiday and will reopen on Monday.' },
  { id: 'program', label: 'Program change',
    text: 'The Day Shelter is closed this afternoon. All other services are running as usual.' },
  { id: 'announcement', label: 'Announcement',
    text: 'Join us for our annual celebration on Saturday.', linkLabel: 'See the details →' },
];

interface BannerDoc {
  _id: string; title?: string; message?: unknown; active?: boolean;
  startsAt?: string; endsAt?: string; _updatedAt?: string;
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'banners');
  if (!auth.ok) return denial(auth);

  try {
    const banners = await sanityQuery<BannerDoc[]>(
      `*[_type=="banner" && !(_id in path("drafts.**"))]|order(_updatedAt desc){
        _id,title,message,active,startsAt,endsAt,_updatedAt
      }`
    );

    if (event.httpMethod === 'GET') {
      const now = Date.now();
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          templates: TEMPLATES,
          banners: banners.map((b) => {
            const parts = fromPortableText(b.message);
            const started = !b.startsAt || new Date(b.startsAt).getTime() <= now;
            const ended = !!b.endsAt && new Date(b.endsAt).getTime() < now;
            return {
              ...b, ...parts,
              // What a visitor would see right now, which is the only status
              // worth showing — "active" alone is a half-answer once a banner
              // can be scheduled.
              live: b.active !== false && started && !ended,
              state: b.active === false ? 'off' : !started ? 'scheduled' : ended ? 'expired' : 'live',
            };
          }),
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const action = clean(body.action, 20);
    const id = clean(body._id, 120);

    if (action === 'delete') {
      if (!id) return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing id' }) };
      await sanityMutate([{ delete: { id } }]);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ deleted: true }) };
    }

    if (action === 'off') {
      if (!id) return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing id' }) };
      await sanityMutate([{ patch: { id, set: { active: false } } }]);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ active: false }) };
    }

    // ── Create or update, and put it live ──
    const text = clean(body.text, 400);
    const linkLabel = clean(body.linkLabel, 80);
    const linkHref = clean(body.linkHref, 500);
    if (!text && !linkLabel) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Write a message first.' }) };
    }
    if (linkHref && !/^(https?:\/\/|\/)/.test(linkHref)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A link must start with https:// or /' }) };
    }
    if (linkLabel && !linkHref) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The link needs a web address.' }) };
    }

    const startsAt = clean(body.startsAt, 40);
    const endsAt = clean(body.endsAt, 40);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The end time has to be after the start time.' }) };
    }

    const active = body.active !== false;
    const fields = {
      // The admin label is internal. Derived from the message so the Studio list
      // is readable without asking anyone to invent a second name for the thing
      // they just wrote.
      title: clean(body.title, 120) || (text || linkLabel).slice(0, 60),
      message: toPortableText(text, linkLabel, linkHref),
      active,
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
    };
    const unset = [...(startsAt ? [] : ['startsAt']), ...(endsAt ? [] : ['endsAt'])];

    const mutations: unknown[] = id
      ? [{ patch: { id, set: fields, ...(unset.length ? { unset } : {}) } }]
      : [{ create: { _type: 'banner', ...fields } }];

    // Only one can show, so switching this one on switches the rest off.
    if (active) {
      for (const other of banners) {
        if (other._id === id || other.active === false) continue;
        mutations.push({ patch: { id: other._id, set: { active: false } } });
      }
    }

    const result = await sanityMutate(mutations) as { results?: { id: string }[] };
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ saved: true, id: id || result.results?.[0]?.id || null }),
    };
  } catch (err) {
    console.error('admin-banner:', err);
    const message = err instanceof Error ? err.message : 'Request failed';
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}
