import { requireCapability, denial } from './_lib/verify-okta';
import { sheetTabs, sheetGrid, findMonthColumn, findStatRow, googleAuthMode } from './_lib/google-sheets';

/**
 * This month's numbers, from the shared Google Sheet.
 *
 * The process document is firm that stats come from the program directors and
 * are never estimated. Retyping them from a spreadsheet is not estimating, but
 * it is the step where a digit gets dropped, and a wrong number in a newsletter
 * is not correctable once it has sent.
 *
 * It reads rather than guesses, and shows its working: every value comes back
 * with the row label it was taken from, so the person can see that "Meals
 * served" really did come from "Meals Served (hot lunches)" and not from the
 * row above it. Anything it cannot match is left empty for them to pick.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
/** Wide and deep enough for a year of columns and a long list of metrics. */
const RANGE = 'A1:AZ80';

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'newsletter');
  if (!auth.ok) return denial(auth);

  const sheetId = process.env.NEWSLETTER_SHEET_ID;
  if (!googleAuthMode() || !sheetId) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: 'The stats sheet is not connected yet — the Google OAuth variables and NEWSLETTER_SHEET_ID need setting in Netlify.',
      }),
    };
  }

  const q = event.queryStringParameters ?? {};
  const month = (q.month ?? '').trim();
  const tab = (q.tab ?? process.env.NEWSLETTER_SHEET_TAB ?? '').trim();
  const labels = (q.labels ?? '').split('|').map((l) => l.trim()).filter(Boolean);

  try {
    const tabs = await sheetTabs(sheetId);

    if (!tab) {
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ tabs }) };
    }
    if (!tabs.includes(tab)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: `No tab called "${tab}". Found: ${tabs.join(', ')}`, tabs }) };
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A month is required, as YYYY-MM.', tabs }) };
    }

    const grid = await sheetGrid(sheetId, `${tab}!${RANGE}`);
    const column = findMonthColumn(grid, month);

    if (column === -1) {
      // Show the headers rather than just failing — nine times out of ten the
      // month simply is not in the sheet yet.
      const headers = grid.slice(0, 4).map((r) => r.filter(Boolean).slice(0, 14));
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          tabs, tab, column: -1, matches: [],
          error: `No column for that month in "${tab}".`,
          headers,
        }),
      };
    }

    // Rows that could plausibly be a metric, for the manual picker.
    const rows = grid
      .map((r, i) => ({ index: i, label: r[0] || r[1] || '', value: r[column] ?? '' }))
      .filter((r) => r.label && r.value);

    const matches = labels.map((label) => {
      const row = findStatRow(grid, label);
      return {
        label,
        row,
        value: row === -1 ? '' : (grid[row]?.[column] ?? ''),
        sourceLabel: row === -1 ? '' : (grid[row]?.[0] || grid[row]?.[1] || ''),
      };
    });

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ tabs, tab, column, monthHeader: grid.find((r) => r[column])?.[column] ?? '', matches, rows }),
    };
  } catch (err) {
    console.error('sheets-stats:', err);
    const message = err instanceof Error ? err.message : 'Could not read the sheet';
    // Google's own message is the useful one here — "The caller does not have
    // permission" tells you the sheet was never shared with the service account.
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}
