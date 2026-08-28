import { createClient } from '@libsql/client/web';

// Resolves "who is asking" to "which staff card do they own".
//
// The link is deliberately NOT the card's public `email` field. kisaacs@ sits on
// both Mona's and Khira's cards, because Mona's public contact routes to her
// assistant — matching on it would hand Khira the Executive Director's record.
// staff_identity holds the real mapping, keyed on the Okta login, with a UNIQUE
// index so one account can never own two cards.

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const DATASET = process.env.VITE_SANITY_DATASET || 'staging';
const WRITE_TOKEN = process.env.SANITY_WRITE_TOKEN!;

export interface StaffCard {
  _id: string;
  name?: string;
  title?: string;
  email?: string;
  quote?: string;
  quoteSource?: string;
  departments?: string[];
  hidden?: boolean;
  imageUrl?: string | null;
}

/** The staff document id linked to this Okta login, or null. */
export async function staffIdForLogin(login: string): Promise<string | null> {
  const r = await turso.execute({
    sql: 'SELECT sanity_staff_id FROM staff_identity WHERE okta_login = ? LIMIT 1',
    args: [login.trim().toLowerCase()],
  });
  return (r.rows[0]?.sanity_staff_id as string) ?? null;
}

export async function fetchCard(staffId: string): Promise<StaffCard | null> {
  const q = `*[_id == $id][0]{_id,name,title,email,quote,quoteSource,departments,hidden,"imageUrl":image.asset->url}`;
  const url = new URL(`https://${PROJECT}.api.sanity.io/v2024-06-20/data/query/${DATASET}`);
  url.searchParams.set('query', q);
  url.searchParams.set('$id', JSON.stringify(staffId));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${WRITE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status}`);
  return (await res.json()).result ?? null;
}

/**
 * Patches a staff document.
 *
 * Callers must have already established that the requester is allowed to touch
 * this document and these fields — this function does no authorisation of its
 * own, and the allow-list below is a backstop against a caller passing through
 * more than it meant to, not a substitute for that check.
 */
const PATCHABLE = new Set(['quote', 'quoteSource', 'title', 'departments']);

export async function patchCard(staffId: string, fields: Record<string, unknown>) {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (PATCHABLE.has(k)) set[k] = v;
  }
  if (!Object.keys(set).length) return { patched: false };

  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/data/mutate/${DATASET}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WRITE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mutations: [{ patch: { id: staffId, set } }] }),
    }
  );
  if (!res.ok) throw new Error(`Sanity mutate failed: ${res.status} ${await res.text()}`);
  return { patched: true, fields: Object.keys(set) };
}
