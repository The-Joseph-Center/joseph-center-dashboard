import { SignJWT, importPKCS8 } from 'jose';

/**
 * Read-only access to a Google Sheet, as a service account.
 *
 * A service account rather than an API key because an API key only works on a
 * sheet published to the whole web, and monthly program numbers are not
 * something to make world-readable to save a setup step. The account is granted
 * Viewer on the one sheet and can reach nothing else in the Google account.
 *
 * The token exchange is done by hand rather than with googleapis: it is one
 * signed JWT posted to one endpoint, and `jose` is already here for verifying
 * Okta tokens. Pulling in a large SDK to sign a single assertion would be the
 * bigger dependency, not the smaller one.
 */

interface ServiceAccount { client_email: string; private_key: string }

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Tokens last an hour; a warm function reuses one rather than re-signing. */
let cached: { token: string; expiresAt: number } | null = null;

export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    // Netlify's UI turns real newlines into \n, so the PEM arrives escaped.
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const account = serviceAccount();
  if (!account) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing or is not valid JSON');

  const key = await importPKCS8(account.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(account.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json() as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Token exchange failed (${res.status})`);
  }
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export async function sheetTabs(sheetId: string): Promise<string[]> {
  const token = await accessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json() as { sheets?: { properties?: { title?: string } }[]; error?: { message: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Sheets returned ${res.status}`);
  return (data.sheets ?? []).map((s) => s.properties?.title ?? '').filter(Boolean);
}

/** A rectangle of cells, as strings, with short rows padded so it is a grid. */
export async function sheetGrid(sheetId: string, range: string): Promise<string[][]> {
  const token = await accessToken();
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json() as { values?: unknown[][]; error?: { message: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Sheets returned ${res.status}`);
  const rows = (data.values ?? []).map((r) => r.map((c) => String(c ?? '').trim()));
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]);
}

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/**
 * Which column holds a given month.
 *
 * Monthly sheets label columns every which way — "September", "Sep", "Sept-26",
 * "9/1/2026", "2026-09". All of them are tried, because the alternative is
 * telling someone their sheet is laid out wrong.
 */
export function findMonthColumn(grid: string[][], month: string): number {
  const [year, m] = month.split('-').map(Number);
  const name = MONTHS[m! - 1]!;
  const abbrev = name.slice(0, 3);
  const shortYear = String(year).slice(2);

  const matches = (cell: string): boolean => {
    const c = cell.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!c) return false;
    if (c === month || c === `${year}-${String(m).padStart(2, '0')}`) return true;
    // A date cell Google has already formatted.
    const asDate = Date.parse(cell);
    if (!Number.isNaN(asDate)) {
      const d = new Date(asDate);
      if (d.getUTCFullYear() === year && d.getUTCMonth() === m! - 1) return true;
    }
    const hasMonth = c.startsWith(name) || c.startsWith(abbrev);
    if (!hasMonth) return false;
    // With a year in the header it has to be the right year; without one,
    // assume the sheet covers a single year.
    const yearInCell = /\d{2,4}/.exec(c)?.[0];
    if (!yearInCell) return true;
    return yearInCell === String(year) || yearInCell === shortYear;
  };

  // Headers are usually in the first few rows, not always the first.
  for (const row of grid.slice(0, 6)) {
    const idx = row.findIndex(matches);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** Which row holds a metric, matched loosely on its label in the first columns. */
export function findStatRow(grid: string[][], label: string): number {
  const want = label.toLowerCase().replace(/[^a-z]/g, '');
  if (!want) return -1;
  let best = -1;
  let bestScore = 0;
  grid.forEach((row, i) => {
    for (const cell of row.slice(0, 2)) {
      const got = cell.toLowerCase().replace(/[^a-z]/g, '');
      if (!got) continue;
      let score = 0;
      if (got === want) score = 3;
      else if (got.includes(want) || want.includes(got)) score = 2;
      else {
        // Share a distinctive word — "meals" matching "Meals Served (Hot)".
        const words = label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
        if (words.some((w) => cell.toLowerCase().includes(w))) score = 1;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    }
  });
  return bestScore >= 1 ? best : -1;
}
