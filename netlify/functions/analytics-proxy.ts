import { requireCapability, denial } from './_lib/verify-okta';
/**
 * Analytics Proxy — fetches from Simple Analytics API on behalf of the dashboard.
 * Keeps the SA API key server-side so it's never exposed to the client.
 *
 * Query params: hostname, start, end
 * Env: SIMPLE_ANALYTICS_API_KEY
 */
export async function handler(event: {
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
}) {
  // Previously unauthenticated: anyone who found the URL could read the site's
  // analytics. Now limited to the people who act on it.
  const auth = await requireCapability(event.headers, 'analytics');
  if (!auth.ok) return denial(auth);

  const q = event.queryStringParameters || {};

  /**
   * The site is fixed, not asked for.
   *
   * The key this uses can read every site in the Simple Analytics account, so
   * a hostname taken from the query string would let anyone who can open the
   * dashboard read somebody else's figures. It is pinned here and the
   * parameter is ignored.
   */
  const hostname = process.env.ANALYTICS_HOSTNAME || 'josephcentergj.com';

  // ── period=mtd: this month so far, against the same days of last month ──
  if (q.period === 'mtd') {
    return monthToDate(hostname);
  }

  const { start, end } = q;

  if (!start || !end) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required params: hostname, start, end' }),
    };
  }

  const apiKey = process.env.SIMPLE_ANALYTICS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Analytics not configured',
        message: 'SIMPLE_ANALYTICS_API_KEY is not set. Add it to your Netlify environment variables.',
      }),
    };
  }

  try {
    const baseUrl = 'https://simpleanalytics.com';
    const statsUrl = `${baseUrl}/${hostname}.json?version=5&start=${start}&end=${end}&info=false&fields=pageviews,visitors,seconds_on_page`;
    const pagesUrl = `${baseUrl}/${hostname}.json?version=5&start=${start}&end=${end}&info=false&fields=pages`;
    const referrersUrl = `${baseUrl}/${hostname}.json?version=5&start=${start}&end=${end}&info=false&fields=referrers`;

    const headers = {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
    };

    const [statsRes, pagesRes, referrersRes] = await Promise.all([
      fetch(statsUrl, { headers }),
      fetch(pagesUrl, { headers }),
      fetch(referrersUrl, { headers }),
    ]);

    if (!statsRes.ok) {
      const text = await statsRes.text();
      console.error('SA API error:', statsRes.status, text);
      return {
        statusCode: statsRes.status,
        body: JSON.stringify({ error: `Simple Analytics API returned ${statsRes.status}` }),
      };
    }

    const stats = await statsRes.json();
    const pages = pagesRes.ok ? await pagesRes.json() : { pages: [] };
    const referrers = referrersRes.ok ? await referrersRes.json() : { referrers: [] };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
      body: JSON.stringify({
        pageviews: stats.pageviews ?? 0,
        visitors: stats.visitors ?? 0,
        seconds_on_page: stats.seconds_on_page ?? 0,
        pages: (pages.pages ?? []).slice(0, 20),
        referrers: (referrers.referrers ?? []).slice(0, 20),
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Analytics proxy error:', message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    };
  }
}


/** YYYY-MM-DD in the client's own timezone, not the server's. */
function day(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: process.env.CLIENT_TIMEZONE || 'America/Denver' });
}

/**
 * This month so far, and the same stretch of last month.
 *
 * Compared like for like: the 1st to today against the 1st to the same day
 * number last month. Comparing a half-finished month against a whole one is
 * how a good month comes to look like a collapse.
 */
async function monthToDate(hostname: string) {
  const apiKey = process.env.SIMPLE_ANALYTICS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected: false }),
    };
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // The same day number last month, clamped: there is no 31st of September,
  // and asking for one silently returns the 1st of October.
  const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const lastMonthEnd = new Date(
    lastMonthStart.getFullYear(),
    lastMonthStart.getMonth(),
    Math.min(now.getDate(), daysIn(lastMonthStart.getFullYear(), lastMonthStart.getMonth()))
  );

  const headers = { 'Api-Key': apiKey, 'Content-Type': 'application/json' };
  const url = (from: Date, to: Date, fields: string) =>
    `https://simpleanalytics.com/${hostname}.json?version=5&start=${day(from)}&end=${day(to)}&info=false&fields=${fields}`;

  const [thisRes, prevRes] = await Promise.all([
    fetch(url(startOfMonth, now, 'visitors,pageviews,seconds_on_page,histogram'), { headers }),
    fetch(url(lastMonthStart, lastMonthEnd, 'visitors'), { headers }),
  ]);

  if (!thisRes.ok) {
    console.error('analytics-proxy: Simple Analytics returned', thisRes.status, (await thisRes.text()).slice(0, 200));
    return { statusCode: 502, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Analytics did not answer' }) };
  }

  const current = await thisRes.json() as {
    visitors?: number; pageviews?: number; seconds_on_page?: number;
    histogram?: { date: string; visitors?: number }[];
  };
  // A missing comparison is reported as missing, never as zero — "up 100%"
  // from a month we could not read is worse than saying nothing.
  const previous = prevRes.ok ? (await prevRes.json() as { visitors?: number }) : null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' },
    body: JSON.stringify({
      connected: true,
      visits: current.visitors ?? 0,
      pageviews: current.pageviews ?? 0,
      secondsPerVisit: current.visitors ? Math.round((current.seconds_on_page ?? 0) / current.visitors) : null,
      previousVisits: previous?.visitors ?? null,
      days: (current.histogram ?? []).map((h) => ({ date: h.date, visits: h.visitors ?? 0 })),
    }),
  };
}
