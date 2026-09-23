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
// Sonnet. Opus was tried for the reading and drafting passes and did not earn
// its keep on this material once the transcript carried timestamps and the
// fact sheet was being corrected by hand — the reading pass is doing the work
// the bigger model was brought in for. NEWSLETTER_MODEL overrides it without a
// deploy if that is ever worth retesting.
const MODEL = process.env.NEWSLETTER_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 4096;

// Approximate list price per token, for the running cost shown in the tool.
const PRICE_IN = 2e-6;
const PRICE_OUT = 1e-5;
const priceOf = (usage?: { input_tokens: number; output_tokens: number }) =>
  usage ? Number((usage.input_tokens * PRICE_IN + usage.output_tokens * PRICE_OUT).toFixed(4)) : null;

/**
 * The reading pass. Before any prose, work out who is in the story and what
 * happened in what order, as plain lines the writer can correct. A wrong line
 * here is obvious and takes seconds to fix; the same error inside finished
 * paragraphs is what gets missed.
 */
const FACTS_TOOL = {
  name: 'read_transcript',
  description: 'Who is in this conversation and what happened, in the order it happened.',
  input_schema: {
    type: 'object' as const,
    properties: {
      people: {
        type: 'array', maxItems: 10, items: { type: 'string' },
        description: 'One line each: name or description, and their relationship to the guest. E.g. "Renee — the guest\'s sister, came to the Family Center with her son".',
      },
      timeline: {
        type: 'array', maxItems: 14, items: { type: 'string' },
        description: 'What happened, earliest first, one event per line. The order events happened in, NOT the order they were mentioned. Say who each event happened to by name.',
      },
      programs: {
        type: 'array', maxItems: 6, items: { type: 'string' },
        description: 'Joseph Center programs named in the conversation, and who was served by each.',
      },
      uncertain: {
        type: 'array', maxItems: 6, items: { type: 'string' },
        description: 'Anything the transcript leaves genuinely unclear, especially who a "she" or "he" refers to. Empty if none.',
      },
    },
    required: ['people', 'timeline', 'programs', 'uncertain'],
  },
};

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

/**
 * Section 2 has a fixed shape — header, hook, what we provide, the month's
 * figures, the bridge closing line, then the referral CTA — and the program
 * facts are all in the brand reference. What it cannot know is what happened
 * this month, so anything the writer has not supplied is asked for rather
 * than filled in.
 */
