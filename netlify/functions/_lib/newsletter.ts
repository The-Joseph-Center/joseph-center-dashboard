/**
 * The parts of the monthly newsletter that are fixed.
 *
 * The process document is emphatic that the subject-line pattern and the
 * Section 4 blocks are established and "do not deviate". So they are templates
 * here, not something generated fresh each month: a model asked to rewrite
 * settled copy will vary it, and the variation is the bug. Only the guest
 * story and the program spotlight are actually written each month.
 *
 * The review checks are taken directly from the document's "Common Errors
 * Caught in Review" table, which says these should be flagged automatically by
 * any builder tool. Every one of them is a string test, so none of them costs
 * anything or depends on a model being in a good mood.
 */

export type TierId = 'community-friend' | 'donor' | 'recurring-donor';

export interface Tier {
  id: TierId;
  label: string;
  aweberTag: string;
  /** Tags whose subscribers must NOT receive this version. */
  excludes: string[];
  signature: string;
  subject: (month: string) => string;
  section4Header: string;
  personalLetterCta: boolean;
  replyCta: boolean;
}

export const TIERS: Tier[] = [
  {
    id: 'community-friend',
    label: 'Community friend',
    aweberTag: 'community-friend',
    excludes: ['donor', 'repeat-donor', 'recurring-donor', 'vip', 'vip-repeat', 'vip-engaged'],
    signature: 'The Joseph Center Team',
    subject: (m) => `${m} at The Joseph Center`,
    section4Header: 'Become a Stability Partner',
    personalLetterCta: false,
    replyCta: false,
  },
  {
    id: 'donor',
    label: 'Donor / repeat donor',
    aweberTag: 'donor',
    excludes: ['community-friend', 'recurring-donor', 'vip', 'vip-repeat', 'vip-engaged'],
    signature: 'Mona Highline, Founder & CEO',
    subject: (m) => `Because of you: ${m} at The Joseph Center`,
    section4Header: 'You Already Answered the Call',
    personalLetterCta: true,
    replyCta: false,
  },
  {
    id: 'recurring-donor',
    label: 'Recurring donor',
    aweberTag: 'recurring-donor',
    excludes: ['community-friend', 'donor', 'repeat-donor', 'vip', 'vip-repeat', 'vip-engaged'],
    signature: 'Mona Highline, Founder & CEO',
    subject: (m) => `Your impact this ${m} at The Joseph Center`,
    section4Header: 'You Make This Possible — Every Single Month',
    personalLetterCta: true,
    replyCta: false,
  },
];
// The reply CTA is recurring-donor only, and commits "someone from our team"
// rather than Mona personally — the document is explicit about that wording.
TIERS[2]!.replyCta = true;

export const DONATE_URL = 'josephcentergj.com/donate';
export const VOLUNTEER_URL = 'josephcentergj.com/forms/volunteer';
export const LETTER_URL = 'josephcentergj.com/forms/personal-letter/';
export const REFERRAL_URL = 'josephcentergj.com/forms/referral';
// The Coffee Chat guest form moved onto the site. The Google Form it replaced
// is retired, and a newsletter that still points at it is a must-fix: the
// brand reference listed the old link until this was found in September's copy.
export const APPLY_URL = 'josephcentergj.com/media/apply';

/**
 * Contact details that are The Joseph Center's own.
 *
 * Section 1 and 2 are written from a transcript of a real conversation, and a
 * transcript is full of other people's phone numbers and addresses. So any
 * contact detail in those sections is treated as a leak unless it is one of
 * these — published, and ours to publish.
 */
export const JC_PHONES = ['(970) 245-9425', '(970) 985-6133', '(970) 985-5114'];
export const JC_EMAILS = ['jc@josephcentergj.com', 'ephifer@josephcentergj.com', 'josephcentergj@gmail.com'];

/** First names that appear in newsletter copy by design, from the brand reference. */
export const ROSTER_FIRST_NAMES = ['Mona', 'Shawna', 'Khira', 'Sarah', 'Jennifer', 'Vangie'];

/** Section 3's fixed opening line, above the episode list. */
export const SECTION3_INTRO =
  'Every month, Mona sits down with guests, volunteers, and community members to share real stories of transformation.';

/** The label the episode list sits under: last month's videos, named as such. */
export const episodesLabel = (month: string) => `${prevMonthName(month)}'s episodes:`;

/** The line Section 1 must end on, with the month filled in. */
export const bridgeLine = (month: string) =>
  `This is what we mean when we say hope has an address. And this ${month}, we're inviting you to help us strengthen the bridge from crisis to stability across the Western Slope of Colorado.`;

const PERSONAL_LETTER = `Would you like to receive a personal letter from Mona? Share your mailing address and she'll be in touch. [Add your address →](${LETTER_URL})`;
const REPLY = `Have a question or just want to share something? Reply to this email and someone from our team will get back to you. We're always happy to hear from our partners.`;

