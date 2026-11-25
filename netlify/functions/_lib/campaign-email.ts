/**
 * One-off campaign emails: Giving Tuesday, a year-end appeal, Angel Tree.
 *
 * Not a newsletter. A newsletter is one row a month with a fixed five-section
 * shape, a guest, a program, stats and videos; a campaign email is one short
 * block per tier, dated to a day. Every check in the newsletter review would
 * fire on all of a campaign email at once, which is why this has a review of
 * its own rather than borrowing that one.
 *
 * What it does borrow is everything that makes an email look like The Joseph
 * Center's: the tiers and their signatures from `newsletter.ts`, and the shell,
 * the greeting, the button and the paragraph styles from `newsletter-html.ts`.
 * None of it is retyped here, so "matching the newsletter" is a fact about the
 * code rather than something somebody checked once.
 *
 * The rules below are the Giving Tuesday brief's Do/Don't list, which is itself
 * mostly section 7 of the brand reference plus four corrections the reference
 * has not caught up with. Where the two disagree the brief wins and the comment
 * says why — the reference still lists a retired phone number and 16 Golden
 * Girls beds, so it is not the final word on anything numeric.
 */

import {
  TIERS, DONATE_URL, issueId, applyOverrides,
  type TierId, type Issue, type Severity, type Override, type Dismissed,
} from './newsletter.ts';

export type { Override, Dismissed };

/**
 * A campaign email's three versions.
 *
 * The tiers, their exclusion tags and their signatures come from `TIERS` so
 * there is one answer to "who signs the donor version" across the whole tool.
 * What is added here is per-campaign: whether a tier is asked for a gift at
 * all.
 */
export interface CampaignVariantSpec {
  id: TierId;
  label: string;
  signature: string;
  aweberTag: string;
  excludes: string[];
  /**
   * Whether this tier gets the donate button.
   *
   * False for recurring donors. They are already giving every month, and an
   * ask reads as not having noticed; they get the share line instead. This is
   * the brief's instruction and it is right.
   */
  showButton: boolean;
  /** One line on who this version is for, for the person building it. */
  audience: string;
}

export const CAMPAIGN_VARIANTS: CampaignVariantSpec[] = TIERS.map((t) => ({
  id: t.id,
  label: t.label,
  signature: t.signature,
  aweberTag: t.aweberTag,
  excludes: t.excludes,
  showButton: t.id !== 'recurring-donor',
  audience:
    t.id === 'community-friend'
      ? 'Everyone who is not tagged as a donor. The warm, open invitation.'
      : t.id === 'donor'
        ? 'donor, repeat-donor, vip, vip-repeat, vip-engaged. Thank them first, then invite.'
        : 'recurring-donor. Thank them, no ask, and a line about sharing it.',
}));

export const variantSpec = (id: string): CampaignVariantSpec | undefined =>
  CAMPAIGN_VARIANTS.find((v) => v.id === id);

/** The copy a person writes, per tier. */
export interface CampaignVariantCopy {
  subject: string;
  previewText: string;
  body: string;
}

export interface CampaignEmail {
  slug: string;
  name: string;
  /** 'YYYY-MM-DD'. Documentation — nothing here schedules a send. */
  sendDate: string;
  /** The one URL every button points at, campaign parameter included. */
  link: string;
  buttonLabel: string;
  /** What stands in for the button where a tier is not being asked. */
  closingNote: string;
  variants: Record<string, CampaignVariantCopy>;
  status: string;
  sentAt: number | null;
  updatedBy: string | null;
  updatedAt: number;
}

/** Inboxes cut the preview line off at about this many characters. */
export const PREVIEW_LIMIT = 140;

/**
 * Words and numbers that must not reach a campaign email.
 *
 * All of these are either a brand rule or a correction the brief makes to the
 * brand reference. Checked as strings because every one of them is a string:
 * nothing here needs reading comprehension, and a string test cannot miss one
 * or invent one.
 */
interface Rule {
  re: RegExp;
  severity: Severity;
  problem: string;
  fix: string;
}

