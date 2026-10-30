import { requireCapability, denial } from './_lib/verify-okta';
import { SANITY_DATASET } from './_lib/sanity-dataset';
import { fromPortableText, toPortableText } from './_lib/banner';

/**
 * The site-wide notice — closures, changed hours, announcements.
 *
 * The banner lives in Sanity as portable text, which is the right storage for a
 * message that can carry an inline link and the wrong thing to put in front of
 * someone who needs to say "we are closed today" in a hurry. This edits plain
 * text plus an optional link and writes valid portable text back, so Studio and
 * the website keep working with exactly the shape they already expect.
 *
 * Only one banner shows at a time, and posting one **switches nothing off**.
 *
 * That is a reversal. This used to deactivate every other banner, and then
 * every banner whose dates overlapped. Both were wrong, and the second was
 * wrong in a way that only appeared when somebody tried to use the feature: a
 * run of consecutive banners — campaign, closure, campaign again — touches or
 * overlaps at every handover, so posting the second deleted the first and the
 * third deleted the second. A queue could not be entered at all.
 *
 * It is also unnecessary. The site resolves two live banners by showing the one
 * that ends soonest (see `bannerShowingAt`), so an overlap is not a conflict to
 * be prevented — it is the ordinary way a closure sits inside a month-long
 * campaign. Replacing a banner still works without any of it: two open-ended
 * banners tie on end date and fall back to the most recently edited, so the new
 * one takes the slot.
 *
 * What is left is a queue the dashboard shows in full, and switching one off is
 * something a person does deliberately.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const DATASET = SANITY_DATASET;
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

/**
 * Starting points, because a blank box at the moment the building shuts is the
 * reason a notice does not go up at all. Wording is theirs to change.
 */
const TEMPLATES = [
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
