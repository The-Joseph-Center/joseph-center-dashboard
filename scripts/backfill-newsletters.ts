/**
 * Creates a row per past newsletter, February to August 2026.
 *
 * Those newsletters were sent as AWeber automation workflows, three per month,
 * one per tier. AWeber's API exposes a workflow's tag, its message subjects and
 * its send and open counts, but there is no endpoint that returns a message
 * body — so the copy is not recoverable and has to be pasted in by hand. What
 * this fills in is everything else: the tag history (which is what stops a tag
 * being reused), the send dates, and how each month performed.
 *
 * The figures below were read from the AWeber API on 23 September 2026 and are
 * written out here rather than fetched, so running this needs no AWeber
 * credentials and gives the same result every time.
 *
 * Existing rows are never overwritten. A month already in the table is left
 * exactly as it is, including a blank one someone has started.
 *
 * Run from dashboard/:
 *   npx tsx scripts/backfill-newsletters.ts              # preview
 *   APPLY=yes npx tsx scripts/backfill-newsletters.ts    # write
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const APPLY = process.env.APPLY === 'yes';

interface Tier { tier: string; subject: string; sends: number; uniqueOpens: number; uniqueClicks: number }
interface Past { month: string; tag: string; sentAt: string; note?: string; tiers: Tier[] }

const PAST: Past[] = [
  {
    month: '2026-02', tag: 'feb-newsletter', sentAt: '2026-02-27',
    note: 'Sent as a single message to the whole list — the three-tier split started in March.',
    tiers: [
      { tier: 'all', subject: 'February Newsletter', sends: 62, uniqueOpens: 16, uniqueClicks: 2 },
    ],
  },
  {
    month: '2026-03', tag: 'mar-newsletter', sentAt: '2026-03-17',
    tiers: [
      { tier: 'community-friend', subject: 'March at The Joseph Center', sends: 59, uniqueOpens: 16, uniqueClicks: 1 },
      { tier: 'donor', subject: 'Because of you: March at The Joseph Center', sends: 136, uniqueOpens: 67, uniqueClicks: 7 },
      { tier: 'recurring-donor', subject: 'Your impact this March at The Joseph Center', sends: 15, uniqueOpens: 8, uniqueClicks: 0 },
    ],
  },
  {
    month: '2026-04', tag: 'apr-newsletter', sentAt: '2026-04-29',
    note: 'AWeber records 0 sends on all three versions — the workflows were published but the tag appears never to have been applied. Worth checking before treating April as sent.',
    tiers: [
      { tier: 'community-friend', subject: 'April at The Joseph Center', sends: 0, uniqueOpens: 0, uniqueClicks: 0 },
      { tier: 'donor', subject: 'Because of You: April at The Joseph Center', sends: 0, uniqueOpens: 0, uniqueClicks: 0 },
      { tier: 'recurring-donor', subject: 'Your impact this April at The Joseph Center', sends: 0, uniqueOpens: 0, uniqueClicks: 0 },
    ],
  },
  {
    month: '2026-05', tag: 'may-newsletter', sentAt: '2026-05-27',
    tiers: [
      { tier: 'community-friend', subject: 'May at The Joseph Center', sends: 65, uniqueOpens: 18, uniqueClicks: 2 },
      { tier: 'donor', subject: 'Because of you: May at The Joseph Center', sends: 133, uniqueOpens: 63, uniqueClicks: 4 },
      { tier: 'recurring-donor', subject: 'Your impact this May at The Joseph Center', sends: 15, uniqueOpens: 6, uniqueClicks: 1 },
    ],
  },
  {
    month: '2026-06', tag: 'jun-newsletter', sentAt: '2026-06-26',
    tiers: [
      { tier: 'community-friend', subject: 'June at The Joseph Center', sends: 73, uniqueOpens: 28, uniqueClicks: 1 },
      { tier: 'donor', subject: 'Because of you: June at The Joseph Center', sends: 132, uniqueOpens: 75, uniqueClicks: 7 },
      { tier: 'recurring-donor', subject: 'Your impact this June at The Joseph Center', sends: 15, uniqueOpens: 7, uniqueClicks: 1 },
    ],
  },
  {
    month: '2026-07', tag: 'jul-newsletter', sentAt: '2026-07-29',
    tiers: [
      { tier: 'community-friend', subject: 'July at The Joseph Center', sends: 76, uniqueOpens: 28, uniqueClicks: 4 },
      { tier: 'donor', subject: 'Because of you: July at The Joseph Center', sends: 130, uniqueOpens: 73, uniqueClicks: 6 },
      { tier: 'recurring-donor', subject: 'Your impact this July at The Joseph Center', sends: 15, uniqueOpens: 9, uniqueClicks: 2 },
    ],
  },
  {
    month: '2026-08', tag: 'aug-newsletter', sentAt: '2026-08-27',
    tiers: [
      { tier: 'community-friend', subject: 'August at The Joseph Center', sends: 82, uniqueOpens: 36, uniqueClicks: 3 },
      { tier: 'donor', subject: 'Because of you: August at The Joseph Center', sends: 128, uniqueOpens: 69, uniqueClicks: 3 },
      { tier: 'recurring-donor', subject: 'Your impact this August at The Joseph Center', sends: 15, uniqueOpens: 9, uniqueClicks: 0 },
    ],
  },
];

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

const db = createClient({
  url: env.TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL!,
  authToken: env.TURSO_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN!,
});

async function run() {
  const existing = new Set(
    (await db.execute('SELECT month FROM newsletters')).rows.map((r) => String(r.month))
  );

  // The workbench is where the tool keeps a month's working materials, so the
  // AWeber record travels with the newsletter instead of living in a spreadsheet.
  const hasWorkbench = (await db.execute('PRAGMA table_info(newsletters)'))
    .rows.some((r) => String(r.name) === 'workbench');
  if (!hasWorkbench) {
    console.log('Note: the workbench column is missing — apply migration 019 first, or the AWeber record is dropped.\n');
  }

  for (const p of PAST) {
    if (existing.has(p.month)) {
      console.log(`${p.month}  already in the table — left alone`);
      continue;
    }

    const totalSends = p.tiers.reduce((n, t) => n + t.sends, 0);
    const totalOpens = p.tiers.reduce((n, t) => n + t.uniqueOpens, 0);
    console.log(
      `${p.month}  tag ${p.tag}, sent ${p.sentAt}, ${p.tiers.length} version(s), ` +
      `${totalSends} sends, ${totalOpens} opens${p.note ? `\n          ${p.note}` : ''}`
    );
    if (!APPLY) continue;

    const workbench = JSON.stringify({
      aweber: {
        source: 'AWeber automation workflows, read 2026-09-23',
        note: p.note ?? null,
        bodyUnavailable: 'AWeber does not expose message bodies through its API — paste the copy in by hand.',
        tiers: p.tiers,
      },
    });

    const cols = ['month', 'aweber_tag', 'status', 'sent_at', 'section1', 'section2', 'stats', 'videos', 'partners', 'preview_text', 'updated_by'];
    const args: (string | number)[] = [
      p.month, p.tag, 'sent', Math.floor(new Date(`${p.sentAt}T12:00:00Z`).getTime() / 1000),
      '', '', '{}', '[]', '[]', '', 'backfill from AWeber',
    ];
    if (hasWorkbench) { cols.splice(10, 0, 'workbench'); args.splice(10, 0, workbench); }

    await db.execute({
      sql: `INSERT INTO newsletters (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`,
      args,
    });
  }

  console.log(APPLY ? '\nDone.' : '\nPreview only — run again with APPLY=yes to write.');
}

run().catch((e) => { console.error(e); process.exit(1); });
