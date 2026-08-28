/**
 * Confirms the dashboard can read the stats sheet, without printing any secret.
 * Run after the consent step:  npx tsx scripts/check-sheet.mjs
 */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n'))
  if (l.includes('=') && !l.trim().startsWith('#')) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1);

const { googleAuthMode, sheetTabs, sheetGrid, findMonthColumn } = await import('../netlify/functions/_lib/google-sheets.ts');

console.log('auth mode:', googleAuthMode() ?? 'none configured');
const id = process.env.NEWSLETTER_SHEET_ID;
if (!id) { console.error('NEWSLETTER_SHEET_ID is not set.'); process.exit(1); }

try {
  const tabs = await sheetTabs(id);
  console.log('tabs:', tabs.join(', '));
  const tab = process.env.NEWSLETTER_SHEET_TAB || tabs[0];
  const grid = await sheetGrid(id, `${tab}!A1:AZ80`);
  console.log(`read ${grid.length} rows from "${tab}"`);
  console.log('first rows:');
  grid.slice(0, 4).forEach((r) => console.log('  ', r.slice(0, 8).join(' | ')));
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  console.log(`column for ${month}:`, findMonthColumn(grid, month));
} catch (e) {
  console.error('failed:', e.message);
  process.exit(1);
}