/**
 * The one sentence in Section 4 that assumes the guest was helped.
 *
 * The donor and recurring-donor versions both open by crediting the reader for
 * the month's story. That is true of a guest and wrong of a community partner
 * or board member: nobody's giving produced Denise's decision to volunteer. So
 * the calling frame needs its own sentence for those two tiers.
 *
 * TODO: Eric is supplying this wording. Until then the frame-neutral sentence
 * below stands and the review raises a should-fix, rather than this inventing
 * copy for a settled block.
 */
export const CALLING_SECTION4_VARIANTS: Record<'donor' | 'recurring-donor', string> = {
  donor: '',
  'recurring-donor': '',
};

export interface Section4Options {
  frame?: 'guest' | 'calling';
  /** Overrides for the frame-sensitive sentence, by tier id. */
  variants?: Partial<Record<'donor' | 'recurring-donor', string>>;
}

export function section4(tier: Tier, month: string, guest: string, opts: Section4Options = {}): string {
  const who = guest || 'this month’s guest';
  const variants = { ...CALLING_SECTION4_VARIANTS, ...(opts.variants ?? {}) };
  const variantFor = (id: 'donor' | 'recurring-donor') =>
    (opts.frame === 'calling' ? (variants[id] ?? '').trim() : '');
  if (tier.id === 'community-friend') {
    return `## ${tier.section4Header}

The Joseph Center is the bridge between crisis and stability. Every month, our Bridge to Stability campaign keeps that bridge standing for people across the Western Slope of Colorado.

**Your monthly partnership strengthens the bridge.**

A recurring gift is what lets us plan — to keep beds open, meals cooked and doors unlocked without waiting to see what arrives. Predictable support is what turns a good month into a program someone can rely on.

The Joseph Center is 100% community and foundation funded.

[Become a Monthly Stability Partner →](${DONATE_URL})

Prefer to give once? A one-time gift goes to work the day it arrives.

[Give One Time →](${DONATE_URL})`;
  }

  if (tier.id === 'donor') {
    const opener = variantFor('donor')
      || `You have already given to The Joseph Center, and ${who}'s story this ${month} is part of what that made possible.`;
    return `## ${tier.section4Header}

${opener}

Would you consider making it monthly? A recurring gift is the difference between hoping the support is there and knowing it is. It lets us plan months ahead instead of weeks.

- $15/month
- $25/month
- $50/month
- $100/month

[Become a Monthly Stability Partner →](${DONATE_URL})

Prefer to give once again this month? That matters too.

[Give One Time →](${DONATE_URL})

${PERSONAL_LETTER}`;
  }

  const recurringOpener = variantFor('recurring-donor')
    || `${who}'s story this ${month} happened because people like you give every month, without being asked twice.`;
  return `## ${tier.section4Header}

${recurringOpener}

Recurring support is what lets The Joseph Center plan — to hold a bed open, to keep the kitchen running, to say yes when someone walks in on a Tuesday with nowhere else to go.

**You built that.**

We don't take that for granted.

If you would like to hear more about what your partnership is doing across the Western Slope, we would be glad to tell you.

${PERSONAL_LETTER}

${REPLY}`;
}

export function closingSection(partners: { name: string; url: string }[]): string {
  const list = partners.length
    ? partners.map((p) => `- [${p.name}](${p.url})`).join('\n')
    : '- (confirm this quarter’s foundation partners)';
  return `## Building Community Support Together

None of this works without the foundations and businesses who stand alongside us.

**This Quarter's Foundation Partners:**

${list}

Want to see your business or foundation featured as a community partner? [Contact us →](josephcentergj.com/contact)

Can't donate right now? Volunteering is just as valuable. We're especially looking for a photographer to capture life at The Joseph Center — around 50–75 images monthly. We'll credit your work. [Learn more about volunteering →](${VOLUNTEER_URL})

The Joseph Center is a bridge. Whether you give, volunteer, or simply share our story, you're helping strengthen the pathway from crisis to stability for families across the Western Slope.

Thank you for being part of this community.`;
}

// ── Section 2: what each program actually offers ───────────────────────────

/**
 * The "What we provide" bullets, from section 4 of the brand reference.
 *
 * Held here rather than left to the drafting model, which was asked to "draw
 * them from the reference" and could therefore drop one. Day Shelter carries
 * the noon lunch: it is listed under Food Pantry in the reference, but it is
 * the same door and the same hours, and a Day Shelter spotlight that leaves
 * out lunch leaves out the thing most people come for.
 */
export const PROGRAM_BULLETS: Record<string, string[]> = {
  'day shelter': [
    'Hot, homemade lunch served at noon, Tuesday–Friday',
    'Computer access for job applications',
    'Laundry services',
    'A safe space for children',
    'Open Tuesday–Friday, 9am–1pm',
  ],
  'food pantry': [
    'Hot, homemade, nutritious lunches served at noon, Tuesday–Friday',
    'Food boxes, once per month per family, by request',
    'Snack packs for on-the-go sustenance',
  ],
  'integrated financial services': [
    'Representative payee services for Social Security and VA benefits',
    'Guardianship and conservatorship services',
    'Budget counseling and weekly financial assessments',
    'Advocacy and liaison with the SSA and the VA',
    'Connections to medical, mental health and workforce resources',
  ],
  'family center': [
    'Family Engagement Meetings and home visits',
    'Court support and advocacy',
    'Life skills building and peer-to-peer mentoring',
    'Educational classes and support groups',
    'Individualized assessment plans with weekly follow-up',
    'A safe, supportive space for unhoused moms and moms-to-be',
  ],
  'golden girls project': [
    '16 beds, up to 6 months free of charge',
    'Budgeting classes, with a 30% savings goal',
    'Help obtaining IDs, birth certificates and social security cards',
    'Connections to Medicaid, Medicare, SNAP, VA resources and long-term housing assistance',
    'Monthly tea parties at Peer 180',
    'Recovery meetings, cooking classes and on-site laundry',
    'An on-site health clinic the last Wednesday of each month, through Marillac Medical Clinic',
  ],
};

