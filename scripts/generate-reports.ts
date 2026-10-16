/**
 * Builds monthly reports by hand — for backfilling history, or for a month a
 * scheduled run missed.
 *
 * The scheduled function only ever writes the month that just ended, and only
 * runs on the deployed site. This reaches back as far as each source has data:
 * Simple Analytics and the submissions tables hold their own history, Stripe
 * holds every charge, but Lighthouse cannot be tested retroactively — so
 * months before the first speed test simply have no speed section.
 *
 * Run from dashboard/:
 *   npx tsx scripts/generate-reports.ts                 # last month, preview
 *   npx tsx scripts/generate-reports.ts 2026-09         # one month, preview
 *   npx tsx scripts/generate-reports.ts --last 12       # a year, preview
 *   APPLY=yes npx tsx scripts/generate-reports.ts --last 12   # write them
 *
 * APPLY writes only months that do not exist yet. Add REPLACE=yes to rewrite
 * one deliberately — which changes a report somebody may already have read.
 */
import fs from 'node:fs';

// The report builder reads its configuration from the environment, the same as
// it does on Netlify; loading .env here is what makes a local run possible at
// all. Values are never printed.
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const i = trimmed.indexOf('=');
  const key = trimmed.slice(0, i);
  if (!process.env[key]) process.env[key] = trimmed.slice(i + 1);
}

const { buildReport, saveReport, monthName } = await import('../netlify/functions/_lib/report.ts');

const APPLY = process.env.APPLY === 'yes';
const REPLACE = process.env.REPLACE === 'yes';

function monthsWanted(): string[] {
  const args = process.argv.slice(2);
  const lastIdx = args.indexOf('--last');
  const now = new Date();

  if (lastIdx !== -1) {
    const n = Math.max(1, Math.min(Number(args[lastIdx + 1]) || 12, 36));
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    });
  }

  const named = args.find((a) => /^\d{4}-\d{2}$/.test(a));
  if (named) return [named];

  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return [`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`];
}

async function run() {
  const months = monthsWanted();
  console.log(`${months.length} month${months.length === 1 ? '' : 's'}: ${months.join(', ')}\n`);

  for (const month of months) {
    const report = await buildReport(month);
    const has = [
      report.visits && `${report.visits.visits} visits`,
      report.submissions && `${report.submissions.total} submissions`,
      report.speed && 'speed test',
      report.giving && `$${(report.giving.total / 100).toFixed(0)} given`,
      report.newsletter && `newsletter ${report.newsletter.status}`,
    ].filter(Boolean);

    console.log(`${monthName(month)} — ${has.length ? has.join(' · ') : 'no data from any source'}`);
    for (const line of report.summary) console.log(`    ${line}`);

    if (!APPLY) continue;
    const written = await saveReport(report, 'generate-reports script', REPLACE);
    console.log(`    ${written ? 'written' : 'already exists — left alone'}`);
  }

  console.log(APPLY ? '\nDone.' : '\nPreview only — run again with APPLY=yes to write.');
}

run().catch((e) => { console.error(e); process.exit(1); });
