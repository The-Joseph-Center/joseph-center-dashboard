import { requireCapability, denial } from './_lib/verify-okta';
import { turso, fetchOktaUsers } from './_lib/staff-directory';
import { reviewNewsletter, aweberPlan, type NewsletterDraft } from './_lib/newsletter';
import { aweberConfig, missingScopes, allSubscribers, addTag, REQUIRED_SCOPES } from './_lib/aweber';

/**
 * The AWeber end of sending the newsletter.
 *
 * Two actions, and the gap between them is the point.
 *
 *   check   reads only. Reports which scopes are granted, how many active
 *           subscribers there are, whether the month's tag has been used
 *           before, and whether the newsletter passes its own review. Safe to
 *           run as often as you like.
 *
 *   tag     applies the month's tag to every active subscriber. This is the
 *           send. AWeber's automations trigger on that tag, so the moment it
 *           lands the newsletter is on its way to 263 people and there is no
 *           recalling it.
 *
 * `tag` re-runs the review server-side and refuses on any outstanding "must".
 * A disabled button is a courtesy; this is the part that means it. It also
 * refuses a tag that has been used before, because "subscribers can enter once"
 * makes a reused tag silently skip everyone who received the earlier one.
 *
 * Building the automation is not here because AWeber's API does not cover
 * Campaigns at all — that stays a person in their web app.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthName = (m: string) => MONTHS[Number(m.split('-')[1]) - 1] ?? '';
const parse = <T,>(v: unknown, fallback: T): T => {
  try { return typeof v === 'string' ? JSON.parse(v) as T : fallback; } catch { return fallback; }
};

async function loadForReview(month: string) {
  const db = turso();
  const all = (await db.execute('SELECT * FROM newsletters ORDER BY month DESC')).rows as unknown as Record<string, unknown>[];
  const row = all.find((r) => r.month === month);
  if (!row) return null;

  let surnames: string[] = [];
  try {
    const users = await fetchOktaUsers(process.env.OKTA_ISSUER!, process.env.OKTA_API_TOKEN!);
    surnames = [...new Set(users.map((u) => u.profile.lastName ?? '').filter((n) => /^[A-Z][a-zA-Z'-]{2,}$/.test(n)))];
  } catch { /* the review still runs without it */ }

  const draft: NewsletterDraft = {
    month,
    monthName: monthName(month),
    guestName: String(row.guest_name ?? ''),
    program: String(row.program ?? ''),
    section1: String(row.section1 ?? ''),
    section2: String(row.section2 ?? ''),
    stats: parse<Record<string, string>>(row.stats, {}),
    videos: parse<{ title: string; url: string }[]>(row.videos, []),
    partners: parse<{ name: string; url: string }[]>(row.partners, []),
    previewText: String(row.preview_text ?? ''),
    aweberTag: String(row.aweber_tag ?? ''),
    usedTags: all.filter((r) => r.month !== month).map((r) => String(r.aweber_tag ?? '')).filter(Boolean),
    staffSurnames: surnames,
  };
  return { draft, status: String(row.status ?? 'draft'), issues: reviewNewsletter(draft) };
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'newsletter');
  if (!auth.ok) return denial(auth);

  const cfg = aweberConfig();
  if (!cfg) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'AWeber is not connected — the AWEBER_* variables need setting in Netlify.' }),
    };
  }

  try {
    const month = ((event.queryStringParameters?.month ?? '') || (JSON.parse(event.body || '{}').month ?? '')).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A month is required, as YYYY-MM.' }) };
    }

    const loaded = await loadForReview(month);
    if (!loaded) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'That month has not been saved yet.' }) };
    }
    const { draft, status, issues } = loaded;
    const blocking = issues.filter((i) => i.severity === 'must');

    // ── check: read-only ──
    if (event.httpMethod === 'GET') {
      const missing = await missingScopes(cfg);
      if (missing.length) {
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            ready: false,
            missingScopes: missing,
            requiredScopes: REQUIRED_SCOPES,
            error: `AWeber has not granted ${missing.join(', ')}. Re-authorize with the wider scopes.`,
          }),
        };
      }

      const subscribers = await allSubscribers(cfg);
      const active = subscribers.filter((s) => s.status === 'subscribed');
      const alreadyTagged = active.filter((s) => s.tags.includes(draft.aweberTag));

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ready: blocking.length === 0 && status !== 'sent',
          status,
          tag: draft.aweberTag,
          plan: aweberPlan(month, new Date()),
          totals: {
            subscribers: subscribers.length,
            active: active.length,
            alreadyTagged: alreadyTagged.length,
            toTag: active.length - alreadyTagged.length,
          },
          blocking,
          issues,
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // ── tag: this is the send ──
    const body = JSON.parse(event.body || '{}');
    if (body.confirm !== draft.aweberTag) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: `To send, confirm by typing the tag: ${draft.aweberTag}` }),
      };
    }
    if (status === 'sent') {
      return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: 'This month is already marked as sent.' }) };
    }
    // The real gate. Checked here, not in the browser.
    if (blocking.length) {
      return {
        statusCode: 409,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: `${blocking.length} thing${blocking.length === 1 ? '' : 's'} still to fix before this can go out.`,
          blocking,
        }),
      };
    }
    if (draft.usedTags.includes(draft.aweberTag)) {
      return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: `"${draft.aweberTag}" has been used before. Subscribers can only enter an automation once, so everyone who received that newsletter would be skipped.` }) };
    }

    const subscribers = await allSubscribers(cfg);
    const active = subscribers.filter((s) => s.status === 'subscribed');

    let added = 0, already = 0;
    const failed: string[] = [];
    for (const s of active) {
      try {
        (await addTag(cfg, s, draft.aweberTag)) === 'added' ? added++ : already++;
      } catch (err) {
        // Keep going. A partial run is resumable — the ones already tagged are
        // skipped next time — whereas stopping halfway sends to some and not
        // others with no record of where it stopped.
        failed.push(s.email);
        console.error('newsletter-aweber: tagging failed for', s.email, err);
      }
    }

    if (!failed.length) {
      await turso().execute({
        sql: `UPDATE newsletters SET status='sent', sent_at=unixepoch(), updated_by=?, updated_at=unixepoch() WHERE month=?`,
        args: [auth.email ?? 'unknown', month],
      });
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tag: draft.aweberTag,
        added, already,
        failed: failed.length,
        failedEmails: failed.slice(0, 20),
        markedSent: failed.length === 0,
      }),
    };
  } catch (err) {
    console.error('newsletter-aweber:', err);
    const message = err instanceof Error ? err.message : 'Request failed';
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}