/**
 * How Section 2 ends, per program.
 *
 * Not one CTA for everything: the Day Shelter's answer to "I need help" is to
 * come to the door during opening hours, and the Family Center's is a referral
 * form. A generic "contact us" is the version that helps nobody.
 */
export const PROGRAM_CTA: Record<string, string> = {
  'day shelter': `Need somewhere to start? Call (970) 985-6133 or come by Tuesday–Friday, 9am–1pm — walk-ins are welcome.`,
  'food pantry': `Lunch is at noon, Tuesday–Friday, and walk-ins are welcome. Call (970) 985-6133 with any questions.`,
  'integrated financial services': `To ask about representative payee services, call (970) 985-5114.`,
  'family center': `Know a parent who needs support? [Complete a Referral Form →](${REFERRAL_URL})`,
  'golden girls project': `Know a woman 50 or older who needs somewhere safe? [Complete a Referral Form →](${REFERRAL_URL})`,
};

/** Which of the five programs a month's free-text program field means, if any. */
export function programKey(program: string): string | null {
  const p = (program ?? '').toLowerCase();
  if (/\bifs\b|integrated financial/.test(p)) return 'integrated financial services';
  if (/golden girls/.test(p)) return 'golden girls project';
  if (/family center/.test(p)) return 'family center';
  if (/food pantry|pantry/.test(p)) return 'food pantry';
  if (/day shelter|shelter/.test(p)) return 'day shelter';
  return null;
}

// ── Section 3: stats and last month's episodes ─────────────────────────────

export interface Video { title: string; url: string; kind?: string }

/** A short, as YouTube reports it — the duration call already worked this out. */
export const isShort = (v: Video) =>
  /^short$/i.test(v.kind ?? '') || /\/shorts\//i.test(v.url ?? '') || /#shorts\b/i.test(v.title ?? '');

export const watchLabel = (v: Video) => (isShort(v) ? 'Watch Short:' : 'Watch:');

/**
 * A video title in quotation marks, once.
 *
 * Titles are quoted exactly as YouTube publishes them, and some of them are
 * already a quotation — "I didn't have my own bed" is the whole title. Wrapping
 * that again produced ""I didn't have my own bed"", which is how October went
 * out. Nothing inside the title changes; only the wrapping.
 */
