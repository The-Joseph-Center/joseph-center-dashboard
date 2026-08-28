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

/** The line Section 1 must end on, with the month filled in. */
export const bridgeLine = (month: string) =>
  `This is what we mean when we say hope has an address. And this ${month}, we're inviting you to help us strengthen the bridge from crisis to stability across the Western Slope of Colorado.`;

const PERSONAL_LETTER = `Would you like to receive a personal letter from Mona? Share your mailing address and she'll be in touch. [Add your address →](${LETTER_URL})`;
const REPLY = `Have a question or just want to share something? Reply to this email and someone from our team will get back to you. We're always happy to hear from our partners.`;

export function section4(tier: Tier, month: string, guest: string): string {
  const who = guest || 'this month’s guest';
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
    return `## ${tier.section4Header}

You have already given to The Joseph Center, and ${who}'s story this ${month} is part of what that made possible.

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

  return `## ${tier.section4Header}

${who}'s story this ${month} happened because people like you give every month, without being asked twice.

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
  return { tag: `${name}-newsletter`, waitDays, endOfMonth: endOfMonth.toISOString().slice(0, 10) };
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
  videos: { title: string; url: string }[];
  partners: { name: string; url: string }[];
  previewText: string;
  aweberTag: string;
  usedTags: string[];       // tags already used in previous months
  staffSurnames: string[];  // from the directory, for the no-last-names rule
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
  PROTECTED.reduce((t, phrase) => t.replaceAll(phrase, ' '.repeat(phrase.length)), text);

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const prevMonthName = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return MONTHS[(m! - 2 + 12) % 12]!;
};

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

  // Section 3 header format: "[This month] Impact & [Last month] Videos"
  const expectedHeader = `${d.monthName} Impact & ${prevMonthName(d.month)} Videos`;

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

  // ── the rest of the standards ──
  if (d.section1 && !d.section1.includes('hope has an address'))
    add('should', 'Section 1', 'The standard bridge line is missing from the end of the story.', bridgeLine(d.monthName));

  if (d.section1 && !new RegExp(d.monthName, 'i').test(d.section1))
    add('should', 'Section 1', `The bridge line should name the current month (${d.monthName}).`, 'Check the month reference — it is easy to leave last month’s in.');

  if (!d.partners.length)
    add('should', 'Closing', 'No foundation partners listed.', 'Confirm this quarter’s partners with Mona or Shawna.');

  if (!d.previewText.trim())
    add('should', 'Preview text', 'No preview text set.', 'One evocative sentence reflecting the guest story — not a summary, not the subject line again.');
  else if (d.previewText.trim().length > 140)
    add('should', 'Preview text', 'Preview text is long enough that inboxes will cut it off.', 'Keep it to a single sentence.');

  if (!d.section2.includes('Every person who'))
    add('should', 'Section 2', 'The standard bridge closing line is missing.', '"Every person who [action] is walking across the bridge. Where they go from there depends on what they need — but they never walk alone."');

  return issues;
}

export { expectedSection3Header };
function expectedSection3Header(month: string, monthName: string) {
  return `${monthName} Impact & ${prevMonthName(month)} Videos`;
}
