/**
 * Analytics Proxy — fetches from Simple Analytics API on behalf of the dashboard.
 * Keeps the SA API key server-side so it's never exposed to the client.
 *
 * Query params: hostname, start, end
 * Env: SIMPLE_ANALYTICS_API_KEY
 */
export async function handler(event: {
  queryStringParameters: Record<string, string> | null;
}) {
  const { hostname, start, end } = event.queryStringParameters || {};

  if (!hostname || !start || !end) {
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