const SPOTLIGHT_TOOL = {
  name: 'draft_spotlight',
  description: 'Return the drafted program spotlight and anything you had to leave out.',
  input_schema: {
    type: 'object' as const,
    properties: {
      draft: {
        type: 'string',
        description: 'The spotlight in Markdown, in the required order, ending with the referral CTA.',
      },
      gaps: {
        type: 'array', maxItems: 5, items: { type: 'string' },
        description: 'What you needed and did not have, as questions for the writer — this month\'s figures above all. Empty if none.',
      },
    },
    required: ['draft', 'gaps'],
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

    // Everything the writer brings that the transcript cannot: what to focus
    // on, what to leave alone, and answers to what the last pass could not
    // settle. Their own words, not the guest's — the prompt keeps that line.
    const notes = String(body.notes ?? '').trim().slice(0, 4000);
    const facts = String(body.facts ?? '').trim().slice(0, 8000);
    const action = body.action === 'facts' ? 'facts' : body.action === 'section2' ? 'section2' : 'draft';
    const instruction = String(body.instruction ?? '').trim().slice(0, 2000);
    const previousDraft = String(body.previousDraft ?? '').trim().slice(0, 20000);
    const answers = (Array.isArray(body.answers) ? body.answers : [])
      .slice(0, 5)
      .map((a: { question?: unknown; answer?: unknown }) => ({
        question: String(a?.question ?? '').trim().slice(0, 400),
        answer: String(a?.answer ?? '').trim().slice(0, 1000),
      }))
      .filter((a: { question: string; answer: string }) => a.question && a.answer);

    const callAnthropic = (payload: Record<string, unknown>) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, ...payload }),
    });

    const toolInput = (data: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] }, name: string) =>
      (data.content ?? []).find((c) => c.type === 'tool_use' && c.name === name)?.input ?? {};

    const lines = (v: unknown, max: number) =>
      (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim()).filter(Boolean).slice(0, max);

    if (action === 'section2') {
      if (!program) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Set the Section 2 program or theme first.' }) };
      }

      const SPOTLIGHT_SYSTEM = `You draft Section 2 of The Joseph Center's monthly newsletter: the program spotlight. This month's spotlight is ${program}.

${BRAND_REFERENCE_FULL}

Write it in this order, and nothing else:
1. A header, as "## " followed by a title naming the program.
2. One or two sentences of hook — the reason a reader should care this month, not a definition.
3. A short paragraph describing what the program is and who it is for.
4. "**What we provide:**" followed by bullets, drawn from the program's entry in the reference above.
5. A short paragraph on this month's figures. Use ONLY figures the writer has given you. If they have given none, leave this paragraph out and ask for them in gaps — never estimate, never reuse a headline statistic as though it were this month's.
6. The closing line, exactly this shape, with the blank filled in so it reads naturally for this program:

Every person who [action, e.g. "walks through the door for a hot lunch"] is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.

7. The referral CTA: a single line inviting a reader who knows someone in need to [Complete a Referral Form →](josephcentergj.com).

Requirements:
- Do not invent a program detail. If it is not in the reference above or in the writer's notes, it does not go in.
- ${/\bIFS\b|integrated financial services/i.test(program) ? 'This is IFS: say "the people we serve", never "guests" and never "clients".' : 'Say "guests", never "clients".'}
- Temporary housing, never transitional housing. "100% community and foundation funded" in full, or not at all.
- The Joseph Center IS the bridge; donors sustain it. Never "build a bridge".
- First names only, for everyone.${/golden girls/i.test(program) ? '\n- The first mention must be "The Golden Girls Project" in full; "Golden Girls" is fine after that.' : ''}
- Warm and direct. No pity, no urgency tactics, no exaggerated claims.

The writer may add notes or ask for a change. Treat what they tell you as true and use it.

Call draft_spotlight.`;

      const opening = [
        `The spotlight this month is ${program}${monthName ? `, for the ${monthName} newsletter` : ''}.`,
        notes && `Notes from the writer — what happened this month, and anything else that is true:\n\n${notes}`,
      ].filter(Boolean).join('\n\n');

      const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: opening }];
      if (previousDraft) {
        messages.push({ role: 'assistant', content: previousDraft });
        messages.push({
          role: 'user',
          content: [
            answers.length ? `Answers to what you asked for:\n\n${answers.map((a: { question: string; answer: string }) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}` : '',
            instruction && `What to change:\n\n${instruction}`,
            'Redraft the spotlight with this in mind. Keep what is working; change what was asked for. The required order and the closing line still hold.',
          ].filter(Boolean).join('\n\n'),
        });
      }

      const res = await callAnthropic({
        system: SPOTLIGHT_SYSTEM,
        tools: [SPOTLIGHT_TOOL],
        tool_choice: { type: 'tool', name: SPOTLIGHT_TOOL.name },
        messages,
      });
      if (!res.ok) {
        console.error('newsletter-draft (section2): Anthropic returned', res.status, (await res.text()).slice(0, 300));
        return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The drafting service did not answer. Try again in a moment.' }) };
      }
      const data = await res.json() as {
        stop_reason?: string;
        usage?: { input_tokens: number; output_tokens: number };
        content?: { type: string; name?: string; input?: Record<string, unknown> }[];
      };
      const out = toolInput(data, SPOTLIGHT_TOOL.name);
      const spotlight = typeof out.draft === 'string' ? out.draft.trim() : '';
      if (!spotlight) {
        return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Nothing came back. Try again.' }) };
      }
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ draft: spotlight, gaps: lines(out.gaps, 5), cost: priceOf(data.usage) }),
      };
    }

    if (transcript.length < 400) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Paste the transcript first — both sides of the conversation, and the bonus content if there is any.' }) };
    }
    if (!guest || !monthName) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Set the guest name and the month before drafting.' }) };
    }

    if (action === 'facts') {
      const res = await callAnthropic({
        system: `You read a Coffee Chat transcript for The Joseph Center and report what is in it. You do not write prose and you do not interpret.

${guest} is the guest. Work out who else appears, how each is related, and the order events actually happened in — the conversation jumps around, so the order things are mentioned is not the order they occurred. Timestamps are on each turn; a later timestamp is later in the conversation, not necessarily later in the story.

Be precise about who a thing happened to. Where the speaker's "she" or "he" is genuinely ambiguous, do not guess — say so in uncertain.

Use only the transcript.${notes ? ` The writer has also given you notes; treat them as true.` : ''}

Call read_transcript.`,
        tools: [FACTS_TOOL],
        tool_choice: { type: 'tool', name: FACTS_TOOL.name },
        messages: [{ role: 'user', content: [`Coffee Chat transcript:\n\n${transcript}`, notes && `Notes from the writer:\n\n${notes}`].filter(Boolean).join('\n\n') }],
      });

      if (!res.ok) {
        console.error('newsletter-draft (facts): Anthropic returned', res.status, (await res.text()).slice(0, 300));
        return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The reading service did not answer. Try again in a moment.' }) };
      }
      const data = await res.json() as {
        usage?: { input_tokens: number; output_tokens: number };
        content?: { type: string; name?: string; input?: Record<string, unknown> }[];
      };
      const out = toolInput(data, FACTS_TOOL.name);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          people: lines(out.people, 10),
          timeline: lines(out.timeline, 14),
          programs: lines(out.programs, 6),
          uncertain: lines(out.uncertain, 6),
          cost: priceOf(data.usage),
        }),
      };
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

