import { requireCapability, denial } from './_lib/verify-okta';
import { fetchOktaUsers, oktaLogin, DEPARTED_STATUSES, turso } from './_lib/staff-directory';

/**
 * Staff administration — read the roster, edit public details, create a card.
 *
 * Okta is NOT the source of truth for what appears on the website. `department`
 * is absent from this org's Okta profile schema entirely and `title` is set on
 * 2 of 32 users, but more fundamentally the public title is copy written to read
 * on a card, not an HR record — binding them makes every wording tweak a
 * directory edit. Okta owns identity, access and employment status; Sanity owns
 * the public-facing copy and the photo, which Okta cannot store at all.
 *
 * Creating a card pre-fills name and email from Okta so onboarding is a click
 * plus a photo, without a directory change ever silently rewriting public copy.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const DATASET = process.env.VITE_SANITY_DATASET || 'staging';
const SANITY = process.env.SANITY_WRITE_TOKEN!;

const DEPARTMENTS = [
  'day-shelter', 'family-center', 'golden-girls', 'ifs', 'it-marketing',
  'kitchen', 'maintenance', 'security', 'operations', 'unknown',
];

const clean = (v: unknown, max = 200) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

async function sanityQuery<T>(query: string): Promise<T> {
  const url = `https://${PROJECT}.api.sanity.io/v2024-06-20/data/query/${DATASET}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SANITY}` } });
  if (!res.ok) throw new Error(`Sanity query: ${res.status}`);
  return (await res.json()).result;
}

async function sanityMutate(mutations: unknown[]) {
  // returnIds is required for the response to carry the created document's id —
  // without it `results` comes back empty and a caller cannot follow up on what
  // it just made.
  const res = await fetch(`https://${PROJECT}.api.sanity.io/v2024-06-20/data/mutate/${DATASET}?returnIds=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SANITY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutations }),
  });
  if (!res.ok) throw new Error(`Sanity mutate: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Uploads a base64 image and returns the asset id. */
async function uploadImage(base64: string, filename: string): Promise<string> {
  const comma = base64.indexOf(',');
  const meta = comma > -1 ? base64.slice(0, comma) : '';
  const data = comma > -1 ? base64.slice(comma + 1) : base64;
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error('Unsupported image type');

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Image is larger than 8MB');

  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/assets/images/${DATASET}?filename=${encodeURIComponent(filename || 'staff-photo')}`,
    { method: 'POST', headers: { Authorization: `Bearer ${SANITY}`, 'Content-Type': mime }, body: bytes }
  );
  if (!res.ok) throw new Error(`Asset upload: ${res.status} ${await res.text()}`);
  return (await res.json()).document._id;
}

interface Card {
  _id: string; name?: string; title?: string; email?: string;
  departments?: string[]; hidden?: boolean; imageUrl?: string | null;
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'staffAdmin');
  if (!auth.ok) return denial(auth);

  try {
    // ── Read the roster ──
    if (event.httpMethod === 'GET') {
      const cards = await sanityQuery<Card[]>(
        `*[_type=="staff" && !(_id in path("drafts.**"))]|order(name asc){
          _id,name,title,email,departments,hidden,"imageUrl":image.asset->url
        }`
      );
      const linked = new Map<string, string>(
        (await turso().execute('SELECT okta_login, sanity_staff_id FROM staff_identity')).rows.map(
          (r) => [String(r.okta_login), String(r.sanity_staff_id)]
        )
      );
      const users = await fetchOktaUsers(process.env.OKTA_ISSUER!, process.env.OKTA_API_TOKEN!);

      // People in the directory who have no card yet — the onboarding queue.
      const needsCard = users
        .filter((u) => !DEPARTED_STATUSES.has(u.status) && !linked.has(oktaLogin(u)))
        .map((u) => ({
          login: oktaLogin(u),
          firstName: u.profile.firstName ?? '',
          lastName: u.profile.lastName ?? '',
          title: u.profile.title ?? '',
          status: u.status,
        }));

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ cards, needsCard, departments: DEPARTMENTS }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const action = clean(body.action, 20);

    const name = clean(body.name, 120);
    const title = clean(body.title, 200);
    const email = clean(body.email, 200);
    const departments = Array.isArray(body.departments)
      ? body.departments.filter((d: unknown) => typeof d === 'string' && DEPARTMENTS.includes(d))
      : [];

    // Photo is optional on both paths — it is the one thing Okta cannot supply.
    let imageAssetId: string | null = null;
    if (typeof body.imageBase64 === 'string' && body.imageBase64) {
      imageAssetId = await uploadImage(body.imageBase64, clean(body.imageFilename, 120));
    }

    const imageField = imageAssetId
      ? { image: { _type: 'image', asset: { _type: 'reference', _ref: imageAssetId } } }
      : {};

    if (action === 'create') {
      if (!name) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A name is required.' }) };
      }
      const created = await sanityMutate([
        { create: { _type: 'staff', name, title, email, departments, hidden: false, ...imageField } },
      ]) as { results?: { id: string }[] };
      const newId = created.results?.[0]?.id ?? null;
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ created: true, id: newId }) };
    }

    const id = clean(body._id, 120);
    if (!id) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing staff id' }) };
    }

    // `quote` is deliberately absent: staff own it, through the review flow.
    const set: Record<string, unknown> = { name, title, email, departments, ...imageField };
    if (typeof body.hidden === 'boolean') set.hidden = body.hidden;

    await sanityMutate([{ patch: { id, set } }]);
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: true }) };
  } catch (err) {
    console.error('admin-staff:', err);
    const message = err instanceof Error ? err.message : 'Request failed';
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}
