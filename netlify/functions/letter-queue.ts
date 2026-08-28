import { requireCapability, denial } from './_lib/verify-okta';
import { turso } from './_lib/staff-directory';

/**
 * Mona's year-end letters.
 *
 * The form promises "Mona personally writes to our financial partners at the
 * end of each year", so this is an annual batch worked through by hand over
 * several sittings — not a rolling inbox. What the form could not record is
 * where she got to, which is the only thing standing between resuming and
 * remembering which names were already done.
 *
 * Grouped by year for the same reason the submissions inbox is: a request that
 * arrives at 4:30pm on 31 December belongs to that year's letters, and the
 * server runs in UTC where it would not.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const LOCAL_YEAR = "strftime('%Y', submitted_at, 'unixepoch', '-7 hours')";

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

interface Row {
  id: string; first_name: string; last_name: string;
  street: string; city: string; state: string; zip: string; email: string;
  submitted_at: number; written_at: number | null; written_by: string | null; note: string | null;
}

/**
 * Requests that look like the same person twice.
 *
 * People resubmit — they forget they already did, or correct a typo by filling
 * the form again. Writing two letters to one address is the visible mistake;
 * the quieter one is posting to a superseded address. Matched on email or on
 * name-plus-address within the same year, and only ever flagged: which of two
 * near-identical entries is the current one is not a call to make automatically.
 */
function markDuplicates(rows: Row[]) {
  const key = (r: Row, kind: 'email' | 'addr') =>
    kind === 'email'
      ? (r.email || '').toLowerCase().trim()
      : `${r.first_name} ${r.last_name} ${r.street} ${r.zip}`.toLowerCase().replace(/\s+/g, ' ').trim();

  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const kind of ['email', 'addr'] as const) {
      const k = `${kind}:${key(r, kind)}`;
      if (key(r, kind)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return rows.map((r) => ({
    ...r,
    duplicate:
      (counts.get(`email:${key(r, 'email')}`) ?? 0) > 1 ||
      (counts.get(`addr:${key(r, 'addr')}`) ?? 0) > 1,
  }));
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'letterQueue');
  if (!auth.ok) return denial(auth);

  try {
    const db = turso();

    if (event.httpMethod === 'GET') {
      const years = (await db.execute(
        `SELECT DISTINCT ${LOCAL_YEAR} AS y FROM letter_requests ORDER BY y DESC`
      )).rows.map((r) => String(r.y)).filter(Boolean);

      const q = event.queryStringParameters ?? {};
      const year = q.year && years.includes(String(Number(q.year))) ? String(Number(q.year)) : years[0] ?? '';

      const rows = year
        ? (await db.execute({
            sql: `SELECT id, first_name, last_name, street, city, state, zip, email,
                         submitted_at, written_at, written_by, note
                  FROM letter_requests
                  WHERE ${LOCAL_YEAR} = ?
                  ORDER BY written_at IS NOT NULL, last_name COLLATE NOCASE, first_name COLLATE NOCASE`,
            args: [year],
          })).rows as unknown as Row[]
        : [];

      // Whether each person is a known donor. The letter goes to financial
      // partners, so a request from someone with no donation on record is worth
      // seeing — not to exclude them, but so it is a decision rather than a
      // surprise. Matched on email, which is what the form asks for and says it
      // uses "to match your donation record".
      const donorEmails = new Set(
        (await db.execute("SELECT LOWER(TRIM(email)) AS e FROM donors WHERE email IS NOT NULL AND email != ''"))
          .rows.map((r) => String(r.e))
      );

      const marked = markDuplicates(rows).map((r) => ({
        ...r,
        isDonor: donorEmails.has((r.email || '').toLowerCase().trim()),
      }));

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          year, years, rows: marked,
          total: marked.length,
          written: marked.filter((r) => r.written_at).length,
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const id = clean(body.id, 64);
    if (!id) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing id' }) };
    }

    // Marking written records who and when. Several people can reach this queue
    // and the year-end run spans weeks — "who ticked this" is the question that
    // gets asked when two people think they did the same name.
    if (body.written === true) {
      await db.execute({
        sql: 'UPDATE letter_requests SET written_at = unixepoch(), written_by = ? WHERE id = ?',
        args: [auth.email ?? 'unknown', id],
      });
    } else if (body.written === false) {
      await db.execute({
        sql: 'UPDATE letter_requests SET written_at = NULL, written_by = NULL WHERE id = ?',
        args: [id],
      });
    }
    if (typeof body.note === 'string') {
      await db.execute({ sql: 'UPDATE letter_requests SET note = ? WHERE id = ?', args: [clean(body.note, 500), id] });
    }

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: true }) };
  } catch (err) {
    console.error('letter-queue:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load the letter queue' }) };
  }
}
