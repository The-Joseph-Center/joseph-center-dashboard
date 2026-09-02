import Stripe from 'stripe';
import { requireCapability, denial } from './_lib/verify-okta';
import { turso } from './_lib/staff-directory';

/**
 * Mona's year-end letters — the whole list, not just the people who asked.
 *
 * This page used to show the personal-letter request form and nothing else,
 * which meant it listed a handful of people and omitted almost everyone Mona
 * actually writes to. She writes to every donor; the request form is one small
 * input to that list rather than the list itself.
 *
 * So the queue is built from two sources and merged:
 *   • every donor who gave in the year, read live from Stripe
 *   • everyone who submitted the "personal letter from Mona" form that year
 *
 * Someone in both is one letter, not two. Merged on email, which is the only
 * identifier the two sources share.
 *
 * Where both carry an address, the requested one wins: it was given
 * specifically as "send my letter here", where the Stripe address is whatever
 * was on the card. That is the one case where the newer, more deliberate
 * answer should beat the transactional one.
 *
 * The $250 threshold is shown but decides nothing. It is an IRS rule about
 * which acknowledgments are additionally required, not about who is worth
 * thanking — see tax-summary.ts.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MST_OFFSET = 7 * 3600;
const ACKNOWLEDGMENT_THRESHOLD_CENTS = 25000;
const LOCAL_YEAR = "strftime('%Y', submitted_at, 'unixepoch', '-7 hours')";

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const json = (statusCode: number, body: unknown) => ({
  statusCode, headers: JSON_HEADERS, body: JSON.stringify(body),
});

const yearWindow = (year: number) => ({
  start: Math.floor(Date.UTC(year, 0, 1) / 1000) + MST_OFFSET,
  end: Math.floor(Date.UTC(year + 1, 0, 1) / 1000) + MST_OFFSET,
});

interface Recipient {
  key: string;
  name: string;
  email: string;
  street: string; city: string; state: string; zip: string;
  totalCents: number;
  gifts: number;
  recurring: boolean;
  /** They filled in the "personal letter from Mona" form. */
  requested: boolean;
  /** They gave money this year. Someone can be a requester and not a donor. */
  isDonor: boolean;
  writtenAt: number | null;
  writtenBy: string | null;
  note: string | null;
}

