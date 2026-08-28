import { requireCapability, denial } from './_lib/verify-okta';
import { sheetTabs, sheetGrid, findMonthTab, flattenMetrics, matchMetric, googleAuthMode } from './_lib/google-sheets';

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

    // The month is a tab in this sheet, not a column. Resolved for them unless
    // they have picked one explicitly.
    const chosen = tab || (/^\d{4}-\d{2}$/.test(month) ? findMonthTab(tabs, month) : null);

    if (!chosen) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ tabs, tab: '', metrics: [], matches: [], error: `No tab for that month. Found: ${tabs.join(', ')}` }),
      };
    }
    if (!tabs.includes(chosen)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: `No tab called "${chosen}".`, tabs }) };
    }

    const grid = await sheetGrid(sheetId, `${chosen}!A1:D80`);
    const metrics = flattenMetrics(grid);

    const matches = labels.map((label) => {
      const hit = matchMetric(metrics, label);
      return {
        label,
        row: hit?.row ?? -1,
        value: hit?.value ?? '',
        sourceLabel: hit?.label ?? '',
      };
    });

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tabs, tab: chosen, matches,
        rows: metrics.map((m) => ({ index: m.row, label: m.label, value: m.value })),
      }),
    };
  } catch (err) {
    console.error('sheets-stats:', err);
    const message = err instanceof Error ? err.message : 'Could not read the sheet';
    // Google's own message is the useful one here — "The caller does not have
    // permission" tells you the sheet was never shared with the service account.
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}
