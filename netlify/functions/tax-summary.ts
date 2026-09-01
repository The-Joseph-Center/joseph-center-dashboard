import Stripe from 'stripe';
import { requireCapability, denial } from './_lib/verify-okta';

/**
 * Year-end giving: what each donor gave, and what the organization received.
 *
 * Read from Stripe rather than the Turso `donations` table, because Turso only
 * holds gifts made through the current on-site flow. The nine Harness-era
 * recurring donors have no rows there at all, and their gifts are real money
 * that belongs on both an acknowledgment letter and the 990. Stripe is the
 * complete record; Turso is the part of it this site created.
 *
 * Every charge in this account is a gift — checked, not assumed. The
 * descriptions span "(no description)", "Subscription update", "Harness Custom
 * Donation" and one 2024 charge labelled "Payment for Invoice", whose invoice
 * line reads "Giving Amount". Recurring gifts bill through Stripe invoices, so
 * being invoice-linked says nothing about whether something is a donation. If a
 * non-gift payment is ever taken through this account, this is the assumption
 * that has to change.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * The Denver window for a calendar year, in unix seconds.
 *
 * Both boundaries fall on 1 January, which is always MST (UTC-7) — daylight
 * saving never applies at a year boundary, so this is exact rather than
 * approximate. A gift made at 5pm on 31 December is that year's gift, and a
 * receipt that says otherwise is wrong in the way that matters to a donor.
 */
const MST_OFFSET = 7 * 3600;
const yearWindow = (year: number) => ({
  start: Math.floor(Date.UTC(year, 0, 1) / 1000) + MST_OFFSET,
  end: Math.floor(Date.UTC(year + 1, 0, 1) / 1000) + MST_OFFSET,
});

/**
 * The IRS threshold above which a donor needs a written acknowledgment from the
 * charity to claim the deduction (Publication 1771). Surfaced so the list can
 * be filtered, not as tax advice — the bookkeeper confirms the treatment.
 *
 * It is NOT who gets a letter. Mona writes to every donor regardless of amount;
 * the threshold only marks which of those letters the IRS additionally
 * requires. The export defaults to everyone and carries the flag as a column so
 * the required subset can still be filtered out in a spreadsheet.
 */
const ACKNOWLEDGMENT_THRESHOLD_CENTS = 25000;

