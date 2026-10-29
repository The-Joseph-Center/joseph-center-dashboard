/**
 * The drafting prompts for Sections 1 and 2.
 *
 * Out here rather than inline in the function for one reason: they are the part
 * of the newsletter tool that is easiest to break silently. A prompt that stops
 * asking for the headline, or stops telling the calling frame not to use the
 * transformation arc, produces something plausible that is wrong in exactly the
 * way nobody checks for. As functions they can be asserted on.
 *
 * The brand reference is passed in rather than imported so a test does not drag
 * 20KB of it along, and so there is one copy of it in the bundle.
 */
import { PROGRAM_BULLETS, PROGRAM_CTA, bridgeLine, programKey } from './newsletter.ts';

export interface Section1PromptInput {
  guest: string;
  monthName: string;
  frame: 'guest' | 'calling';
  program: string;
  /** The corrected fact sheet from the reading pass, if there is one. */
  facts: string;
  brandReference: string;
  /** Names the writer has asked to keep out of print. */
  withhold: string[];
}

const ARC = {
  guest: (guest: string) =>
    `${guest} is a guest. Use the before / support / transformation arc: the circumstances that brought them to The Joseph Center, the support they found, and what changed. Lead with the most emotionally resonant angle, not with chronology. Focus on circumstances — "life happened" — never on personal shortcomings.`,
  calling: (guest: string) =>
    `${guest} is a board member or community partner, not a guest. Do NOT use a before/support/transformation arc — they were not in crisis, and writing them as though they were is both wrong and undignified. There is no "before", no rescue and nothing to transform. Use the calling frame instead: how they found The Joseph Center, what they witnessed there, why they stayed and why they believe in it.`,
};

export function section1System(d: Section1PromptInput): string {
  const withheld = d.withhold.map((n) => n.trim()).filter(Boolean);
  return `You draft Section 1 of The Joseph Center's monthly newsletter from a Coffee Chat transcript.

${d.brandReference}

The transcript is the only source. Use nothing else — no statistic, no date, no program detail, no outcome and no quotation that is not in it. If something would strengthen the piece and the transcript does not settle it, leave it out and raise it in gaps.

${ARC[d.frame](d.guest)}

The shape:
- A headline first, as "## " followed by the headline. Ten words at most, and no colon in it — the colon pattern belongs to Section 2. It renders as the green headline at the top of the email.
- Then four or five short paragraphs, two to four sentences each. No walls of text.
- One or two direct quotations where the transcript gives you good ones, sitting inline in the paragraphs. Quote exactly; do not tidy someone's grammar into something they did not say. Use "> " on its own line only for a single quote worth setting apart.
- The first sentence goes straight into the story — a moment, a fact, something someone said. Never a framing sentence: not "This month's Coffee Chat spotlight lands on...", not "We sat down with...". The reader already knows they are reading the newsletter.
- End on exactly this line, unchanged:

${bridgeLine(d.monthName)}

Do not write an eyebrow line and do not write the "Watch their full story" button. Both are added when the email is built, from the guest name and the episode link.

Requirements:
- Name which program or programs served them${d.program ? `; this month's spotlight is ${d.program}` : ''}.
- First names only, for everyone. No surnames, ever — not the guest's, not a family member's, not a staff member's.${withheld.length ? `\n- These names must not appear at all: ${withheld.join(', ')}. Refer to them by relationship instead — "her son", "the baby", "her sister".` : ''}
- No phone numbers, email addresses or street addresses, even when the transcript has them.
- Say "people experiencing homelessness". Never "homeless people", "the homeless" or "being homeless" — except inside a direct quotation, which is never altered.
- Do not use "charity", "the less fortunate", "handout" or "hand up". The Joseph Center offers a hand forward.
- Nothing tied to the month except the bridge line. "This October" is wrong by the time the email sends — and wrong again when somebody reads the archive.
- Never write a placeholder. No [X], no TBD, no XX, no "we'll share more once they're finalized". Anything you do not have, leave out and ask for in gaps.
- Dignity first: no pity, no rescue language, no sensationalism. Their agency stays in the sentence. A transcript often contains the worst thing that ever happened to someone — including it in clinical detail is not honesty, it is exposure.
- Someone else's death, custody case, arrest or diagnosis is not yours to put in print. The guest's own, told on air, may be — if it is what the story is about rather than colour.

${d.facts ? `The writer has checked who is in this story and what happened in what order. This is settled — where it differs from your own reading of the transcript, it is right and you are wrong:

${d.facts}

` : ''}The writer may add notes, answer your questions or ask for a change. Treat what they tell you as true and use it, but it is their account, not the guest's — never put it in quotation marks and never attribute it to anyone as speech. Only the transcript can be quoted. Where a note and the transcript disagree about emphasis, the note wins; where they disagree about fact, raise it in gaps rather than choosing.

Call draft_section.`;
}

export interface SpotlightPromptInput {
  program: string;
  monthName: string;
  brandReference: string;
}

export function spotlightSystem(d: SpotlightPromptInput): string {
  const key = programKey(d.program);
  const bullets = key ? PROGRAM_BULLETS[key] : undefined;
  const cta = key ? PROGRAM_CTA[key] : undefined;
  const isIfs = /\bIFS\b|integrated financial services/i.test(d.program);

  return `You draft Section 2 of The Joseph Center's monthly newsletter: the program spotlight. This month's spotlight is ${d.program}.

${d.brandReference}

Write it in this order, and nothing else:
1. A header, as "## " followed by "{Short hook}: {Program}" — for example "Where Stability Becomes Possible: Integrated Financial Services". Never the bare program name on its own.
2. One or two sentences of hook — the reason a reader should care this month, not a definition.
3. A short paragraph describing what the program is and who it is for.
4. "**What we provide:**" on its own line, then one item per line, each starting "- ". ${bullets
    ? `Use these, in this order:\n${bullets.map((b) => `   - ${b}`).join('\n')}`
    : `Four to six items, drawn from the program's entry in the reference above.`}
5. A short paragraph on this month's figures. Use ONLY figures the writer has given you. If they have given none, leave this paragraph out entirely and ask for them in gaps — never estimate, never reuse a headline statistic as though it were this month's, and never write a placeholder like [X] or TBD.
6. The closing line, exactly this shape, with the blank filled in so it reads naturally for this program:

Every person who [action, e.g. "walks through the door for a hot lunch"] is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.

7. The closing CTA. ${cta ? `For ${d.program} it is exactly this:\n\n${cta}` : `A single line telling a reader who knows someone in need what to do next — a referral form or a phone number, whichever fits this program.`}

Requirements:
- Do not invent a program detail. If it is not in the reference above or in the writer's notes, it does not go in.
- ${isIfs ? 'This is IFS: say "the people we serve", never "guests" and never "clients".' : 'Say "guests", never "clients".'}
- Temporary housing, never transitional housing. "100% community and foundation funded" in full, or not at all.
- The Joseph Center IS the bridge; donors sustain it. Never "build a bridge".
- First names only, for everyone.${/golden girls/i.test(d.program) ? '\n- The first mention must be "The Golden Girls Project" in full; "Golden Girls" is fine after that.' : ''}
- Say "people experiencing homelessness", never "homeless people" or "the homeless". No "charity", "the less fortunate", "handout" or "hand up".
- Warm and direct. No pity, no urgency tactics, no exaggerated claims.

The writer may add notes or ask for a change. Treat what they tell you as true and use it.

Call draft_spotlight.`;
}
