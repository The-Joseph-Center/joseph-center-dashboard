/**
 * Confirms the dashboard can read the stats sheet, and shows what it would pull.
 *
 * Run after the consent step:  npx tsx scripts/check-sheet.mjs
 * Prints no secrets — only the auth mode, the sheet's own structure, and the
 * numbers it resolves.
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n'))
  if (l.includes('=') && !l.trim().startsWith('#')) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1);

const { googleAuthMode, sheetTabs, sheetGrid, findMonthTab, flattenMetrics, matchMetric } =
  await import('../netlify/functions/_lib/google-sheets.ts');

console.log('auth mode:', googleAuthMode() ?? 'none configured');
const id = process.env.NEWSLETTER_SHEET_ID;
if (!id) { console.error('NEWSLETTER_SHEET_ID is not set.'); process.exit(1); }

// The month the newsletter tool would be building for.
const now = new Date();
const month = process.argv[2] ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

try {
  const tabs = await sheetTabs(id);
  console.log('tabs:', tabs.map((t) => JSON.stringify(t)).join(', '));

  const tab = findMonthTab(tabs, month);
  console.log(`\nmonth ${month} resolves to tab: ${tab ? JSON.stringify(tab) : 'NO MATCH'}`);
  if (!tab) { console.log('(no tab for that month yet — pass another as an argument, e.g. 2026-08)'); process.exit(0); }

  const metrics = flattenMetrics(await sheetGrid(id, `${tab}!A1:D80`));
  console.log(`${metrics.length} metrics found\n`);

  // The five the newsletter asks for, resolved exactly as the tool resolves them.
  const STATS = ['Meals served', 'Individuals welcomed', 'Families served', 'Program spotlight stat', 'IFS financial stability'];
  console.log('what the newsletter would pull:');
  for (const label of STATS) {
    const hit = matchMetric(metrics, label);
    console.log(`  ${label.padEnd(24)} ${hit ? `${hit.value.padEnd(10)} from "${hit.label}"` : '— no match, pick by hand'}`);
  }
} catch (e) {
  console.error('failed:', e.message);
  process.exit(1);
}