interface DonorRow {
  key: string; name: string; email: string;
  address: string; city: string; state: string; zip: string;
  gifts: number; totalCents: number; refundedCents: number;
  firstGift: number; lastGift: number; recurring: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'taxData');
  if (!auth.ok) return denial(auth);

  const config = process.env.JC_STRIPE_CONFIG;
  if (!config) {
    console.error('tax-summary: JC_STRIPE_CONFIG is not set');
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Giving is not configured' }) };
  }

  try {
    const { secretKey } = JSON.parse(config) as { secretKey: string };
    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });

    const q = event.queryStringParameters ?? {};
    const thisYear = new Date(Date.now() - MST_OFFSET * 1000).getUTCFullYear();
    const year = Number(q.year) || thisYear;
    const { start, end } = yearWindow(year);

    const donors = new Map<string, DonorRow>();
    const byMonth = Array<number>(12).fill(0);
    let grossCents = 0, refundedCents = 0, gifts = 0, largest = 0, recurringCents = 0;

    for await (const charge of stripe.charges.list({
      created: { gte: start, lt: end },
      limit: 100,
      expand: ['data.customer'],
    })) {
      if (charge.status !== 'succeeded' || !charge.paid) continue;

      // Net of refunds. There have been none to date, which is exactly why this
      // has to be right now — the year it first happens, a receipt built on the
      // gross figure overstates what the donor may claim.
      const net = charge.amount - (charge.amount_refunded ?? 0);
      if (net <= 0) {
        refundedCents += charge.amount_refunded ?? 0;
        continue;
      }

      const customer = charge.customer && typeof charge.customer === 'object' && !charge.customer.deleted
        ? (charge.customer as Stripe.Customer)
        : null;
      const meta = charge.metadata ?? {};
      const billing = charge.billing_details;

      // Harness never populated the customer record but wrote donor identity
      // onto every charge it created, so metadata is the last resort rather
      // than an afterthought.
      const email = (
        str(customer?.email) || str(billing?.email) || str(charge.receipt_email) || str(meta.donor_email)
      ).toLowerCase();
      const name =
        str(customer?.name) || str(billing?.name) ||
        [str(meta.first_name), str(meta.last_name)].filter(Boolean).join(' ');
      const addr = customer?.address ?? billing?.address ?? null;

      // One person, one line. Prefer the customer id — an individual can have
      // more than one email on file, and a receipt split across two lines is
      // both wrong and impossible to explain.
      const key = customer?.id || email || `charge:${charge.id}`;

      const row = donors.get(key) ?? {
        key, name, email,
        address: '', city: '', state: '', zip: '',
        gifts: 0, totalCents: 0, refundedCents: 0,
        firstGift: charge.created, lastGift: charge.created, recurring: false,
      };
      row.gifts += 1;
      row.totalCents += net;
      row.refundedCents += charge.amount_refunded ?? 0;
      row.firstGift = Math.min(row.firstGift, charge.created);
      row.lastGift = Math.max(row.lastGift, charge.created);
      if (charge.invoice) row.recurring = true;
      // Fill identity from whichever charge actually carries it.
      if (!row.name && name) row.name = name;
      if (!row.email && email) row.email = email;
      if (!row.address && addr?.line1) {
        row.address = [addr.line1, addr.line2].filter(Boolean).join(', ');
        row.city = str(addr.city); row.state = str(addr.state); row.zip = str(addr.postal_code);
      }
      donors.set(key, row);

      grossCents += net;
      refundedCents += charge.amount_refunded ?? 0;
      gifts += 1;
      largest = Math.max(largest, net);
      if (charge.invoice) recurringCents += net;
      byMonth[new Date((charge.created - MST_OFFSET) * 1000).getUTCMonth()] += net;
    }

    const rows = [...donors.values()].sort((a, b) => b.totalCents - a.totalCents);
    const needsLetter = rows.filter((r) => r.totalCents >= ACKNOWLEDGMENT_THRESHOLD_CENTS);

    if (q.format === 'csv') {
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      // 'threshold' narrows to the IRS-required subset; anything else is the
      // full list, because the full list is the letter list.
      const wanted = q.scope === 'threshold' ? needsLetter : rows;
      const csv = [
        ['Name', 'Email', 'Address', 'City', 'State', 'ZIP', 'Gifts', 'Total',
         'First gift', 'Last gift', 'Recurring', 'IRS acknowledgment required'].join(','),
        ...wanted.map((r) => [
          r.name, r.email, r.address, r.city, r.state, r.zip, r.gifts,
          (r.totalCents / 100).toFixed(2),
          new Date(r.firstGift * 1000).toISOString().slice(0, 10),
          new Date(r.lastGift * 1000).toISOString().slice(0, 10),
          r.recurring ? 'Yes' : 'No',
          r.totalCents >= ACKNOWLEDGMENT_THRESHOLD_CENTS ? 'Yes' : 'No',
        ].map(esc).join(',')),
      ].join('\n');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="giving-${year}${q.scope === 'threshold' ? '-acknowledgments' : '-donor-letters'}.csv"`,
        },
        body: csv,
      };
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        year,
        years: Array.from({ length: thisYear - 2020 }, (_, i) => thisYear - i),
        org: {
          grossCents, refundedCents, gifts,
          donorCount: rows.length,
          averageCents: gifts ? Math.round(grossCents / gifts) : 0,
          largestCents: largest,
          recurringCents, oneTimeCents: grossCents - recurringCents,
          byMonth,
        },
        donors: rows,
        needsLetterCount: needsLetter.length,
        thresholdCents: ACKNOWLEDGMENT_THRESHOLD_CENTS,
      }),
    };
  } catch (err) {
    console.error('tax-summary:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load giving totals' }) };
  }
}
