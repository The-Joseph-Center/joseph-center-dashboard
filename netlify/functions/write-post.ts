import { requireCapability, denial } from './_lib/verify-okta';
import { BRAND_REFERENCE_FULL } from './_lib/brand-reference';

/**
 * Drafts a blog post from facts a staff member supplies.
 *
 * The brand reference is explicit that content must not invent programme
 * details, and a model given only a topic will do exactly that. The guided
 * answers are the answer to that problem rather than a nicety: the person who
 * knows what happened supplies the facts, and this composes them. It is told,
 * repeatedly, that anything not in the answers is not available to it — and
 * that where a detail would strengthen the piece but was not given, it should
 * report the gap rather than fill it.
 *
 * So the response carries two things: the draft, and a list of what it wanted
 * and did not have. The second is the honest part.
 *
 * Output uses the same plain writing format the editor stores, so a draft drops
 * straight into the body with no conversion.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

/** What the form asks for. Order matters — it is the order of the form. */
export const PROMPTS = [
  { id: 'kind', label: 'What kind of post is this?', type: 'choice',
    options: ['A guest’s story', 'Programme update', 'Event recap', 'Giving ask', 'General update'],
    help: '' },
  { id: 'programs', label: 'Which programme is it about?', type: 'text',
    help: 'Day Shelter, Food Pantry, IFS, Family Center, Golden Girls Project — or leave blank for org-wide.' },
  { id: 'facts', label: 'What happened? Write it however it comes out.', type: 'long',
    help: 'This is the post. Rough notes are fine — names, what changed, what someone said, what you saw. Anything not here cannot go in the draft.' },
  { id: 'people', label: 'Anyone to name?', type: 'text',
    help: 'First names only, and only people who agreed to be written about.' },
  { id: 'ask', label: 'What should the reader do at the end?', type: 'choice',
    options: ['Nothing — just tell the story', 'Become a Stability Partner', 'Give one time', 'Volunteer', 'Sign up for the newsletter', 'Attend the event'],
    help: '' },
  { id: 'length', label: 'How long?', type: 'choice',
    options: ['Short (about 300 words)', 'Standard (about 600 words)', 'Long (about 900 words)'],
    help: '' },
] as const;

const WRITE_TOOL = {
  name: 'write_draft',
  description: 'Return the drafted post and anything you needed but were not given.',
  input_schema: {
    type: 'object' as const,
    properties: {
      draft: {
        type: 'string',
        description:
          'The post body. Blank line between paragraphs. "## " for a heading, "**bold**", "*italic*", "[text](url)", "- " for bullets, "> " for a quote. No title line — the title is set separately.',
      },
      gaps: {
        type: 'array',
        maxItems: 6,
        items: { type: 'string' },
        description:
          'Specific things that would have made the post better but were not supplied, phrased as a question to the writer. Empty if nothing was missing.',
      },
    },
    required: ['draft', 'gaps'],
  },
};

const SYSTEM = `You draft blog posts for The Joseph Center from facts a staff member gives you.

${BRAND_REFERENCE_FULL}

The rule that overrides everything else: **use only what you are given.**

- Do not add a statistic, a date, a dollar figure, a programme detail, a service, an outcome or a quotation that is not in the answers. Not one, however plausible or however much better it would make the post read.
- The impact statistics and CTA links in the reference above are approved and may be used. Nothing else may be introduced from outside the answers.
- Where a detail would genuinely strengthen the piece and you were not given it, leave it out and put it in "gaps" as a question. A thinner post with an honest gap list is worth far more than a fuller one somebody has to fact-check line by line.
- If the answers are too sparse to write from, say so in gaps and draft only what they support.

How to write it:
- Follow the voice and tone guidance above. Plain, warm, specific. No inspirational filler and no drama.
- People are people. A guest is never a case study, a statistic, or an object of pity. Their agency belongs in the sentence.
- Use the terminology table exactly. Staff are first names only.
- If there is a call to action, use the wording and the link from the CTA table.
- Open with something concrete rather than a throat-clearing preamble.

Call write_draft.`;

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'content');
  if (!auth.ok) return denial(auth);

  if (event.httpMethod === 'GET') {
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ prompts: PROMPTS }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Drafting is not switched on yet — ANTHROPIC_API_KEY needs setting in Netlify.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const answers = (body.answers ?? {}) as Record<string, unknown>;
    const facts = String(answers.facts ?? '').trim();

    // The substance has to come from a person. Without it there is nothing to
    // compose from, and composing anyway is precisely the failure mode.
    if (facts.length < 80) {
      return {
        statusCode: 400,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Tell it what happened first — a few sentences at least. It can only write from what you give it.' }),
      };
    }

    const said = PROMPTS
      .map((p) => {
        const v = String(answers[p.id] ?? '').trim();
        return v ? `${p.label}\n${v}` : null;
      })
      .filter(Boolean)
      .join('\n\n');

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
        tools: [WRITE_TOOL],
        tool_choice: { type: 'tool', name: WRITE_TOOL.name },
        messages: [{ role: 'user', content: said }],
      }),
    });

    if (!res.ok) {
      console.error('write-post: Anthropic returned', res.status, (await res.text()).slice(0, 300));
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The drafting service did not answer. Try again in a moment.' }) };
    }

    const data = await res.json() as {
      stop_reason?: string;
      content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    };
    if (data.stop_reason === 'max_tokens') {
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The draft ran out of room. Try asking for a shorter post.' }) };
    }

    const call = (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === WRITE_TOOL.name);
    const draft = typeof call?.input?.draft === 'string' ? call.input.draft.trim() : '';
    if (!draft) {
      console.error('write-post: no draft in the reply');
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Nothing came back. Try again.' }) };
    }
    const rawGaps = call?.input?.gaps;
    const gaps = (Array.isArray(rawGaps) ? rawGaps : typeof rawGaps === 'string' ? rawGaps.split('\n') : [])
      .filter((g): g is string => typeof g === 'string')
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 6);

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ draft, gaps }) };
  } catch (err) {
    console.error('write-post:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not write the draft' }) };
  }
}
