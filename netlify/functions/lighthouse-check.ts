import { turso } from './_lib/staff-directory';

/**
 * Google's speed and quality test of the home page, once a month.
 *
 * Runs daily from the 2nd and stops as soon as the month has a test, because
 * Google's test does occasionally fail to load a page and a month with no
 * score is worse than a retry nobody noticed. A test cannot be run for a past
 * date, so a missed month stays missed — which is the argument for retrying
 * rather than running once and hoping.
 *
 * Phone and computer are requested in parallel and saved independently: a run
 * that gets one of the two is still progress, and the other is picked up the
 * next day.
 *
 * Needs PSI_API_KEY. Google refuses anonymous PageSpeed requests at any
 * useful rate, so without a key this does nothing and says so once.
 */

const SITE = process.env.ANALYTICS_HOSTNAME || 'josephcentergj.com';
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

interface Scores { performance: number; accessibility: number; bestPractices: number; seo: number }

async function test(device: 'phone' | 'computer', key: string): Promise<Scores | null> {
  const params = new URLSearchParams({
    url: `https://${SITE}/`,
    key,
    strategy: device === 'phone' ? 'mobile' : 'desktop',
  });
  for (const c of CATEGORIES) params.append('category', c);

  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`);
  if (!res.ok) {
    console.error(`lighthouse-check: ${device} failed`, res.status, (await res.text()).slice(0, 200));
    return null;
  }
  const body = await res.json() as {
    lighthouseResult?: { categories?: Record<string, { score?: number }> };
  };
  const cats = body.lighthouseResult?.categories ?? {};
  const score = (k: string) => Math.round((cats[k]?.score ?? 0) * 100);

  // A page that fails to load scores zero across the board; saving that would
  // put a false red month on the record.
  const scores = {
    performance: score('performance'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    seo: score('seo'),
  };
  if (!scores.performance && !scores.accessibility && !scores.seo) return null;
  return scores;
}

export async function handler() {
  const key = process.env.PSI_API_KEY;
  if (!key) {
    console.warn('lighthouse-check: PSI_API_KEY is not set — no test was run');
    return { statusCode: 200, body: JSON.stringify({ skipped: 'no PSI_API_KEY' }) };
  }

  const db = turso();
  const now = new Date();
  const startOfMonth = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);

  try {
    const { rows } = await db.execute({
      sql: `SELECT device FROM site_checks WHERE kind = 'lighthouse' AND checked_at >= ?`,
      args: [startOfMonth],
    });
    const done = new Set(rows.map((r) => String(r.device)));
    const wanted = (['phone', 'computer'] as const).filter((d) => !done.has(d));
    if (!wanted.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: 'this month already tested' }) };
    }

    const results = await Promise.all(wanted.map(async (device) => ({ device, scores: await test(device, key) })));
    const saved: string[] = [];
    for (const { device, scores } of results) {
      if (!scores) continue;
      await db.execute({
        sql: `INSERT INTO site_checks (kind, device, data, checked_at) VALUES ('lighthouse', ?, ?, unixepoch())`,
        args: [device, JSON.stringify(scores)],
      });
      saved.push(device);
    }

    console.log('lighthouse-check:', JSON.stringify({ saved, attempted: wanted }));
    return { statusCode: 200, body: JSON.stringify({ saved }) };
  } catch (err) {
    console.error('lighthouse-check:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'check failed' }) };
  }
}
