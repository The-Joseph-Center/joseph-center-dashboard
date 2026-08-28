import { requireCapability, denial } from './_lib/verify-okta';
import { BRAND_REFERENCE } from './_lib/brand-reference';

/**
 * Suggests a title, summary, category and tags for a post that is already
 * written.
 *
 * Deliberately not a writer. The Joseph Center's brand reference is explicit
 * that content must not invent program details and must frame people with
 * dignity rather than as case studies, and a model handed a blank page and a
 * topic will do both. Given a finished draft it is only reading and labelling,
 * which is the part that is genuinely tedious and where being wrong is visible
 * and cheap to fix.
 *
 * Every suggestion is a suggestion: nothing is written to the post until a
 * person accepts it.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MODEL = 'claude-sonnet-5';

const SYSTEM = `You help staff at The Joseph Center label blog posts they have already written.

${BRAND_REFERENCE}

Rules that override anything else:
- Work only from the draft you are given. Never introduce a fact, statistic, name or program detail that is not already in it.
- Follow the terminology table above exactly — the "Never Use" words are not acceptable in any suggestion.
- Titles are plain and specific. No colons stacking two clever halves, no clickbait, no exclamation marks.
- The summary is one or two sentences, written for someone deciding whether to read the post.
- Prefer an existing category over inventing one.
- Tags are lowercase, two to six of them, no hashes.

Reply with JSON only, no prose around it:
{"titles":["…","…","…"],"excerpt":"…","category":"…","tags":["…"]}`;

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'content');
  if (!auth.ok) return denial(auth);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // A clear, actionable message rather than a 500 — this is a missing setting,
    // not a fault, and the person reading it can do something about it.
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Suggestions are not switched on yet — ANTHROPIC_API_KEY needs setting in Netlify.' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const draft = String(body.bodyText ?? '').trim().slice(0, 40000);
    if (draft.length < 120) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Write a bit more of the post first — there is not enough here to summarise.' }),
      };
    }
    const known = Array.isArray(body.categories)
      ? body.categories.filter((c: unknown) => typeof c === 'string').slice(0, 20)
      : [];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        // Identity-backed keys (personal or service account) that are not
        // scoped to a single workspace must name the workspace on every
        // request, and fail with a 400 that does not obviously say so if they
        // do not. Setting ANTHROPIC_WORKSPACE_ID covers that case; a key
        // created against one workspace needs neither the variable nor this
        // header.
        ...(process.env.ANTHROPIC_WORKSPACE_ID
          ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
          : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `Categories already in use: ${known.length ? known.join(', ') : '(none yet)'}\n\nThe draft:\n\n${draft}`,
        }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error('ai-assist: Anthropic returned', res.status, detail.slice(0, 400));
      return {
        statusCode: 502,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'The suggestion service did not answer. Try again in a moment.' }),
      };
    }

    const data = await res.json() as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');

    // The model is told to return bare JSON; a fenced block is the likely
    // deviation, so unwrap it rather than failing the whole request over
    // punctuation.
    const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    let parsed: { titles?: unknown; excerpt?: unknown; category?: unknown; tags?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch {
      console.error('ai-assist: unparseable reply:', json.slice(0, 300));
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The suggestions came back in a form we could not read. Try again.' }) };
    }

    const strings = (v: unknown, max: number) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean).slice(0, max) : [];

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        titles: strings(parsed.titles, 3),
        excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt.trim().slice(0, 500) : '',
        category: typeof parsed.category === 'string' ? parsed.category.trim().slice(0, 80) : '',
        tags: strings(parsed.tags, 6).map((t) => t.toLowerCase().replace(/^#/, '')),
      }),
    };
  } catch (err) {
    console.error('ai-assist:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not get suggestions' }) };
  }
}
