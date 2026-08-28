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

/**
 * Room for the model to think and still finish the answer.
 *
 * This was 1024, which looked ample for four short fields and was not: the
 * model returns a thinking block first and that counts against the same budget.
 * On the June newsletter it spent the entire 1024 thinking and the JSON came
 * back cut in half — which surfaced as "the suggestions came back in a form we
 * could not read", a message about the symptom that gave no hint of the cause.
 */
const MAX_TOKENS = 4096;

/**
 * The answer comes back as a tool call rather than as JSON in prose.
 *
 * The shape is then guaranteed by the schema instead of by asking politely and
 * parsing whatever arrives — no code fences to strip, no preamble to skip, and
 * a malformed reply becomes impossible rather than merely unlikely.
 */
const SUGGEST_TOOL = {
  name: 'suggest_metadata',
  description: 'Return the suggested title options, summary, category and tags for the draft.',
  input_schema: {
    type: 'object' as const,
    properties: {
      titles: {
        type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3,
        description: 'Two or three plain, specific title options.',
      },
      excerpt: { type: 'string', description: 'One or two sentences for the blog index card.' },
      category: { type: 'string', description: 'Prefer one of the categories already in use.' },
      tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
    },
    required: ['titles', 'excerpt', 'category', 'tags'],
  },
};

const SYSTEM = `You help staff at The Joseph Center label blog posts they have already written.

${BRAND_REFERENCE}

Rules that override anything else:
- Work only from the draft you are given. Never introduce a fact, statistic, name or program detail that is not already in it.
- Follow the terminology table above exactly — the "Never Use" words are not acceptable in any suggestion.
- Titles are plain and specific. No colons stacking two clever halves, no clickbait, no exclamation marks.
- The summary is one or two sentences, written for someone deciding whether to read the post.
- Prefer an existing category over inventing one.
- Tags are lowercase, two to six of them, no hashes.

Call the suggest_metadata tool with your answer.`;

/**
 * A list of strings, however it arrived.
 *
 * The tool schema asks for an array and usually gets one, but not always: on
 * the June newsletter `tags` came back as "golden girls project, family centre,
 * …" — a single comma-separated string. A schema is guidance to the model, not
 * a guarantee from it, and the earlier `Array.isArray(v) ? … : []` silently
 * returned no tags at all, which is the worst of the three possible outcomes.
 */
export function toStringList(v: unknown, max: number): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return list
    .filter((x): x is string => typeof x === 'string')
    // Strip stray JSON punctuation from the ends. When the model returns the
    // list as one comma-separated string it sometimes carries the closing
    // brackets along with it, which produced a real tag reading
    // "western slope]}" — visible, but only if you looked at the last one.
    .map((s) => s.trim().replace(/^[\[\]{}"'`\s]+|[\[\]{}"'`\s]+$/g, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

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
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        tools: [SUGGEST_TOOL],
        tool_choice: { type: 'tool', name: SUGGEST_TOOL.name },
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

    const data = await res.json() as {
      stop_reason?: string;
      content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    };

    // Truncation is the one failure worth naming, because the fix is a setting
    // rather than a retry — an identical second attempt fails identically.
    if (data.stop_reason === 'max_tokens') {
      console.error('ai-assist: hit the token ceiling before finishing');
      return {
        statusCode: 502,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'That post is long enough that the suggestions ran out of room. Tell Eric — the limit needs raising.' }),
      };
    }

    const call = (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === SUGGEST_TOOL.name);
    if (!call?.input) {
      console.error('ai-assist: no tool call in the reply:', JSON.stringify(data.content ?? []).slice(0, 300));
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The suggestions came back empty. Try again.' }) };
    }
    const parsed = call.input as { titles?: unknown; excerpt?: unknown; category?: unknown; tags?: unknown };

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        titles: toStringList(parsed.titles, 3),
        excerpt: typeof parsed.excerpt === 'string' ? parsed.excerpt.trim().slice(0, 500) : '',
        category: typeof parsed.category === 'string' ? parsed.category.trim().slice(0, 80) : '',
        tags: toStringList(parsed.tags, 6).map((t) => t.toLowerCase().replace(/^#/, '')),
      }),
    };
  } catch (err) {
    console.error('ai-assist:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not get suggestions' }) };
  }
}