export function quoteTitle(raw: string): string {
  const t = (raw ?? '').trim().replace(/[“”"]{2,}/g, (m) => m[0]!);
  const open = /^[“"]/.test(t);
  const close = /[”"]$/.test(t);
  if (open && close) return t.replace(/^"/, '“').replace(/"$/, '”');
  if (open) return `${t.replace(/^"/, '“')}”`;
  if (close) return `“${t.replace(/"$/, '”')}`;
  return `“${t}”`;
}

export const section3Header = (month: string, monthName: string) =>
  `${monthName} Impact & ${prevMonthName(month)} Videos`;

/**
 * Section 3 as plain text, in the order it appears in the email.
 *
 * One composer for the copy-out and one renderer for the HTML, both reading
 * the same constants — the fixed intro line and the episodes label were
 * dropped from October because each place built Section 3 its own way.
 */
export function composeSection3(d: {
  month: string; monthName: string;
  stats: Record<string, string>;
  videos: Video[];
}): string {
  const figures = Object.entries(d.stats ?? {}).filter(([, v]) => String(v ?? '').trim());
  const live = (d.videos ?? []).filter((v) => v.title?.trim() && v.url?.trim());
  return [
    `## ${section3Header(d.month, d.monthName)}`,
    figures.length ? `**This Month in Numbers**\n\n${figures.map(([k, v]) => `- ${k}: ${v}`).join('\n')}` : '',
    SECTION3_INTRO,
    live.length ? `**${episodesLabel(d.month)}**` : '',
    live.length ? live.map((v) => `[${watchLabel(v)} ${quoteTitle(v.title)}](${v.url})`).join('\n\n') : '',
    `Want to be a guest? [Apply here →](${APPLY_URL})`,
  ].filter(Boolean).join('\n\n');
}

/**
 * What to set up in AWeber this month.
 *
 * The wait step is days remaining until the end of the month, so the send lands
 * at month-end however early the newsletter gets built. Computed on the local
 * calendar for the same reason every other date in this dashboard is.
 */
export function aweberPlan(month: string, today: Date) {
  const [y, m] = month.split('-').map(Number);
  const name = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toLowerCase();
  const endOfMonth = new Date(Date.UTC(y!, m!, 0));
  const startOfToday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const waitDays = Math.max(0, Math.round((endOfMonth.getTime() - startOfToday.getTime()) / 86400000));
  // The year is in the tag from here on. "sep-newsletter" works exactly once:
  // next September it would re-trigger the automation that already ran, and
  // "subscribers can enter once" means the people who received the old one are
  // silently skipped while everyone else gets last year's newsletter.
  return { tag: `${name}-${y}-newsletter`, waitDays, endOfMonth: endOfMonth.toISOString().slice(0, 10) };
}

// ── Review ────────────────────────────────────────────────────────────────

export type Severity = 'must' | 'should';
export interface Issue { severity: Severity; where: string; problem: string; fix: string }

export interface NewsletterDraft {
  month: string;            // 'YYYY-MM'
  monthName: string;        // 'September'
  guestName: string;
  program: string;
  section1: string;
  section2: string;
  stats: Record<string, string>;
  videos: Video[];
  partners: { name: string; url: string }[];
  previewText: string;
  aweberTag: string;
  usedTags: string[];       // tags already used in previous months
  staffSurnames: string[];  // from the directory, for the no-last-names rule

  /** 'calling' for a board member or community partner; 'guest' otherwise. */
  guestFrame?: 'guest' | 'calling';
  /** The Coffee Chat episode this month's story came from — Section 1's button. */
  coffeeChatUrl?: string;
  /**
   * Names that must not appear, whatever the transcript says: a minor, someone
   * who did not consent, a third party in a court matter. The writer sets these
   * and nothing else can infer them.
   */
  withholdNames?: string[];
  /** The transcript, so a name said out loud can be recognised in the prose. */
  transcript?: string;
  /** Calling-frame replacements for Section 4's frame-sensitive sentence. */
  section4Variants?: Partial<Record<'donor' | 'recurring-donor', string>>;
}

/**
 * Names that must not be mistaken for someone's surname.
 *
 * The directory really does contain the surname "Girls", so "The Golden Girls
 * Project" tripped the first-names-only rule on every Golden Girls newsletter —
 * a check that cries wolf on the correct official name is worse than no check.
 * Program and partner names are blanked before the surname test runs.
 */
const PROTECTED = [
  'The Golden Girls Project', 'Golden Girls Project', 'Golden Girls',
  'The Joseph Center', 'Joseph Center', 'Day Shelter', 'Food Pantry',
  'Family Center', 'Integrated Financial Services', 'Stability Partners',
  'Coffee Chat', 'Western Slope', 'Grand Junction', 'Grand Valley',
  'Peer 180', 'Next 50 Initiative', 'Bridge to Stability',
];
const maskProtected = (text: string) =>
  PROTECTED.reduce((t, phrase) => t.split(phrase).join(' '.repeat(phrase.length)), text);

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const prevMonthName = (month: string) => {
  const m = Number(month.split('-')[1]);
  return MONTHS[(m - 2 + 12) % 12]!;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The prose with every quotation taken out.
 *
 * Terminology rules apply to what The Joseph Center writes, not to what a
 * guest said. Somebody describing themselves as homeless in their own words is
 * their sentence to own; the same phrase in our narration is a house-style
 * error. Pulled quotes (lines starting "> ") and anything inside double
 * quotation marks come out before the terminology checks run.
 */
export function outsideQuotes(text: string): string {
  return (text ?? '')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .replace(/[“"][^“”"]*[”"]/g, ' ');
}

/** Words that follow a first name without making it a surname. */
const NOT_A_SURNAME = new Set([
  ...MONTHS,
  'I', 'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'She', 'He', 'They', 'We', 'It',
  'Her', 'His', 'Their', 'Our', 'But', 'And', 'When', 'Then', 'After', 'Before', 'Now',
  'Today', 'Every', 'Because', 'So', 'If', 'What', 'Who', 'There', 'Here', 'One', 'Two',
  'Joseph', 'Center', 'Coffee', 'Chat', 'Golden', 'Girls', 'Project', 'Shelter', 'Pantry',
  'Family', 'Western', 'Slope', 'Grand', 'Junction', 'Colorado', 'Stability', 'Partners',
  'Bridge', 'Peer', 'Medicaid', 'Medicare', 'SNAP', 'VA', 'SSA', 'IFS', 'GAP', 'CPS',
]);

/**
 * First names heard in the transcript.
 *
 * Speaker labels ("[02:14] MONA:") and any "First Last" pair somebody says out
 * loud. The point is not to collect surnames but to know which first names are
 * in play, so that "Denise Vandenberg" in the prose can be recognised as one
 * person's full name rather than two ordinary words.
 */
export function namesInTranscript(transcript: string): string[] {
  const out = new Set<string>();
  const title = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  for (const m of (transcript ?? '').matchAll(/^\s*(?:\[[^\]]*\]\s*)?([A-Za-z][A-Za-z'’-]{1,})\s*:/gm)) {
    if (m[1]) out.add(title(m[1]));
  }
  for (const m of (transcript ?? '').matchAll(/\b([A-Z][a-z]{2,})\s+[A-Z][a-z]{2,}\b/g)) {
    if (m[1] && !NOT_A_SURNAME.has(m[1])) out.add(m[1]);
  }
  return [...out].slice(0, 60);
}

const CONTACT_PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const CONTACT_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const onlyDigits = (s: string) => s.replace(/\D+/g, '');
const JC_PHONE_DIGITS = new Set(JC_PHONES.map(onlyDigits));
const JC_EMAIL_SET = new Set(JC_EMAILS.map((e) => e.toLowerCase()));

/** Wording that goes out of date between drafting and sending, or never got filled in. */
const PLACEHOLDERS: { re: RegExp; what: string }[] = [
  { re: /\[\s*X+\s*\]/i, what: '[X]' },
  { re: /\bTBD\b/i, what: 'TBD' },
  { re: /(?<![A-Za-z])XX+(?![A-Za-z])/, what: 'XX' },
  { re: /once (?:they|we)(?:'|’)?re? finali[sz]ed/i, what: '"once they\'re finalized"' },
  { re: /\bwe(?:'|’)ll share\b/i, what: '"we\'ll share"' },
];

/** Stat labels that are the tool's own scaffolding rather than a measurement. */
const PLACEHOLDER_STAT_LABELS = ['program spotlight stat', 'spotlight stat', 'ifs financial stability'];

/** A stat label has to say what is being counted. */
const UNIT_NOUN = /\b(people|persons?|individuals?|guests?|families|households|women|men|children|kids|parents|moms|veterans|residents|neighbors|meals|lunches|boxes|packs|nights|beds|visits|hours|calls|appointments|referrals|loads|showers|rides|classes|sessions)\b/i;

const MUST_TERMS: { re: RegExp; problem: string; fix: string }[] = [
  { re: /\bhomeless people\b/i, problem: '"Homeless people" appears outside a quotation.', fix: 'Say "people experiencing homelessness".' },
  { re: /\bthe homeless\b/i, problem: '"The homeless" appears outside a quotation.', fix: 'Say "people experiencing homelessness".' },
  { re: /\bbeing homeless\b/i, problem: '"Being homeless" appears outside a quotation.', fix: 'Say "experiencing homelessness".' },
];

const SHOULD_TERMS: { re: RegExp; problem: string; fix: string }[] = [
  { re: /\bcharity\b/i, problem: '"Charity" appears outside a quotation.', fix: 'The Joseph Center is a community partnership, not a charity.' },
  { re: /\bthe less fortunate\b/i, problem: '"The less fortunate" appears outside a quotation.', fix: 'Name who is being served instead — neighbors, guests, the people we serve.' },
  { re: /\bhandout\b/i, problem: '"Handout" appears outside a quotation.', fix: 'The Joseph Center offers a hand forward.' },
  { re: /\bhand up\b/i, problem: '"Hand up" appears outside a quotation.', fix: 'JC now says "a hand forward".' },
];

/**
 * Things in a draft that belong to somebody who did not sit down for the
 * interview. Flagged, never removed: a guest's own arrest or diagnosis may be
 * exactly what they came to talk about, and that is theirs to tell. It is the
 * third party — a child, a sibling, an ex — who cannot weigh in.
 */
const SENSITIVE = [
  { re: /\b(died|death|passed away|funeral|overdosed?)\b/i, what: 'a death' },
  { re: /\b(custody|foster care|foster placement|CPS|removed from the home)\b/i, what: 'custody or foster placement' },
  { re: /\b(arrest(?:ed)?|jail|prison|incarcerat(?:ed|ion)|charges|convict(?:ed|ion))\b/i, what: 'an arrest or conviction' },
  { re: /\b(diagnos(?:is|ed)|cancer|schizophreni\w*|bipolar|addiction|relapsed?|overdose|HIV|dementia|alzheimer\w*)\b/i, what: 'a medical condition' },
];

export function sensitiveMentions(text: string): string[] {
  return SENSITIVE.filter((s) => s.re.test(text ?? '')).map((s) => s.what);
}

/** Openers that introduce the story instead of starting it. */
const FRAMING_PHRASES = [
  /coffee chat spotlight/i,
  /spotlight (?:lands|falls|turns|shines)/i,
  /this month(?:'|’)s (?:guest|story|spotlight|coffee chat)/i,
  /we sat down with/i,
  /we caught up with/i,
  /in this month(?:'|’)s (?:newsletter|edition|issue)/i,
];

/**
 * Section 1 split into its parts: the headline, if it has one, and the prose.
 *
 * The eyebrow is not stored — it is "COFFEE CHAT WITH {GUEST}", which the
 * renderer derives from the guest name, so there is nothing to get wrong and
 * nothing to check.
 */
export function section1Parts(section1: string): { headline: string; body: string } {
  const lines = (section1 ?? '').split('\n');
  const i = lines.findIndex((l) => l.trim());
  const first = (lines[i] ?? '').trim();
  const headline = /^#{1,3}\s+/.test(first) ? first.replace(/^#{1,3}\s+/, '').trim() : '';
  const body = (headline ? lines.slice(i + 1) : lines).join('\n').trim();
  return { headline, body };
}

/** The first sentence of the prose, for the "straight into the story" rule. */
const firstSentence = (body: string) => (body.split(/(?<=[.!?])\s/)[0] ?? '').trim();

export function reviewNewsletter(d: NewsletterDraft): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, where: string, problem: string, fix: string) =>
    issues.push({ severity, where, problem, fix });

  const body = [d.section1, d.section2].join('\n\n');
  const everything = [body, d.previewText].join('\n\n');
  const isIfs = /\bIFS\b|integrated financial services/i.test(d.program);

  // ── straight from the Common Errors table ──
  if (/transitional housing/i.test(everything))
    add('must', 'Terminology', '"Transitional housing" appears.', 'Use "temporary housing".');

  if (isIfs && /\bclients?\b/i.test(everything))
    add('must', 'IFS terminology', '"Clients" appears in an IFS newsletter.', 'IFS uses "the people we serve".');

  if (/community[- ]funded/i.test(everything) && !/community and foundation funded/i.test(everything))
    add('must', 'Funding language', '"Community-funded" appears without the approved phrasing.', 'Use "100% community and foundation funded" in full.');

  if (/\bbuild(?:ing)? (?:a|the) bridge\b/i.test(everything))
    add('must', 'Bridge positioning', 'Donors are described as building the bridge.', 'The Joseph Center IS the bridge — donors sustain it.');

  if (/harness|coloradogives/i.test(everything))
    add('must', 'Giving link', 'A retired Harness or Colorado Gives link is present.', `All giving CTAs point to ${DONATE_URL}.`);

  if (d.program && /golden girls/i.test(d.program)) {
    const firstMention = d.section2.search(/golden girls/i);
    const formal = d.section2.search(/The Golden Girls Project/);
    if (firstMention !== -1 && (formal === -1 || formal > firstMention))
      add('must', 'Section 2', '"Golden Girls" is used before the official name.', 'First mention must be "The Golden Girls Project".');
  }

  for (const surname of d.staffSurnames) {
    // Preceded by a capitalised word, so this fires on "Mona Highline" and not
    // on a surname that happens to be an ordinary word in another sentence.
    if (new RegExp(`\\b[A-Z][a-z]+\\s+${surname}\\b`).test(maskProtected(everything)))
      add('must', 'No last names', `"${surname}" appears as part of a full name.`, 'First names only, everywhere, for everyone.');
  }

  // Guest name has to be current in every Section 4 — the document lists this
  // as an error that recurs because the block is copied from last month.
  if (!d.guestName)
    add('must', 'Section 4', 'No guest or partner named for this month.', 'Set the guest — all three Section 4 versions reference them.');

  // The Section 3 header used to be checked here, against a string built the
  // same way twice. It is generated by section3Header() now — the one place it
  // can be wrong is the one place it is built — so there is nothing to compare.

  const placeholder = Object.entries(d.stats).filter(([, v]) => !String(v ?? '').trim() || /^(tbd|xx+|\?+|0)$/i.test(String(v).trim()));
  if (placeholder.length)
    add('must', 'Section 3', `Stats not filled in: ${placeholder.map(([k]) => k).join(', ')}.`, 'Stats come from the program directors and are never estimated.');

  if (!d.videos.length)
    add('must', 'Section 3', 'No Coffee Chat videos listed.', `Last month's videos go here — usually four or five. Titles must match YouTube exactly.`);
  for (const v of d.videos) {
    if (!v.title?.trim() || !v.url?.trim())
      add('must', 'Section 3', 'A video is missing its title or link.', 'Never fabricate or estimate a title.');
    else if (!/^https?:\/\//.test(v.url))
      add('should', 'Section 3', `"${v.title}" has a link that does not look like a URL.`, 'Paste the full YouTube link.');
  }

  if (d.usedTags.includes(d.aweberTag))
    add('must', 'AWeber', `The tag "${d.aweberTag}" has been used before.`, 'Monthly tags cannot be reused — subscribers can only enter an automation once.');

  if (d.aweberTag && !/\d{4}/.test(d.aweberTag))
    add('must', 'AWeber', `"${d.aweberTag}" has no year in it.`, `Use "${d.aweberTag.replace(/-newsletter$/, '')}-${d.month.slice(0, 4)}-newsletter" — without a year the same tag comes round again next year and re-triggers an automation that has already run.`);

  // ── Names that should not be in print ──────────────────────────────────
  //
  // The surname check above works from the staff directory, which only knows
  // about staff. A guest's surname and a child's first name both reached the
  // October draft because nothing was looking for them. These two checks look.
  const prose = maskProtected(body);
  const written = [body, d.previewText, ...(d.videos ?? []).map((v) => v.title ?? ''), ...Object.keys(d.stats ?? {})].join('\n');

  const firstNames = new Set<string>();
  const firstToken = (n: string) => (n ?? '').trim().split(/\s+/)[0] ?? '';
  if (d.guestName) firstNames.add(firstToken(d.guestName));
  for (const n of ROSTER_FIRST_NAMES) firstNames.add(n);
  for (const n of namesInTranscript(d.transcript ?? '')) firstNames.add(n);

  const seenPairs = new Set<string>();
  for (const first of firstNames) {
    if (first.length < 2) continue;
    for (const m of prose.matchAll(new RegExp(`\\b${escapeRe(first)}\\s+([A-Z][A-Za-z'’-]+)\\b`, 'g'))) {
      const last = m[1]!;
      if (NOT_A_SURNAME.has(last)) continue;
      const pair = `${first} ${last}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      add('must', 'No last names', `"${pair}" reads as a full name.`, 'First names only, everywhere, for everyone.');
    }
  }

  for (const raw of d.withholdNames ?? []) {
    const name = raw.trim();
    if (name.length < 2) continue;
    if (new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(written)) {
      add('must', 'Names to withhold', `"${name}" is on the withhold list and is still in the draft.`,
        'Take it out, or replace it with a relationship — "her son", "the baby".');
    }
  }

  // ── Contact details ────────────────────────────────────────────────────
  const nationalDigits = (s: string) => {
    const n = onlyDigits(s);
    return n.length === 11 && n.startsWith('1') ? n.slice(1) : n;
  };
  for (const found of body.match(CONTACT_PHONE) ?? []) {
    if (JC_PHONE_DIGITS.has(nationalDigits(found))) continue;
    add('must', 'Contact details', `A phone number appears in the story: ${found}.`,
      `Only JC's own published numbers belong in the newsletter: ${JC_PHONES.join(', ')}.`);
  }
  for (const found of body.match(CONTACT_EMAIL) ?? []) {
    if (JC_EMAIL_SET.has(found.toLowerCase())) continue;
    add('must', 'Contact details', `An email address appears in the story: ${found}.`,
      'Take it out. Someone who wants to be reachable can be reached through The Joseph Center.');
  }

  // ── Terminology, outside what people actually said ─────────────────────
  const narration = outsideQuotes(body);
  for (const t of MUST_TERMS) if (t.re.test(narration)) add('must', 'Terminology', t.problem, t.fix);
  for (const t of SHOULD_TERMS) if (t.re.test(narration)) add('should', 'Terminology', t.problem, t.fix);

  // ── Placeholders ───────────────────────────────────────────────────────
  const section3Text = [
    ...Object.entries(d.stats ?? {}).map(([k, v]) => `${k}: ${v}`),
    ...(d.videos ?? []).map((v) => v.title ?? ''),
  ].join('\n');
  for (const [label, text] of [['Sections 1–2', body], ['Section 3', section3Text], ['Preview text', d.previewText]] as const) {
    for (const p of PLACEHOLDERS) {
      if (p.re.test(text ?? '')) {
        add('must', label, `${p.what} is still in the copy.`,
          'Fill it in or take the sentence out. A placeholder that reaches an inbox is the error this tool exists to stop.');
      }
    }
  }

  for (const label of Object.keys(d.stats ?? {})) {
    const l = label.trim().toLowerCase();
    if (PLACEHOLDER_STAT_LABELS.some((p) => l.includes(p))) {
      add('must', 'Section 3', `"${label}" is the tool's own placeholder label, not a measurement.`,
        'Say what was counted — "people served through IFS", not "IFS financial stability".');
    } else if (!UNIT_NOUN.test(label)) {
      add('should', 'Section 3', `"${label}" does not say what is being counted.`,
        'Stat labels carry the unit — "people served through IFS", "meals served".');
    }
  }

  // ── Retired links ──────────────────────────────────────────────────────
  if (/forms\.gle/i.test([body, d.previewText, d.coffeeChatUrl ?? '', ...(d.videos ?? []).map((v) => v.url ?? '')].join('\n'))) {
    add('must', 'Guest form link', 'A retired forms.gle link is present.',
      `The Coffee Chat guest form is ${APPLY_URL}.`);
  }

  // ── Section 1's shape ──────────────────────────────────────────────────
  const { headline, body: story } = section1Parts(d.section1);
  if (d.section1.trim()) {
    if (!headline) {
      add('should', 'Section 1', 'No headline.', 'One line starting "## " — ten words at most, no colon. It renders as the green headline.');
    } else {
      if (headline.includes(':')) {
        add('should', 'Section 1', 'The headline has a colon in it.', 'The "Hook: Program" pattern belongs to Section 2, not here.');
      }
      const words = headline.split(/\s+/).filter(Boolean).length;
      if (words > 10) add('should', 'Section 1', `The headline is ${words} words long.`, 'Ten at most.');
    }

    if (FRAMING_PHRASES.some((re) => re.test(firstSentence(story)))) {
      add('should', 'Section 1', 'The first sentence introduces the story rather than starting it.',
        'Open inside the story — the reader already knows they are reading a newsletter.');
    }

    const paragraphs = story.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !p.startsWith('>'));
    if (paragraphs.length && paragraphs.length < 4) {
      add('should', 'Section 1', `${paragraphs.length} paragraph${paragraphs.length === 1 ? '' : 's'} — four or five is the shape.`,
        'Short paragraphs, two to four sentences each, with the quotes inline.');
    }
    const wall = paragraphs.find((p) => (p.match(/[.!?](?:\s|$)/g) ?? []).length > 5);
    if (wall) {
      add('should', 'Section 1', 'One paragraph runs to a wall of text.', 'Two to four sentences each — break it where the story turns.');
    }

    const withoutBridge = story.split(bridgeLine(d.monthName)).join(' ');
    if (new RegExp(`\\bthis ${escapeRe(d.monthName)}\\b`, 'i').test(withoutBridge)) {
      add('should', 'Section 1', `"this ${d.monthName}" appears outside the bridge line.`,
        'Wording tied to the month goes stale between drafting and sending — the bridge line is the one place it belongs.');
    }

    const sensitive = sensitiveMentions(story);
    if (sensitive.length) {
      add('should', 'Section 1', `The story touches on ${sensitive.join(', ')}.`,
        'Fine if it is the guest\'s own and they told it on air. Not fine for anyone who was not in the room — a child, a sibling, an ex.');
    }
  }

  if (!(d.coffeeChatUrl ?? '').trim()) {
    add('must', 'Section 1', 'No Coffee Chat episode link.',
      'Section 1 ends with a "Watch their full story" button. Without the link there is no button — October went out without one.');
  } else if (!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(d.coffeeChatUrl!.trim())) {
    add('should', 'Section 1', 'The Coffee Chat link does not look like a YouTube URL.', 'Paste the episode link from the channel.');
  }

  // ── Section 2's shape ──────────────────────────────────────────────────
  if (d.section2.trim()) {
    const header = (d.section2.split('\n').find((l) => /^##\s+/.test(l.trim())) ?? '').replace(/^##\s+/, '').trim();
    if (!header) {
      add('should', 'Section 2', 'No header.', 'The pattern is "{Short hook}: {Program}" — e.g. "Where Stability Becomes Possible: Integrated Financial Services".');
    } else if (!header.includes(':')) {
      add('should', 'Section 2', `The header is just "${header}".`,
        'The pattern is "{Short hook}: {Program}" — e.g. "Where Stability Becomes Possible: Integrated Financial Services".');
    }

    if (!/what we provide/i.test(d.section2)) {
      add('should', 'Section 2', 'No "What we provide" list.', 'Four to six bullets, from the program\'s entry in the brand reference.');
    } else if (!/^\s*[-*•]\s+/m.test(d.section2)) {
      add('must', 'Section 2', '"What we provide" has no bullet list under it.',
        'Each item on its own line starting with "- ". Dashes run together in one paragraph render as a single line of text, which is what October sent.');
    }

    const key = programKey(d.program);
    const cta = key ? PROGRAM_CTA[key] : undefined;
    if (key && cta) {
      const wantsReferral = key === 'family center' || key === 'golden girls project';
      const present = wantsReferral ? /referral/i.test(d.section2) : /\(970\)/.test(d.section2);
      if (!present) add('should', 'Section 2', `No closing CTA for ${d.program}.`, cta);
    }
  }

  // ── Section 3's video titles ───────────────────────────────────────────
  for (const v of d.videos ?? []) {
    if (/[“”"]{2}/.test(v.title ?? '')) {
      add('should', 'Section 3', `"${v.title}" carries doubled quotation marks.`,
        'The email wraps each title in quotes itself — the title field holds the title as YouTube publishes it.');
    }
  }

  // ── Section 4, when the guest was never a guest ────────────────────────
  if (d.guestFrame === 'calling') {
    const variants = { ...CALLING_SECTION4_VARIANTS, ...(d.section4Variants ?? {}) };
    if (!(variants.donor ?? '').trim() || !(variants['recurring-donor'] ?? '').trim()) {
      add('should', 'Section 4', 'This month uses the calling frame, and the donor and recurring-donor versions still credit the reader for the story.',
        `${d.guestName || 'A community partner'} was never in crisis, so "happened because people like you give every month" does not fit. The replacement wording is waiting on Eric.`);
    }
  }

  // ── the rest of the standards ──
  if (d.section1 && !d.section1.includes('hope has an address'))
    add('should', 'Section 1', 'The standard bridge line is missing from the end of the story.', bridgeLine(d.monthName));

  if (d.section1 && !new RegExp(d.monthName, 'i').test(d.section1))
    add('should', 'Section 1', `The bridge line should name the current month (${d.monthName}).`, 'Check the month reference — it is easy to leave last month’s in.');

  if (!d.partners.length)
    add('should', 'Closing', 'No foundation partners listed.', 'Confirm this quarter’s partners with Mona or Shawna.');

  // Required, not advisory: October went out with none, and the inbox then
  // shows whatever the first line of the HTML happens to be.
  if (!d.previewText.trim())
    add('must', 'Preview text', 'No preview text set.', 'One evocative sentence reflecting the guest story — not a summary, not the subject line again.');
  else if (d.previewText.trim().length > 140)
    add('must', 'Preview text', `Preview text is ${d.previewText.trim().length} characters; inboxes cut it off at about 140.`, 'Keep it to a single sentence.');

  if (!d.section2.includes('Every person who'))
    add('should', 'Section 2', 'The standard bridge closing line is missing.', '"Every person who [action] is walking across the bridge. Where they go from there depends on what they need — but they never walk alone."');

  return issues;
}