/** Everyone who gave in the year, one row per person. */
async function donorsForYear(year: number): Promise<Map<string, Recipient>> {
  const config = process.env.JC_STRIPE_CONFIG;
  if (!config) throw new Error('Giving is not configured');
  const { secretKey } = JSON.parse(config) as { secretKey: string };
  const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
  const { start, end } = yearWindow(year);

  const out = new Map<string, Recipient>();
  for await (const charge of stripe.charges.list({
    created: { gte: start, lt: end }, limit: 100, expand: ['data.customer'],
  })) {
    if (charge.status !== 'succeeded' || !charge.paid) continue;
    const net = charge.amount - (charge.amount_refunded ?? 0);
    if (net <= 0) continue;

    const customer = charge.customer && typeof charge.customer === 'object' && !charge.customer.deleted
      ? charge.customer : null;
    const meta = charge.metadata ?? {};
    const billing = charge.billing_details;

    // Harness left the customer record empty but wrote donor identity onto
    // every charge, so metadata is a real source rather than a fallback.
    const email = (
      str(customer?.email) || str(billing?.email) || str(charge.receipt_email) || str(meta.donor_email)
    ).toLowerCase();
    const name = str(customer?.name) || str(billing?.name) ||
      [str(meta.first_name), str(meta.last_name)].filter(Boolean).join(' ');
    const addr = customer?.address ?? billing?.address ?? null;
    const key = customer?.id || email || `charge:${charge.id}`;

    const row = out.get(key) ?? {
      key, name, email, street: '', city: '', state: '', zip: '',
      totalCents: 0, gifts: 0, recurring: false,
      requested: false, isDonor: true,
      writtenAt: null, writtenBy: null, note: null,
    };
    row.totalCents += net;
    row.gifts += 1;
    if (charge.invoice) row.recurring = true;
    if (!row.name && name) row.name = name;
    if (!row.email && email) row.email = email;
    if (!row.street && addr?.line1) {
      row.street = [addr.line1, addr.line2].filter(Boolean).join(', ');
      row.city = str(addr.city); row.state = str(addr.state); row.zip = str(addr.postal_code);
    }
    out.set(key, row);
  }
  return out;
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

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const year = Number(body.year);
      const key = clean(body.key, 128);
      if (!year || !key) return json(400, { error: 'year and key are required' });

      // Recording who and when matters: the run spans weeks and more than one
      // person can reach this queue, so "who ticked this?" is the question
      // that gets asked when two people think they did the same name.
      const by = auth.email ?? 'unknown';
      const note = typeof body.note === 'string' ? clean(body.note, 500) || null : undefined;

      if (body.written === true) {
        await db.execute({
          sql: `INSERT INTO letter_log (year, recipient_key, written_at, written_by, note)
                VALUES (?, ?, unixepoch(), ?, ?)
                ON CONFLICT(year, recipient_key) DO UPDATE SET
                  written_at = unixepoch(), written_by = excluded.written_by,
                  note = COALESCE(excluded.note, letter_log.note)`,
          args: [year, key, by, note ?? null],
        });
      } else if (body.written === false) {
        await db.execute({
          sql: `INSERT INTO letter_log (year, recipient_key, written_at, written_by, note)
                VALUES (?, ?, NULL, NULL, ?)
                ON CONFLICT(year, recipient_key) DO UPDATE SET
                  written_at = NULL, written_by = NULL,
                  note = COALESCE(excluded.note, letter_log.note)`,
          args: [year, key, note ?? null],
        });
      } else if (note !== undefined) {
        await db.execute({
          sql: `INSERT INTO letter_log (year, recipient_key, note) VALUES (?, ?, ?)
                ON CONFLICT(year, recipient_key) DO UPDATE SET note = excluded.note`,
          args: [year, key, note],
        });
      }
      return json(200, { saved: true });
    }

    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

    const q = event.queryStringParameters ?? {};
    const thisYear = new Date(Date.now() - MST_OFFSET * 1000).getUTCFullYear();
    const year = Number(q.year) || thisYear;

    const [donors, requestRows, logRows] = await Promise.all([
      donorsForYear(year),
      db.execute({
        sql: `SELECT id, first_name, last_name, street, city, state, zip, email, submitted_at
              FROM letter_requests WHERE ${LOCAL_YEAR} = ? ORDER BY submitted_at`,
        args: [String(year)],
      }),
      db.execute({ sql: 'SELECT recipient_key, written_at, written_by, note FROM letter_log WHERE year = ?', args: [year] }),
    ]);

    const byEmail = new Map<string, Recipient>();
    for (const r of donors.values()) if (r.email) byEmail.set(r.email, r);

    for (const raw of requestRows.rows as unknown as Record<string, unknown>[]) {
      const email = str(raw.email).toLowerCase();
      const name = [str(raw.first_name), str(raw.last_name)].filter(Boolean).join(' ');
      const existing = email ? byEmail.get(email) : undefined;

      if (existing) {
        existing.requested = true;
        // The requested address was given as "send my letter here"; the Stripe
        // one is whatever was on the card.
        if (str(raw.street)) {
          existing.street = str(raw.street);
          existing.city = str(raw.city);
          existing.state = str(raw.state);
          existing.zip = str(raw.zip);
        }
        if (!existing.name) existing.name = name;
        continue;
      }

      const key = `req:${str(raw.id)}`;
      const rec: Recipient = {
        key, name, email,
        street: str(raw.street), city: str(raw.city), state: str(raw.state), zip: str(raw.zip),
        totalCents: 0, gifts: 0, recurring: false,
        requested: true, isDonor: false,
        writtenAt: null, writtenBy: null, note: null,
      };
      donors.set(key, rec);
      if (email) byEmail.set(email, rec);
    }

    const log = new Map(
      (logRows.rows as unknown as Record<string, unknown>[]).map((r) => [String(r.recipient_key), r])
    );
    for (const r of donors.values()) {
      const l = log.get(r.key);
      if (!l) continue;
      r.writtenAt = l.written_at == null ? null : Number(l.written_at);
      r.writtenBy = l.written_by == null ? null : String(l.written_by);
      r.note = l.note == null ? null : String(l.note);
    }

    // Unwritten first — the queue exists to be worked through — then by name.
    const rows = [...donors.values()].sort((a, b) =>
      (a.writtenAt ? 1 : 0) - (b.writtenAt ? 1 : 0) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    const years = Array.from({ length: thisYear - 2019 }, (_, i) => thisYear - i);

    if (q.format === 'csv') {
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        ['Name', 'Address', 'City', 'State', 'ZIP', 'Email', 'Gifts', 'Total',
         'Recurring', 'Asked for a letter', 'IRS acknowledgment required', 'Written', 'Written by', 'Note'].join(','),
        ...rows.map((r) => [
          r.name, r.street, r.city, r.state, r.zip, r.email, r.gifts,
          (r.totalCents / 100).toFixed(2),
          r.recurring ? 'Yes' : 'No',
          r.requested ? 'Yes' : 'No',
          r.totalCents >= ACKNOWLEDGMENT_THRESHOLD_CENTS ? 'Yes' : 'No',
          r.writtenAt ? new Date(r.writtenAt * 1000).toISOString().slice(0, 10) : '',
          r.writtenBy ?? '', r.note ?? '',
        ].map(esc).join(',')),
      ].join('\n');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="letters-${year}.csv"`,
        },
        body: csv,
      };
    }

    return json(200, {
      year, years, rows,
      thresholdCents: ACKNOWLEDGMENT_THRESHOLD_CENTS,
      summary: {
        total: rows.length,
        written: rows.filter((r) => r.writtenAt).length,
        noAddress: rows.filter((r) => !r.street).length,
        requested: rows.filter((r) => r.requested).length,
        irs: rows.filter((r) => r.totalCents >= ACKNOWLEDGMENT_THRESHOLD_CENTS).length,
      },
    });
  } catch (err) {
    console.error('letter-queue:', err);
    return json(500, { error: err instanceof Error ? err.message : 'Could not load the letter queue' });
  }
}