${facts ? `The writer has checked who is in this story and what happened in what order. This is settled — where it differs from your own reading of the transcript, it is right and you are wrong:

${facts}

` : ''}The writer may add notes, answer your questions or ask for a change. Treat what they tell you as true and use it, but it is their account, not the guest's — never put it in quotation marks and never attribute it to anyone as speech. Only the transcript can be quoted. Where a note and the transcript disagree about emphasis, the note wins; where they disagree about fact, raise it in gaps rather than choosing.

Call draft_section.`;

    /**
     * The conversation so far. A first pass is the transcript alone; a redraft
     * hands back what was drafted and what the writer said about it, so the
     * next pass is a revision rather than a fresh start that loses their edits.
     */
    const buildMessages = () => {
      const opening = [
        `Coffee Chat transcript:\n\n${transcript}`,
        notes && `Notes from the writer — true, and to be followed, but not quotable as anyone's speech:\n\n${notes}`,
      ].filter(Boolean).join('\n\n');

      const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: opening }];
      if (!previousDraft) return messages;

      messages.push({ role: 'assistant', content: previousDraft });
      const followUp = [
        answers.length
          ? `Answers to what you said the transcript did not settle:\n\n${answers.map((a: { question: string; answer: string }) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}`
          : '',
        instruction && `What to change:\n\n${instruction}`,
        'Redraft the section with this in mind. Keep what is working; change what was asked for. The requirements and the closing line still hold.',
      ].filter(Boolean).join('\n\n');
      messages.push({ role: 'user', content: followUp });
      return messages;
    };

    const res = await callAnthropic({
      system: SYSTEM,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
      messages: buildMessages(),
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

    const input = toolInput(data, DRAFT_TOOL.name);
    const draft = typeof input.draft === 'string' ? input.draft.trim() : '';
    if (!draft) {
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Nothing came back. Try again.' }) };
    }
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
        quotes: lines(input.quotes, 4),
        gaps: lines(input.gaps, 5),
        appendedBridgeLine: !draft.includes('hope has an address'),
        cost: priceOf(data.usage),
      }),
    };
  } catch (err) {
    console.error('newsletter-draft:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not draft the section' }) };
  }
}