const RULES: Rule[] = [
  // ── the bridge, which is the whole positioning ──
  {
    re: /\bbuild(?:ing)?\s+(?:a|the|our)\s+bridge\b|\bbridge\s+builder/i,
    severity: 'must',
    problem: 'The reader is described as building the bridge.',
    fix: 'The Joseph Center IS the bridge, and has been since 2016. The community sustains or strengthens it.',
  },
  // ── the terms with a settled replacement ──
  {
    re: /\bhand(?:\s|-)?up\b/i,
    severity: 'must',
    problem: '"Hand up" appears.',
    fix: 'JC says "a hand forward". "A hand up, not a handout" is retired — it keeps the word it is arguing with.',
  },
  {
    re: /\bhand(?:\s|-)?outs?\b/i,
    severity: 'must',
    problem: '"Handout" appears.',
    fix: 'Say "a hand forward" or "a bridge to independence".',
  },
  {
    re: /\bclients?\b/i,
    severity: 'must',
    problem: '"Client" appears.',
    fix: 'Everyone JC serves is a guest. "The people we serve" is the IFS phrasing, and a campaign email is not an IFS case note.',
  },
  {
    re: /\btransitional housing\b/i,
    severity: 'must',
    problem: '"Transitional housing" appears.',
    fix: 'Say "temporary housing".',
  },
  {
    re: /\b(?:the homeless|homeless (?:people|men|women|individuals|families))\b/i,
    severity: 'must',
    problem: 'Homelessness is written as an identity rather than a circumstance.',
    fix: 'Say "guests experiencing homelessness".',
  },
  {
    re: /\bcharity\b|\b(?:the )?less fortunate\b|\bthose in need\b|\bthe needy\b/i,
    severity: 'must',
    problem: 'Charity framing appears.',
    fix: 'Community partnership. The reader stands alongside the people served, not above them.',
  },
  {
    re: /\bMesa County\b/,
    severity: 'should',
    problem: 'Only Mesa County is named.',
    fix: 'JC serves 16 counties. Say "the Western Slope of Colorado".',
  },

  // ── the four the brief corrects ──
  {
    re: /\bof any size\b|\bgift of any size\b|\bno matter the size\b|\bwhatever the size\b/i,
    severity: 'must',
    problem: 'The word "size" is used about giving.',
    fix: 'The brief rules it out. Say "any amount", "whatever you choose", or just "your gift".',
  },
  {
    re: /\b16 beds\b|\bsixteen beds\b/i,
    severity: 'must',
    problem: '"16 beds" appears.',
    fix: 'The Golden Girls Project has 15 beds for guests — the sixteenth is the house mentor\'s, permanently. The brand reference still says 16; it is wrong. Only mention beds if it genuinely helps.',
  },
  {
    re: /\bwait\s?list(?:ed|s)?\b|\b50 women\b|\bfifty women\b/i,
    severity: 'must',
    problem: 'A waitlist figure or "50 women" appears.',
    fix: 'Overused and no longer accurate. Take it out.',
  },
  {
    re: /\blast chance\b|\bdon'?t miss\b|\bonly \d+ (?:hours?|days?) left\b|\bending (?:soon|tonight|at midnight)\b|\btime is running out\b|\bact now\b|\bhurry\b/i,
    severity: 'must',
    problem: 'Countdown or urgency language appears.',
    fix: 'Gratitude is the emotional note, not pressure. This email has no deadline to press on.',
  },

  // ── things the brief rules out that are easy to drift into ──
  {
    re: /\bmatch(?:ing|ed)?\s+(?:gift|donation|your gift|every (?:gift|dollar))\b|\bdollar[- ]for[- ]dollar\b|\bdouble your (?:gift|impact|donation)\b/i,
    severity: 'must',
    problem: 'A matching gift is implied.',
    fix: 'There is no match this year. Saying there is one is a promise JC cannot keep.',
  },
  {
    re: /\bgoal of \$|\bour \$[\d,]+ goal\b|\bhelp us (?:reach|hit) \$/i,
    severity: 'must',
    problem: 'A dollar goal is implied.',
    fix: 'There is no goal this year. Do not invent one.',
  },
  {
    re: /\bdesperate\b|\bheartbreaking\b|\bno one else to turn to\b|\bbegging\b|\bplead(?:ing)?\b/i,
    severity: 'must',
    problem: 'Pleading or hardship imagery appears.',
    fix: 'No sob story. This is an invitation to join the work, written from gratitude.',
  },
  {
    re: /\bcommunity[- ]funded\b(?!.*community and foundation funded)/i,
    severity: 'must',
    problem: '"Community-funded" appears without the approved phrasing.',
    fix: 'The exact phrase is "100% community and foundation funded". It is not shortened.',
  },
];

