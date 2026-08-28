import { requireCapability, denial } from './_lib/verify-okta';
import { BRAND_REFERENCE } from './_lib/brand-reference';
import { checkTerminology, type Finding, type Severity } from './_lib/brand-rules';

/**
 * Checks a draft against the brand reference before it goes public.
 *
 * Two passes, deliberately split:
 *
 *   The terminology table in section 7 is a literal list of words to avoid. That
 *   runs locally in brand-rules — free, instant, and it cannot miss one or
 *   hallucinate one. It also runs first, so an offline result exists even if
 *   this call fails.
 *
 *   Everything a rule cannot express — whether someone is framed as a person or
 *   a case study, whether a specific claim needs checking, whether the ask is
 *   clear — is what the model is for.
 *
 * The output is advice, never an edit. Nothing here rewrites the post.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

const REVIEW_TOOL = {
  name: 'report_findings',
  description: 'Report what the draft gets wrong against the brand guidance. Report nothing if it is sound.',
  input_schema: {
    type: 'object' as const,
    properties: {
      findings: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            severity: {
              type: 'string',
              enum: ['must', 'should', 'consider'],
              description: 'must = breaks a stated rule; should = noticeable drift; consider = optional improvement',
            },
            rule: { type: 'string', description: 'Three or four words naming the issue.' },
            quote: { type: 'string', description: 'The exact words from the draft this is about.' },
            why: { type: 'string', description: 'One sentence. What is wrong, in plain language.' },
            suggestion: { type: 'string', description: 'What to write instead, concretely.' },
          },
          required: ['severity', 'rule', 'quote', 'why', 'suggestion'],
        },
      },
      verdict: { type: 'string', description: 'One sentence overall. Say so plainly if the draft is in good shape.' },
    },
    required: ['findings', 'verdict'],
  },
};

const SYSTEM = `You review draft blog posts for The Joseph Center against their own brand guidance.

${BRAND_REFERENCE}

How to review:
- The word-level terminology table is already checked automatically. Do not report banned words; another pass has them covered. Look at what a word list cannot see.
- What matters most is dignity: is a person written about as a person with a story, or as a case study, a statistic, or an object of pity? That is the failure worth catching.
- Flag any specific claim — a number, a date, a program detail, an outcome — that reads as though it may have been assumed rather than known. Say it needs checking. Do not assert it is wrong.
- Note where the framing slips into charity rather than community partnership, or where the bridge positioning is used incorrectly.
- Consider whether the ask, if there is one, is clear and consistent with the giving language.

Be a careful editor, not a pedant. Three real problems are more useful than ten trivial ones, and a draft that is genuinely fine should come back with no findings and a verdict that says so. Do not invent issues to look thorough.

Call report_findings with your review.`;

const ORDER: Record<Severity, number> = { must: 0, should: 1, consider: 2 };

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

  try {
    const body = JSON.parse(event.body || '{}');
    const draft = String(body.bodyText ?? '').trim().slice(0, 40000);
    if (draft.length < 120) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Write a bit more of the post first.' }) };
    }

    // Always available, and correct on its own even if the model call fails.
    const terminology = checkTerminology(draft);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          findings: terminology,
          verdict: 'Word choice checked. The fuller review needs ANTHROPIC_API_KEY setting in Netlify.',
          partial: true,
        }),
      };
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        ...(process.env.ANTHROPIC_WORKSPACE_ID
          ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
          : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        tools: [REVIEW_TOOL],
        tool_choice: { type: 'tool', name: REVIEW_TOOL.name },
        messages: [{ role: 'user', content: `The draft:\n\n${draft}` }],
      }),
    });

    if (!res.ok) {
      console.error('brand-check: Anthropic returned', res.status, (await res.text()).slice(0, 300));
      // The word check still stands, so return it rather than nothing.
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          findings: terminology,
          verdict: 'Word choice checked. The fuller review could not be reached — try again in a moment.',
          partial: true,
        }),
      };
    }

    const data = await res.json() as {
      stop_reason?: string;
      content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    };
    const call = (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === REVIEW_TOOL.name);
    const input = (call?.input ?? {}) as { findings?: unknown; verdict?: unknown };

    const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const judged: Finding[] = Array.isArray(input.findings)
      ? input.findings
          .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
          .map((f) => ({
            severity: (['must', 'should', 'consider'] as const).includes(f.severity as Severity)
              ? (f.severity as Severity)
              : 'consider',
            rule: str(f.rule, 80),
            quote: str(f.quote, 300),
            why: str(f.why),
            suggestion: str(f.suggestion),
          }))
          .filter((f) => f.rule && f.why)
      : [];

    const findings = [...terminology, ...judged].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    const counts = {
      must: findings.filter((f) => f.severity === 'must').length,
      should: findings.filter((f) => f.severity === 'should').length,
      consider: findings.filter((f) => f.severity === 'consider').length,
    };

    /**
     * The verdict is a required field the model still sometimes omits — on a
     * long review of the June newsletter it returned eight findings and no
     * verdict at all, which left the summary line blank. Counting the findings
     * is a poorer sentence than the model's own, and much better than nothing.
     */
    const fallback = findings.length
      ? [
          counts.must && `${counts.must} to fix`,
          counts.should && `${counts.should} to look at`,
          counts.consider && `${counts.consider} to consider`,
        ].filter(Boolean).join(', ')
      : 'Nothing to flag — this reads as on-brand.';

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ findings, verdict: str(input.verdict, 300) || fallback, counts }),
    };
  } catch (err) {
    console.error('brand-check:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not run the check' }) };
  }
}
