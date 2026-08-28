import { SignJWT, importPKCS8 } from 'jose';

/**
 * Read-only access to a Google Sheet.
 *
 * Not an API key: that only works on a sheet published to the whole web, and
 * monthly program numbers are not something to make world-readable to save a
 * setup step.
 *
 * Two ways in, tried in order:
 *
 *   OAuth refresh token — a person grants read-only access to the sheets they
 *     can already see, once, and the refresh token is stored. This is the path
 *     that works under `iam.disableServiceAccountKeyCreation`, the Secure by
 *     Default org policy that blocks downloading service account keys. It is
 *     also how the AWeber integration already authenticates, so it is a pattern
 *     this project already carries.
 *
 *   Service account — cleaner when it is available, because it is not tied to
 *     anyone's personal access and survives them leaving. Kept for the day the
 *     org policy gets an exception for this project.
 *
 * Either way the token exchange is one POST. `jose` is already here for Okta,
 * so signing the service-account assertion needs no new dependency, and the
 * OAuth path needs no library at all.
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

export function oauthCredentials() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

/** Whether Sheets is reachable at all, and by which route. */
export const googleAuthMode = (): 'oauth' | 'service-account' | null =>
  oauthCredentials() ? 'oauth' : serviceAccount() ? 'service-account' : null;

async function oauthAccessToken(): Promise<{ token: string; expiresIn: number }> {
  const creds = oauthCredentials()!;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    }),
  });
  const data = await res.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    // invalid_grant almost always means the refresh token was revoked, or the
    // consent screen is still in Testing mode, where Google expires refresh
    // tokens after seven days.
    throw new Error(
      data.error === 'invalid_grant'
        ? 'Google rejected the saved authorization. Re-run the consent step — and check the OAuth consent screen is not still in Testing mode, which expires refresh tokens after seven days.'
        : data.error_description || data.error || `Token refresh failed (${res.status})`
    );
  }
  return { token: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const creds = oauthCredentials();
  if (creds) {
    const { token, expiresIn } = await oauthAccessToken();
    cached = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  }

  const account = serviceAccount();
  if (!account) throw new Error('No Google credentials are configured');

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
 * The tab holding a month.
 *
 * This sheet is a tab per month — "March", "April", "May " (with a trailing
 * space) — rather than a column per month, so the month is resolved to a tab
 * name and matched loosely enough that a stray space or a year suffix does not
 * break it. There is no year in the tab names, so the sheet is assumed to cover
 * the current year; a tab named "August 2027" would still match, which is the
 * behaviour to want if they ever start labelling them.
 */
export function findMonthTab(tabs: string[], month: string): string | null {
  const [year, m] = month.split('-').map(Number);
  const name = MONTHS[m! - 1]!;
  const abbrev = name.slice(0, 3);
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

  // A tab naming this month and this year wins over one naming only the month.
  const withYear = tabs.find((t) => norm(t).startsWith(name) && norm(t).includes(String(year)));
  if (withYear) return withYear;
  const exact = tabs.find((t) => norm(t) === name);
  if (exact) return exact;
  const starts = tabs.find((t) => norm(t).startsWith(name) || norm(t).startsWith(abbrev));
  return starts ?? null;
}

export interface Metric { row: number; department: string; category: string; label: string; value: string }

/**
 * The sheet's rows as addressable metrics.
 *
 * Layout is Department | Category | Value, where the department is written once
 * and carries down over the rows beneath it. So "Front Desk" followed by a blank
 * department and "Individuals Served" is one metric, and it is only meaningful
 * as the pair — "Individuals Served" alone appears under more than one
 * department, and picking the wrong one silently reports the wrong programme.
 */
export function flattenMetrics(grid: string[][]): Metric[] {
  const out: Metric[] = [];
  let department = '';
  grid.forEach((row, i) => {
    const [a = '', b = '', c = ''] = row;
    if (a && /^(department|metric)$/i.test(a)) return;   // the header row
    if (a) department = a;
    const value = c.trim();
    if (!value) return;
    const category = b.trim();
    out.push({
      row: i,
      department,
      category,
      label: category ? `${department} › ${category}` : department,
      value,
    });
  });
  return out;
}

/**
 * Aliases for the newsletter's standard stats.
 *
 * The process document names the five stats one way and the sheet names them
 * another — "Meals served" against "Kitchen (Meals per month) › Plates served
 * per Month". Written down rather than left to fuzzy matching, because
 * "Individuals Served" appears under both Front Desk and IFS and the difference
 * between those two is the difference between 291 and 110.
 */
const ALIASES: Record<string, string[]> = {
  'meals served': ['plates served per month'],
  'individuals welcomed': ['front desk › individuals served'],
  'families served': ['front desk › families served'],
  'ifs financial stability': ['ifs › individuals served'],
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ›]/g, ' ').replace(/\s+/g, ' ').trim();

/** The metric that best answers a newsletter stat label, or null. */
export function matchMetric(metrics: Metric[], statLabel: string): Metric | null {
  const want = squash(statLabel);
  const aliases = ALIASES[want] ?? [];

  for (const alias of aliases) {
    const hit = metrics.find((m) => squash(m.label).includes(squash(alias)));
    if (hit) return hit;
  }

  let best: Metric | null = null;
  let bestScore = 0;
  for (const m of metrics) {
    const label = squash(m.label);
    let score = 0;
    if (label === want) score = 5;
    else if (label.endsWith(want) || squash(m.category) === want) score = 4;
    else {
      const words = want.split(' ').filter((w) => w.length > 3);
      const hits = words.filter((w) => label.includes(w)).length;
      if (hits) score = hits;
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore >= 2 ? best : null;
}