/** Numbers the brief allows. Anything else numeric needs a reason. */
const ALLOWED_NUMBERS = new Set(['5600', '5', '16', '2016', '100']);

/** JC's own phone numbers and the year, which are not claims about impact. */
const NUMBER_CONTEXT = [
  /\(?970\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
  /\b(?:19|20)\d{2}\b/g,
  /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi,
];

/**
 * Capitalised phrases that are not somebody's name.
 *
 * The first-names-only rule looks for two capitalised words in a row, and
 * every one of these is two capitalised words in a row. The newsletter review
 * learned this on "The Golden Girls Project", which it reported as the full
 * name "Golden Girls" on every Golden Girls month.
 */
const NOT_A_PERSON = [
  'The Joseph Center', 'Joseph Center', 'Giving Tuesday', 'Western Slope',
  'Grand Junction', 'Grand Valley', 'The Golden Girls Project', 'Golden Girls Project',
  'Golden Girls', 'Day Shelter', 'Food Pantry', 'Family Center', 'Angel Tree',
  'Integrated Financial Services', 'Coffee Chat', 'Stability Partners',
  'Stability Partner', 'Bridge to Stability', 'Peace', 'Justice Center',
];

/** The body with every known proper phrase blanked out, length preserved. */
const maskPhrases = (text: string) =>
  [...NOT_A_PERSON, ...CAMPAIGN_VARIANTS.map((v) => v.signature)]
    // Longest first, so masking "Golden Girls" does not leave the tail of
    // "The Golden Girls Project" behind for the pair test to read.
    .sort((a, b) => b.length - a.length)
    .reduce((t, phrase) => t.split(phrase).join(' '.repeat(phrase.length)), text ?? '');

export interface ReviewInput {
  campaign: CampaignEmail;
  /** Which tier's copy to read. Omitted reviews the campaign-wide fields only. */
  variantId?: string;
  overrides?: Override[];
}

/**
 * The checks, before any dismissal is applied.
 *
 * Severity is about consequence: `must` breaks a rule the brief states
 * outright, `should` is worth a second look and may well be fine.
 */
function runChecks(campaign: CampaignEmail, variantId?: string): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, where: string, problem: string, fix: string) =>
    issues.push({
      severity, where, problem, fix,
      id: issueId(where, problem),
      // Every check here is a string test standing in for a judgement, and the
      // brief itself is a judgement that may be wrong about a particular
      // sentence. Nothing in a campaign email is a mechanical fact about an
      // account the way a reused AWeber tag is, so all of it can be set aside
      // with a reason.
      overridable: true,
    });

  // ── the campaign's own fields ──
  if (!campaign.name.trim()) {
    add('should', 'Campaign', 'The campaign has no name.', 'Name it as you would refer to it out loud — "Giving Tuesday 2026".');
  }
  if (!campaign.link.trim()) {
    add('must', 'Link', 'No donation link set.', 'Every button needs somewhere to go. The brief gives the exact URL, campaign parameter included.');
  } else {
    const link = campaign.link.trim();
    if (!/^https:\/\//i.test(link)) {
      add('must', 'Link', `The link is "${link}".`,
        'It must start with https://. A relative or scheme-less link breaks in every mail client — there is no page to be relative to in an inbox.');
    }
    if (/^https?:\/\/[^/]*(?:harness|coloradogives)/i.test(link)) {
      add('must', 'Link', 'A retired Harness or Colorado Gives link is set.', `All giving goes to ${DONATE_URL}.`);
    }
  }
  if (campaign.link.trim() && !campaign.buttonLabel.trim()) {
    add('must', 'Button', 'No button label.', 'One clear call to action — "Give Today" is the brand reference\'s own wording for a one-time gift.');
  }

  if (!variantId) return issues;

  const spec = variantSpec(variantId);
  if (!spec) {
    add('must', 'Version', `"${variantId}" is not one of the three tiers.`, 'The tiers are community-friend, donor and recurring-donor.');
    return issues;
  }
  const copy = campaign.variants[variantId] ?? { subject: '', previewText: '', body: '' };
  const where = spec.label;

  // ── subject and preview ──
  if (!copy.subject.trim()) {
    add('must', where, 'No subject line.', 'Reader-facing and personal, not administrative.');
  } else if (copy.subject.trim().length > 60) {
    add('should', where, `The subject is ${copy.subject.trim().length} characters; phones show about 40.`,
      'Front-load the words that matter — the tail is what gets cut.');
  }

  if (!copy.previewText.trim()) {
    add('must', where, 'No preview text.',
      'Without it the inbox shows whatever the first line of the HTML happens to be, which is the greeting. October went out that way.');
  } else if (copy.previewText.trim().length > PREVIEW_LIMIT) {
    add('must', where, `The preview text is ${copy.previewText.trim().length} characters; inboxes cut it off at about ${PREVIEW_LIMIT}.`,
      'One sentence.');
  } else if (copy.previewText.trim().toLowerCase() === copy.subject.trim().toLowerCase()) {
    add('should', where, 'The preview text repeats the subject line.',
      'It is a second line of copy, not an echo — the two are read together.');
  }

  // ── the body ──
  const body = copy.body ?? '';
  if (!body.trim()) {
    add('must', where, 'No copy written.', 'See the length guide: the community version runs 80–120 words, the donor versions 60–90.');
    return issues;
  }

  const words = body.trim().split(/\s+/).filter(Boolean).length;
  const [low, high] = spec.id === 'community-friend' ? [80, 120] : [60, 90];
  if (words < low) {
    add('should', where, `The copy is ${words} words; the brief asks for ${low}–${high}.`, 'Short is right, but this is shorter than the shape.');
  } else if (words > high + 20) {
    add('should', where, `The copy is ${words} words; the brief asks for ${low}–${high}.`,
      'A campaign email is one thought and one invitation. Anything more belongs in the newsletter.');
  }

  for (const rule of RULES) {
    if (rule.re.test(body) || rule.re.test(copy.subject) || rule.re.test(copy.previewText)) {
      add(rule.severity, where, rule.problem, rule.fix);
    }
  }

  // ── the ask ──
  if (spec.showButton) {
    // The button is rendered from `buttonLabel`, so a link written into the
    // body as well is a second ask the brief rules out.
    const bodyLinks = [...body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]!.trim());
    const donateInBody = bodyLinks.filter((u) => /donate/i.test(u));
    if (donateInBody.length) {
      add('should', where, `The copy carries ${donateInBody.length === 1 ? 'a donate link' : `${donateInBody.length} donate links`} of its own, and the button is rendered separately.`,
        'One clear call to action, with the button repeated at most once. Take the inline link out, or drop the button for this version.');
    }
    for (const url of bodyLinks) {
      if (!/^(?:https:\/\/|mailto:|tel:)/i.test(url)) {
        add('must', where, `A link in the copy is "${url}".`, 'Every link in an email needs the full https:// — a relative one has nothing to resolve against.');
      }
    }
  } else if (!campaign.closingNote.trim()) {
    add('should', where, 'This version has no button and nothing in its place.',
      'Recurring donors are not being asked for a gift, so the space wants the share line — "if you know someone who would want to hear about this, feel free to pass it along".');
  }

  // ── numbers ──
  //
  // The brief is explicit that two facts are usable and nothing else is
  // numeric. A figure in a campaign email cannot be traced the way a
  // newsletter stat can, because there is no stats panel behind it.
  let numeric = body;
  for (const re of NUMBER_CONTEXT) numeric = numeric.replace(re, ' ');
  const unexplained = new Set<string>();
  for (const m of numeric.matchAll(/\$?\d[\d,]*/g)) {
    // A dollar amount is never on the allowed list: a suggested amount is an
    // implied goal, which the brief rules out for JC's first year.
    if (!/^\$/.test(m[0]) && ALLOWED_NUMBERS.has(m[0].replace(/,/g, ''))) continue;
    unexplained.add(m[0]);
  }
  if (unexplained.size) {
    add('must', where, `Numbers the brief does not allow: ${[...unexplained].join(', ')}.`,
      'The usable facts are about 5,600 guests a year, 16 Western Slope counties and the five programs. Anything else numeric comes out — there is no stats panel behind a campaign email to source it from.');
  }

  // ── names ──
  //
  // The signature is the one place a full name belongs — it is Mona's own name
  // on her own letter — and it is rendered from `TIERS`, outside the body.
  const seen = new Set<string>();
  for (const m of maskPhrases(body).matchAll(/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    add('should', where, `"${m[0]}" reads as a full name.`,
      'First names only, everywhere, for everyone. If it is an organisation or a place, this is a false alarm — set it aside with a reason.');
  }

  return issues;
}

