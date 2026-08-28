import { requireCapability, denial } from './_lib/verify-okta';
import { BRAND_REFERENCE_FULL } from './_lib/brand-reference';
import { bridgeLine } from './_lib/newsletter';

/**
 * Drafts Section 1 from a Coffee Chat transcript.
 *
 * The process document calls transcripts the source of truth and says to read
 * both sides plus bonus content. So the transcript is the only material this
 * works from — the same rule as the blog writer, and for the same reason: a
 * newsletter that invents a detail about a real guest is worse than one that
 * says less.
 *
 * Two frames, because the document specifies two. A guest gets the
 * before / support / transformation arc. A board member or community partner
 * gets the "calling" frame — how they found The Joseph Center, what they saw,
 * why they stayed — with no arc, because they were never in crisis and writing
 * them as though they were is its own kind of wrong.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4096;

const DRAFT_TOOL = {
  name: 'draft_section',
  description: 'Return the drafted section and anything the transcript did not settle.',
  input_schema: {
    type: 'object' as const,
    properties: {
      draft: {
        type: 'string',
        description:
          'Three or four paragraphs, blank line between each, ending with the required bridge line. Use "> " for a pulled quote on its own line. No heading.',
      },
      quotes: {
        type: 'array', maxItems: 4, items: { type: 'string' },
        description: 'Direct quotations used, copied exactly from the transcript so they can be checked.',
      },
      gaps: {
        type: 'array', maxItems: 5, items: { type: 'string' },
        description: 'Things the transcript left unclear, as questions for the writer. Empty if none.',
      },
    },
    required: ['draft', 'quotes', 'gaps'],
  },
};

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'newsletter');
  if (!auth.ok) return denial(auth);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Drafting is not switched on yet — ANTHROPIC_API_KEY needs setting in Netlify.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const transcript = String(body.transcript ?? '').trim().slice(0, 120000);
    const guest = String(body.guestName ?? '').trim().slice(0, 120);
    const monthName = String(body.monthName ?? '').trim().slice(0, 20);
    const frame = body.frame === 'calling' ? 'calling' : 'guest';
    const program = String(body.program ?? '').trim().slice(0, 120);

    if (transcript.length < 400) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Paste the transcript first — both sides of the conversation, and the bonus content if there is any.' }) };
    }
    if (!guest || !monthName) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Set the guest name and the month before drafting.' }) };
    }

    const arc = frame === 'calling'
      ? `${guest} is a board member or community partner, not a guest. Do NOT use a before/support/transformation arc — they were not in crisis, and writing them as though they were is both wrong and undignified. Use the calling frame instead: how they found The Joseph Center, what they witnessed there, why they stayed and why they believe in it.`
      : `${guest} is a guest. Use the before / support / transformation arc: the circumstances that brought them to The Joseph Center, the support they found, and what changed. Lead with the most emotionally resonant angle, not with chronology. Focus on circumstances — "life happened" — never on personal shortcomings.`;

    const SYSTEM = `You draft Section 1 of The Joseph Center's monthly newsletter from a Coffee Chat transcript.

${BRAND_REFERENCE_FULL}

The transcript is the only source. Use nothing else — no statistic, no date, no program detail, no outcome and no quotation that is not in it. If something would strengthen the piece and the transcript does not settle it, leave it out and raise it in gaps.

${arc}

Requirements:
- Three or four paragraphs.
- One or two direct quotations where the transcript gives you good ones. Quote exactly; do not tidy someone's grammar into something they did not say.
- Name which program or programs served them${program ? `; this month's spotlight is ${program}` : ''}.
- First names only, for everyone.
- Dignity first: no pity, no rescue language, no sensationalism. Their agency stays in the sentence. A transcript often contains the worst thing that ever happened to someone — including it in clinical detail is not honesty, it is exposure.
- End on exactly this line, unchanged:

${bridgeLine(monthName)}

Call draft_section.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        tools: [DRAFT_TOOL],
        tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
        messages: [{ role: 'user', content: `Coffee Chat transcript:\n\n${transcript}` }],
      }),
    });

    if (!res.ok) {
      console.error('newsletter-draft: Anthropic returned', res.status, (await res.text()).slice(0, 300));
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The drafting service did not answer. Try again in a moment.' }) };
    }

    const data = await res.json() as {
      stop_reason?: string;
      usage?: { input_tokens: number; output_tokens: number };
      content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    };
    if (data.stop_reason === 'max_tokens') {
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The draft ran out of room. Try a shorter transcript, or the interview half on its own.' }) };
    }

    const input = (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === DRAFT_TOOL.name)?.input ?? {};
    const draft = typeof input.draft === 'string' ? input.draft.trim() : '';
    if (!draft) {
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Nothing came back. Try again.' }) };
    }
    const list = (v: unknown, max: number) =>
      (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim()).filter(Boolean).slice(0, max);

    // The bridge line is required and the model occasionally paraphrases it.
    // Appending is safer than trusting: the review would flag its absence
    // anyway, and a paraphrase is the harder error to notice.
    const required = bridgeLine(monthName);
    const withBridge = draft.includes('hope has an address') ? draft : `${draft}\n\n${required}`;

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        draft: withBridge,
        quotes: list(input.quotes, 4),
        gaps: list(input.gaps, 5),
        appendedBridgeLine: !draft.includes('hope has an address'),
        cost: data.usage ? Number((data.usage.input_tokens * 2e-6 + data.usage.output_tokens * 1e-5).toFixed(4)) : null,
      }),
    };
  } catch (err) {
    console.error('newsletter-draft:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not draft the section' }) };
  }
}
