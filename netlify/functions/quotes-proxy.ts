import { verifyRequest, denial } from './_lib/verify-okta';

// Feeds the quote picker. Proxied rather than called from the browser so the
// upstream rate limit is shared and cached across everyone, and so CORS and any
// future API keys stay server-side.
//
// Scripture uses a curated reference pool rather than a random-verse endpoint.
// Random verses are unusable for this: sampling labs.bible.org returned things
// like "Should I give him my firstborn child as payment for my rebellion" and
// "So he called one of the slaves and asked what was happening". Staff are
// picking something to sit under their photo on a public page.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface Quote {
  text: string;
  attribution: string;
  source: 'famous' | 'scripture';
}

// ── Famous quotes ─────────────────────────────────────────────────────────
// ZenQuotes' bulk endpoint returns 50 but is rate limited per IP, so the batch
// is cached at module scope and sliced. quotable.io was the obvious choice and
// is dead as of Aug 2026 — checked, not assumed.
let famousCache: { at: number; quotes: Quote[] } = { at: 0, quotes: [] };
const FAMOUS_TTL_MS = 10 * 60 * 1000;

async function famousQuotes(): Promise<Quote[]> {
  if (Date.now() - famousCache.at < FAMOUS_TTL_MS && famousCache.quotes.length) {
    return famousCache.quotes;
  }
  try {
    const res = await fetch('https://zenquotes.io/api/quotes');
    if (!res.ok) throw new Error(String(res.status));
    const raw = (await res.json()) as { q: string; a: string }[];
    const quotes = raw
      .filter((r) => r?.q && r?.a)
      .map((r) => ({ text: r.q.trim(), attribution: r.a.trim(), source: 'famous' as const }));
    if (quotes.length) famousCache = { at: Date.now(), quotes };
    return quotes;
  } catch (err) {
    // Rate limited or down — serving a stale batch beats an empty picker.
    console.warn('quotes-proxy: famous quotes unavailable, serving cache:', err);
    return famousCache.quotes;
  }
}

// ── Scripture ─────────────────────────────────────────────────────────────
const REFERENCES = [
  'Micah 6:8', 'Isaiah 41:10', 'Joshua 1:9', 'Philippians 4:13', 'Jeremiah 29:11',
  'Proverbs 3:5-6', 'Psalm 23:1', 'Romans 8:28', 'Matthew 5:16', 'Galatians 6:9',
  'Hebrews 11:1', 'Isaiah 40:31', 'Psalm 46:1', '1 Corinthians 13:4-7', 'John 13:34',
  'Ephesians 4:32', 'Colossians 3:23', 'Matthew 25:40', 'James 1:22', 'Psalm 37:5',
  'Proverbs 11:25', 'Luke 6:31', '2 Corinthians 9:7', 'Isaiah 58:10', 'Matthew 6:34',
  'Romans 12:12', 'Psalm 119:105', '1 Peter 4:10', 'Deuteronomy 31:6', 'Zephaniah 3:17',
  'Proverbs 16:3', 'Matthew 11:28', 'Psalm 34:18', 'Romans 15:13', 'Hebrews 13:16',
  '1 Thessalonians 5:11', 'Galatians 5:22-23', 'Psalm 139:14', 'Isaiah 43:2', 'John 15:12',
];

async function scriptureQuotes(count: number): Promise<Quote[]> {
  const picks = [...REFERENCES].sort(() => Math.random() - 0.5).slice(0, count);
  const results = await Promise.all(
    picks.map(async (ref) => {
      try {
        const res = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}`);
        if (!res.ok) return null;
        const d = (await res.json()) as { reference?: string; text?: string };
        const text = (d.text || '').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return { text, attribution: d.reference || ref, source: 'scripture' as const };
      } catch {
        return null;
      }
    })
  );
  return results.filter((q): q is Quote => q !== null);
}

export async function handler(event: {
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  // Signed-in staff only — no reason to run an open proxy to third-party APIs.
  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);

  const source = event.queryStringParameters?.source === 'scripture' ? 'scripture' : 'famous';
  const count = Math.min(Math.max(Number(event.queryStringParameters?.count) || 8, 1), 12);

  try {
    const quotes =
      source === 'scripture'
        ? await scriptureQuotes(count)
        : [...(await famousQuotes())].sort(() => Math.random() - 0.5).slice(0, count);

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ source, quotes }),
    };
  } catch (err) {
    console.error('quotes-proxy:', err);
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load quotes' }) };
  }
}