/**
 * The review across the campaign-wide fields and all three versions at once.
 *
 * Run per version rather than once for the campaign, because the same rule can
 * be broken in one version and not another and "the donor one says 16 beds" is
 * the useful report. The campaign-wide items — the link, the button label —
 * would then appear three times, so they run in a pass of their own and the
 * whole thing is deduplicated by issue id.
 *
 * Shared because three callers need exactly this: the editor's Review panel,
 * the AWeber readiness check, and the server's refusal to build drafts while
 * anything is outstanding. They have to agree, and the way to make them agree
 * is for there to be one of this.
 */
export function reviewEveryVersion(campaign: CampaignEmail, overrides: Override[] = []): {
  issues: Issue[];
  dismissed: Dismissed[];
  stale: Override[];
} {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  const dismissed: Dismissed[] = [];
  for (const variantId of [undefined, ...CAMPAIGN_VARIANTS.map((v) => v.id)]) {
    const r = reviewCampaign({ campaign, variantId, overrides });
    for (const i of r.issues) if (!seen.has(i.id)) { seen.add(i.id); issues.push(i); }
    for (const d of r.dismissed) if (!seen.has(d.id)) { seen.add(d.id); dismissed.push(d); }
  }
  // Staleness is a fact about the widest pass, not about any one version: an
  // override that matched the donor version is not stale because the community
  // one never raised it.
  const matched = new Set([...issues, ...dismissed].map((i) => i.id));
  return { issues, dismissed, stale: overrides.filter((o) => !matched.has(o.id)) };
}

