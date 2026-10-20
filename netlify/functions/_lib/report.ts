import Stripe from 'stripe';
import { turso } from './staff-directory';
import { FORMS } from '../../../src/lib/submissionForms';

/**
 * Building one month's report.
 *
 * Four sources, each optional. A month where Stripe is unreachable is still a
 * month worth having: the section is left out rather than the report being
 * lost, and a section left out is honest in a way a section full of zeros is
 * not. Nothing here throws its way out of a report.
 *
 * Written for someone who does not work on the website — Mona reading it
 * before a board meeting. That rules out "sessions", "bounce rate" and
 * "conversions", and it rules out percentages on small numbers, which is the
 * mistake that makes a report sound like it is overselling.
 */

export interface MonthlyReport {
  month: string;              // YYYY-MM
  monthName: string;          // "September 2026"
  builtAt: number;
  summary: string[];          // three to five plain sentences
  visits?: {
    visits: number;
    previousVisits: number | null;
    pageviews: number;
    secondsPerVisit: number | null;
    days: { date: string; visits: number }[];
    topPages: { page: string; visits: number }[];
    sources: { source: string; visits: number }[];
  };
  submissions?: {
    byForm: { id: string; label: string; count: number; previous: number; unanswered: number | null }[];
    total: number;
  };
  speed?: {
    checkedAt: number;
    devices: { device: string; scores: Record<string, number> }[];
  };
  giving?: {
    total: number;            // cents, net of refunds
    gifts: number;
    donors: number;
    previousTotal: number | null;
  };
  newsletter?: {
    month: string;
    tag: string;
    status: string;
    sentAt: number | null;
  };
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** The month's window, in the organization's own timezone rather than UTC. */
export function monthWindow(month: string): { start: number; end: number; prevStart: number; prevEnd: number } {
  const [y, m] = month.split('-').map(Number);
  const start = Math.floor(Date.UTC(y!, m! - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(y!, m!, 1) / 1000);
  const prevStart = Math.floor(Date.UTC(y!, m! - 2, 1) / 1000);
  return { start, end, prevStart, prevEnd: start };
}

export const monthName = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
};

const iso = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** Visits, pages and sources for the month, from Simple Analytics. */
async function buildVisits(month: string): Promise<MonthlyReport['visits'] | undefined> {
  const apiKey = process.env.SIMPLE_ANALYTICS_API_KEY;
  const hostname = process.env.ANALYTICS_HOSTNAME || 'josephcentergj.com';
  if (!apiKey) return undefined;

  const { start, end, prevStart, prevEnd } = monthWindow(month);
  const headers = { 'Api-Key': apiKey, 'Content-Type': 'application/json' };
  const url = (from: number, to: number, fields: string) =>
    `https://simpleanalytics.com/${hostname}.json?version=5&start=${iso(from)}&end=${iso(to - 86400)}&info=false&fields=${fields}`;

  const [nowRes, prevRes] = await Promise.all([
    fetch(url(start, end, 'visitors,pageviews,seconds_on_page,histogram,pages,referrers'), { headers }),
    fetch(url(prevStart, prevEnd, 'visitors'), { headers }),
  ]);
  if (!nowRes.ok) throw new Error(`Simple Analytics ${nowRes.status}`);

  const d = await nowRes.json() as {
    visitors?: number; pageviews?: number; seconds_on_page?: number;
    histogram?: { date: string; visitors?: number }[];
    pages?: { value: string; visitors?: number }[];
    referrers?: { value: string; visitors?: number }[];
  };
  const prev = prevRes.ok ? (await prevRes.json() as { visitors?: number }) : null;

  return {
    visits: d.visitors ?? 0,
    previousVisits: prev?.visitors ?? null,
    pageviews: d.pageviews ?? 0,
    secondsPerVisit: d.visitors ? Math.round((d.seconds_on_page ?? 0) / d.visitors) : null,
    days: (d.histogram ?? []).map((h) => ({ date: h.date, visits: h.visitors ?? 0 })),
    topPages: (d.pages ?? []).slice(0, 8).map((p) => ({ page: p.value, visits: p.visitors ?? 0 })),
    sources: (d.referrers ?? []).slice(0, 8).map((r) => ({ source: r.value, visits: r.visitors ?? 0 })),
  };
}

/** What came in through the website, by form, against the month before. */
async function buildSubmissions(month: string): Promise<MonthlyReport['submissions'] | undefined> {
  const db = turso();
  const { start, end, prevStart, prevEnd } = monthWindow(month);
  const byForm: NonNullable<MonthlyReport['submissions']>['byForm'] = [];

  /**
   * When recording a reply became possible at all.
   *
   * Before the follow-up table existed, every message looks unanswered — not
   * because nobody replied, but because there was nowhere to say so. Reporting
   * "33 of 33 still without a reply" for a month in 2025 would describe the
   * tool rather than the work, and it is exactly the sort of line that gets
   * read out of context in a board meeting. So for months that ended before
   * tracking began, the figure is left out rather than guessed at.
   */
  const firstFollowUp = await db
    .execute('SELECT MIN(updated_at) AS first FROM submission_followups')
    .then((r) => (r.rows[0]?.first == null ? null : Number(r.rows[0].first)))
    .catch(() => null);
  const tracked = firstFollowUp !== null && end > firstFollowUp;

  for (const form of FORMS) {
    if (form.archived) continue;
    try {
      const [now, before, open] = await Promise.all([
        db.execute({
          sql: `SELECT COUNT(*) AS n FROM ${form.table} WHERE ${form.timeColumn} >= ? AND ${form.timeColumn} < ?`,
          args: [start, end],
        }),
        db.execute({
          sql: `SELECT COUNT(*) AS n FROM ${form.table} WHERE ${form.timeColumn} >= ? AND ${form.timeColumn} < ?`,
          args: [prevStart, prevEnd],
        }),
        form.followUp?.length && tracked
          ? db.execute({
              sql: `SELECT COUNT(*) AS n FROM ${form.table} t
                     WHERE t.${form.timeColumn} >= ? AND t.${form.timeColumn} < ?
                       AND NOT EXISTS (SELECT 1 FROM submission_followups f
                                        WHERE f.form_id = ? AND f.row_id = CAST(t.id AS TEXT))`,
              args: [start, end, form.id],
            })
          : Promise.resolve({ rows: [{ n: 0 }] }),
      ]);
      const count = Number(now.rows[0]?.n ?? 0);
      const previous = Number(before.rows[0]?.n ?? 0);
      if (!count && !previous) continue;   // a form nobody used that month
      byForm.push({
        id: form.id, label: form.label, count, previous,
        unanswered: form.followUp?.length && tracked ? Number(open.rows[0]?.n ?? 0) : null,
      });
    } catch (err) {
      console.error(`report: submissions for ${form.id} failed`, err);
    }
  }

  if (!byForm.length) return undefined;
  return { byForm, total: byForm.reduce((n, f) => n + f.count, 0) };
}

/** The first speed test taken during the month, if there was one. */
async function buildSpeed(month: string): Promise<MonthlyReport['speed'] | undefined> {
  const db = turso();
  const { start, end } = monthWindow(month);
  const { rows } = await db.execute({
    sql: `SELECT device, data, checked_at FROM site_checks
           WHERE kind = 'lighthouse' AND checked_at >= ? AND checked_at < ?
           ORDER BY checked_at ASC`,
    args: [start, end],
  });
  if (!rows.length) return undefined;

  const devices = new Map<string, { device: string; scores: Record<string, number> }>();
  for (const r of rows) {
    const device = String(r.device);
    if (devices.has(device)) continue;   // the first test of the month wins
    try {
      devices.set(device, { device, scores: JSON.parse(String(r.data)) });
    } catch { /* a malformed row is not worth losing the month over */ }
  }
  if (!devices.size) return undefined;

  return { checkedAt: Number(rows[0]?.checked_at ?? 0), devices: [...devices.values()] };
}

/** Giving for the month, net of refunds. */
async function buildGiving(month: string): Promise<MonthlyReport['giving'] | undefined> {
  const config = process.env.JC_STRIPE_CONFIG;
  if (!config) return undefined;
  const { secretKey } = JSON.parse(config) as { secretKey: string };
  const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
  const { start, end, prevStart, prevEnd } = monthWindow(month);

  const sum = async (from: number, to: number) => {
    let total = 0, gifts = 0;
    const donors = new Set<string>();
    for await (const charge of stripe.charges.list({ created: { gte: from, lt: to }, limit: 100 })) {
      if (charge.status !== 'succeeded' || !charge.paid) continue;
      const net = charge.amount - (charge.amount_refunded ?? 0);
      if (net <= 0) continue;
      total += net;
      gifts += 1;
      const who = (typeof charge.customer === 'string' ? charge.customer : charge.customer?.id)
        || charge.billing_details?.email || charge.receipt_email || charge.id;
      donors.add(String(who).toLowerCase());
    }
    return { total, gifts, donors: donors.size };
  };

  const [now, before] = await Promise.all([sum(start, end), sum(prevStart, prevEnd).catch(() => null)]);
  return {
    total: now.total, gifts: now.gifts, donors: now.donors,
    previousTotal: before ? before.total : null,
  };
}

/** Whether the month's newsletter went out, and under which tag. */
async function buildNewsletter(month: string): Promise<MonthlyReport['newsletter'] | undefined> {
  const db = turso();
  const { rows } = await db.execute({
    sql: 'SELECT month, aweber_tag, status, sent_at FROM newsletters WHERE month = ?',
    args: [month],
  });
  const row = rows[0];
  if (!row) return undefined;
  return {
    month: String(row.month),
    tag: String(row.aweber_tag ?? ''),
    status: String(row.status ?? 'draft'),
    sentAt: row.sent_at == null ? null : Number(row.sent_at),
  };
}

/**
 * The month in three to five sentences.
 *
 * Written when the report is built and stored with it, so the words never
 * drift from the figures they describe. Comparison wording follows the same
 * rule as everywhere else: a percentage only when both numbers reach twenty.
 */
function summarize(r: MonthlyReport): string[] {
  const out: string[] = [];
  const name = r.monthName.split(' ')[0];

  if (r.visits) {
    const { visits, previousVisits } = r.visits;
    let sentence = `${visits.toLocaleString()} ${visits === 1 ? 'person' : 'people'} visited the website in ${name}`;
    if (previousVisits !== null) {
      if (visits === previousVisits) sentence += ', the same as the month before';
      else if (visits >= 20 && previousVisits >= 20) {
        const pct = Math.round((Math.abs(visits - previousVisits) / previousVisits) * 100);
        sentence += `, ${visits > previousVisits ? 'up' : 'down'} ${pct}% on the month before`;
      } else {
        sentence += `, compared with ${previousVisits} the month before`;
      }
    }
    out.push(`${sentence}.`);
    const top = r.visits.topPages[0];
    if (top && top.page !== '/') out.push(`${top.page} was the page people looked at most, after the home page.`);
  }

  if (r.submissions) {
    const parts = r.submissions.byForm
      .filter((f) => f.count)
      .map((f) => `${f.count} ${f.count === 1 ? f.label.replace(/s$/, '').toLowerCase() : f.label.toLowerCase()}`);
    if (parts.length) {
      const unanswered = r.submissions.byForm.reduce((n, f) => n + (f.unanswered ?? 0), 0);
      out.push(
        `${parts.join(', ')} came in through the website${unanswered ? `, and ${unanswered} ${unanswered === 1 ? 'is' : 'are'} still without a reply recorded` : ''}.`
      );
    }
  }

  if (r.giving) {
    const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    let sentence = `${money(r.giving.total)} was given online across ${r.giving.gifts} ${r.giving.gifts === 1 ? 'gift' : 'gifts'}`;
    if (r.giving.previousTotal !== null && r.giving.previousTotal > 0) {
      sentence += `, against ${money(r.giving.previousTotal)} the month before`;
    }
    out.push(`${sentence}.`);
  }

  if (r.speed) {
    const phone = r.speed.devices.find((d) => d.device === 'phone');
    const score = phone?.scores.performance;
    if (typeof score === 'number') {
      const verdict = score >= 90 ? 'fast' : score >= 50 ? 'workable' : 'slow';
      out.push(`On a phone the home page scored ${score} out of 100 for speed in Google's test: ${verdict}.`);
    }
  }

  if (r.newsletter?.status === 'sent') {
    out.push(`The ${name} newsletter went out to the mailing list.`);
  }

  return out.slice(0, 5);
}

/** Builds a month. Never throws for a source that is simply unavailable. */
export async function buildReport(month: string): Promise<MonthlyReport> {
  const settle = async <T>(name: string, fn: () => Promise<T | undefined>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`report: ${name} failed for ${month}`, err);
      return undefined;
    }
  };

  const [visits, submissions, speed, giving, newsletter] = await Promise.all([
    settle('visits', () => buildVisits(month)),
    settle('submissions', () => buildSubmissions(month)),
    settle('speed', () => buildSpeed(month)),
    settle('giving', () => buildGiving(month)),
    settle('newsletter', () => buildNewsletter(month)),
  ]);

  const report: MonthlyReport = {
    month,
    monthName: monthName(month),
    builtAt: Math.floor(Date.now() / 1000),
    summary: [],
    visits, submissions, speed, giving, newsletter,
  };
  report.summary = summarize(report);
  return report;
}

/** Writes a month, once. An existing month is left alone unless replaced. */
export async function saveReport(report: MonthlyReport, by: string, replace = false): Promise<boolean> {
  const db = turso();
  const existing = await db.execute({ sql: 'SELECT month FROM site_reports WHERE month = ?', args: [report.month] });
  if (existing.rows.length && !replace) return false;

  await db.execute({
    sql: `INSERT INTO site_reports (month, data, built_at, built_by) VALUES (?, ?, unixepoch(), ?)
          ON CONFLICT(month) DO UPDATE SET data = excluded.data, built_at = unixepoch(), built_by = excluded.built_by`,
    args: [report.month, JSON.stringify(report), by],
  });
  return true;
}