/** What stops the drafts being built: the outstanding must-fixes, deduplicated. */
export const blockingFor = (campaign: CampaignEmail, overrides: Override[] = []): Issue[] =>
  reviewEveryVersion(campaign, overrides).issues.filter((i) => i.severity === 'must');

export function reviewCampaign(input: ReviewInput): {
  issues: Issue[];
  dismissed: Dismissed[];
  stale: Override[];
} {
  return applyOverrides(runChecks(input.campaign, input.variantId), input.overrides);
}

/**
 * A new campaign, with the parts that are the same every time filled in.
 *
 * Deliberately not the copy: a seeded paragraph is a paragraph somebody sends
 * without reading, and the whole point of the length and voice checks is that
 * the words are written each time. What is seeded is the link shape, the button
 * wording from the brand reference, and the share line for recurring donors,
 * all of which are settled.
 */
export function blankCampaign(slug: string, name = ''): CampaignEmail {
  return {
    slug,
    name,
    sendDate: '',
    link: `https://${DONATE_URL}?campaign=${slug}`,
    buttonLabel: 'Give Today →',
    closingNote:
      'If you know someone who would want to hear about this, feel free to pass it along.',
    variants: Object.fromEntries(
      CAMPAIGN_VARIANTS.map((v) => [v.id, { subject: '', previewText: '', body: '' }]),
    ),
    status: 'draft',
    sentAt: null,
    updatedBy: null,
    updatedAt: 0,
  };
}
