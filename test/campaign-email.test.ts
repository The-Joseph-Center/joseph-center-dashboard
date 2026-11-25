/**
 * One-off campaign emails.
 *
 * Two things are being pinned here. The first is that a campaign email is the
 * newsletter's own HTML and not a lookalike — same shell, same greeting, same
 * button, same signature rule — because "matching the newsletter" is the whole
 * brief and it is the kind of claim that quietly stops being true.
 *
 * The second is the Giving Tuesday brief's Do/Don't list. Its "Done when"
 * section says to search the copy for "size", "50", "16" and "waitlist" before
 * sending. That is a check somebody has to remember at 7am; these are the same
 * check, run every time the file is saved.
 *
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMPAIGN_VARIANTS, blankCampaign, reviewCampaign, variantSpec, PREVIEW_LIMIT,
  reviewEveryVersion, blockingFor,
  type CampaignEmail,
} from '../netlify/functions/_lib/campaign-email.ts';
import { campaignHtml, campaignText, newsletterHtml } from '../netlify/functions/_lib/newsletter-html.ts';
import { TIERS, GREETING, DONATE_URL } from '../netlify/functions/_lib/newsletter.ts';

const LINK = 'https://josephcentergj.com/donate?campaign=giving-tuesday-2026';

/** A campaign that passes clean, to vary one thing at a time against. */
const GOOD: CampaignEmail = {
  ...blankCampaign('giving-tuesday-2026', 'Giving Tuesday 2026'),
  sendDate: '2026-12-01',
  link: LINK,
  variants: {
    'community-friend': {
      subject: 'Today is our first Giving Tuesday',
      previewText: 'An open invitation to help us keep the bridge standing.',
      body: [
        'Today is Giving Tuesday, and it is the first one The Joseph Center has ever taken part in.',
        'Across 16 counties of the Western Slope, about 5,600 guests come through our doors in a year — for a hot lunch, for somewhere warm to sit, for help untangling a benefits letter, for somewhere safe to sleep. Five programs, one address.',
        'Everything given today goes to general operating expenses: meals, supplies, staff, and all of the unglamorous work it takes to keep the doors unlocked. The Joseph Center is 100% community and foundation funded, which means this is the community keeping its own bridge standing.',
        'If you would like to be part of that today, any amount helps.',
        'Thank you for being here.',
      ].join('\n\n'),
    },
    donor: {
      subject: 'Thank you, today and every day',
      previewText: 'A quiet invitation on our first Giving Tuesday.',
      body: [
        'You have already given to The Joseph Center, and today seemed like the right morning to say so plainly: thank you.',
        'Today is Giving Tuesday, and it is our first. Nothing about it changes what your giving has already made possible for guests across the Western Slope.',
        'If you would like to give again today, the door is open and any amount helps. If not, you have already done the thing we would be asking for.',
      ].join('\n\n'),
    },
    'recurring-donor': {
      subject: 'Thank you, today and every day',
      previewText: 'No ask today — just our thanks, on our first Giving Tuesday.',
      body: [
        'Today is Giving Tuesday, our first, and you are already giving every month. So there is no ask in this one.',
        'Your monthly partnership is what lets us plan ahead instead of hoping — to keep meals cooked and doors unlocked across the Western Slope without waiting to see what arrives, and to say yes when somebody walks in on a Tuesday with nowhere else to go.',
        'Thank you for standing where you stand.',
      ].join('\n\n'),
    },
  },
};

const vary = (id: string, over: Partial<CampaignEmail['variants'][string]>): CampaignEmail => ({
  ...GOOD,
  variants: { ...GOOD.variants, [id]: { ...GOOD.variants[id]!, ...over } },
});

const review = (c: CampaignEmail, variantId?: string) => reviewCampaign({ campaign: c, variantId }).issues;
const musts = (c: CampaignEmail, variantId?: string) => review(c, variantId).filter((i) => i.severity === 'must');
const say = (c: CampaignEmail, variantId?: string) =>
  review(c, variantId).map((i) => `${i.where}: ${i.problem} ${i.fix}`).join('\n');
const flags = (c: CampaignEmail, pattern: RegExp, variantId = 'community-friend') => pattern.test(say(c, variantId));

const render = (id: string, c = GOOD) => {
  const spec = variantSpec(id)!;
  return {
    html: campaignHtml({
      body: c.variants[id]!.body, buttonLabel: c.buttonLabel, buttonUrl: c.link,
      showButton: spec.showButton, closingNote: c.closingNote, signature: spec.signature,
    }),
    text: campaignText({
      body: c.variants[id]!.body, buttonLabel: c.buttonLabel, buttonUrl: c.link,
      showButton: spec.showButton, closingNote: c.closingNote, signature: spec.signature,
    }),
  };
};

// ── It is the newsletter's own HTML ────────────────────────────────────────

const NEWSLETTER = newsletterHtml({
  month: '2026-10', monthName: 'October', guestName: 'Dana',
  section1: 'A story.', section2: 'A program.', stats: { 'Meals served': '508' },
  videos: [], section4: 'An ask.', closing: 'Partners.',
  signature: 'The Joseph Center Team', donateUrl: DONATE_URL,
});

test('a campaign email sits in the same card as the newsletter', () => {
  // The outer table, the page colour, the 600px inner table and its radius.
  // Not a lookalike built from the same palette — the same function.
  for (const marker of [
    'background-color:#FAFAF7;',
    'width="600" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;"',
    'style="padding:32px 28px;"',
    'style="padding:24px 12px;"',
  ]) {
    assert.ok(NEWSLETTER.includes(marker), `the newsletter should have ${marker}`);
    assert.ok(render('donor').html.includes(marker), `the campaign email should too: ${marker}`);
  }
});

test('neither one carries a logo or a header bar', () => {
  // October's send is this card and nothing else; AWeber appends its own
  // footer. A logo on the campaign email would make it the odd one out, which
  // is the opposite of matching.
  for (const html of [NEWSLETTER, render('donor').html, render('community-friend').html]) {
    assert.ok(!/<img\b/i.test(html), 'no images');
    assert.ok(!/unsubscribe/i.test(html), "AWeber's footer is not ours to write");
  }
});

test('the greeting is the one AWeber merge tag that has survived nine sends', () => {
  const { html, text } = render('community-friend');
  assert.ok(html.includes('Hi {{ subscriber.first_name or "friend" }},'));
  assert.ok(text.startsWith('Hi {{ subscriber.first_name or "friend" }},'));
  assert.ok(NEWSLETTER.includes(GREETING));
});

test('the signature is the tier\'s own, under the newsletter\'s hairline rule', () => {
  assert.ok(render('community-friend').html.includes('&mdash; The Joseph Center Team'));
  assert.ok(render('donor').html.includes('&mdash; Mona Highline, Founder &amp; CEO'));
  assert.ok(render('donor').html.includes('border-top:1px solid #e2ded2'));
  // Taken from TIERS rather than retyped, so there is one answer to "who signs
  // the donor version".
  for (const v of CAMPAIGN_VARIANTS) {
    assert.equal(v.signature, TIERS.find((t) => t.id === v.id)!.signature);
  }
});

test('the button is the newsletter\'s button component, bgcolor and all', () => {
  const html = render('community-friend').html;
  assert.ok(html.includes('bgcolor="#60B567"'), 'Primary Green, as the brief asks');
  assert.ok(!html.includes('#C77547'), 'never Rust Orange — that is for urgent CTAs');
  assert.ok(html.includes(LINK));
  // Charcoal ink on the light green: white on #60B567 is about 2.5:1.
  assert.ok(html.includes('color:#2C3531;text-decoration:none'));
});

test('recurring donors get the share line instead of an ask', () => {
  const { html, text } = render('recurring-donor');
  assert.ok(!html.includes(LINK), 'no donate link at all');
  assert.ok(!html.includes('bgcolor="#60B567"'), 'and therefore no button');
  assert.ok(html.includes('feel free to pass it along'));
  assert.ok(text.includes('feel free to pass it along'));
  assert.equal(variantSpec('recurring-donor')!.showButton, false);
});

test('the button appears at most once', () => {
  const html = render('community-friend').html;
  assert.equal(html.split('bgcolor="#60B567"').length - 1, 1);
});

// ── The plain-text version says the same thing ─────────────────────────────

test('both bodies are built from the one copy', () => {
  // October's newsletter lost two lines because each version was assembled
  // separately. One `body` string, two renderers.
  const phrase = 'Five programs, one address.';
  const { html, text } = render('community-friend');
  assert.ok(html.includes(phrase));
  assert.ok(text.includes(phrase));
});

test('plain text flattens a link to label and URL, and keeps the bullets', () => {
  const c: CampaignEmail = vary('donor', {
    body: '**Thank you.**\n\n- One thing\n- Another\n\nRead [our story →](https://josephcentergj.com/about).',
  });
  const text = render('donor', c).text;
  assert.ok(text.includes('Thank you.'));
  assert.ok(!text.includes('**'), 'a reader seeing ** is reading the markup');
  assert.ok(text.includes('- One thing'));
  assert.ok(text.includes('our story: https://josephcentergj.com/about'));
});

test('plain text carries the button as a line of its own', () => {
  const text = render('community-friend').text;
  assert.ok(text.includes(`Give Today: ${LINK}`), text);
  assert.ok(!text.includes('→'), 'the arrow is decoration and does not survive plain text');
});

// ── The link ───────────────────────────────────────────────────────────────

test('a new campaign starts on the exact campaign URL', () => {
  assert.equal(blankCampaign('giving-tuesday-2026').link, LINK);
});

test('a link without a scheme is a must-fix', () => {
  const c = { ...GOOD, link: 'josephcentergj.com/donate?campaign=giving-tuesday-2026' };
  assert.ok(musts(c).some((i) => i.where === 'Link'), say(c));
});

test('http is not good enough either', () => {
  const c = { ...GOOD, link: LINK.replace('https://', 'http://') };
  assert.ok(musts(c).some((i) => i.where === 'Link'));
});

test('a retired giving link is a must-fix', () => {
  const c = { ...GOOD, link: 'https://www.coloradogives.org/donate/The-Joseph-Center' };
  assert.ok(musts(c).some((i) => /retired/i.test(i.problem)), say(c));
});

test('a relative link inside the copy is a must-fix', () => {
  // It renders as an anchor to nothing: there is no page for it to be
  // relative to in an inbox.
  const c = vary('community-friend', { body: `${GOOD.variants['community-friend']!.body}\n\nSee [the programs](/programs).` });
  assert.ok(musts(c, 'community-friend').some((i) => /\/programs/.test(i.problem)), say(c, 'community-friend'));
});

test('a second donate link in the copy is raised, since the button is separate', () => {
  const c = vary('donor', { body: `${GOOD.variants.donor!.body}\n\n[Give today →](${LINK})` });
  assert.ok(flags(c, /call to action|donate link/i, 'donor'), say(c, 'donor'));
});

// ── The brief's Don't list ─────────────────────────────────────────────────

const BANNED: [string, RegExp][] = [
  ['Help us build a bridge for families this winter.', /building the bridge/i],
  ['This is a hand up, not a handout.', /hand forward/i],
  ['Our clients are counting on us.', /guest/i],
  ['We offer transitional housing to women.', /temporary housing/i],
  ['Your gift helps the homeless people of our valley.', /circumstance/i],
  ['Support our charity today.', /community partnership/i],
  ['A gift of any size makes a difference.', /size/i],
  ['Golden Girls has 16 beds for women in crisis.', /15 beds/i],
  ['Fifty women are on the waitlist tonight.', /no longer accurate/i],
  ['Last chance to give before midnight.', /pressure|urgency/i],
  ['Every gift today will be matched dollar-for-dollar.', /no match/i],
  ['Help us reach $10,000 by midnight.', /no goal|does not allow/i],
  ['Families are desperate and have no one else to turn to.', /sob story|gratitude/i],
  ['The Joseph Center is community-funded.', /100% community and foundation funded/i],
];

for (const [sentence, expected] of BANNED) {
  test(`"${sentence.slice(0, 44)}…" is caught`, () => {
    const c = vary('community-friend', { body: `${GOOD.variants['community-friend']!.body}\n\n${sentence}` });
    const found = review(c, 'community-friend');
    assert.ok(found.length, 'something should fire');
    assert.ok(expected.test(say(c, 'community-friend')), say(c, 'community-friend'));
  });
}

test('the four words the brief says to search for are all covered', () => {
  // "Search for 'size,' '50,' '16' and 'waitlist' to confirm none appear."
  // That is a person's job at 7am unless it is a test.
  const sentences = [
    'A gift of any size.',
    '50 women are waiting.',
    'We have 16 beds.',
    'The waitlist is long.',
  ];
  for (const s of sentences) {
    const c = vary('donor', { body: `Thank you for giving. ${s}` });
    assert.ok(musts(c, 'donor').length, `"${s}" should be a must-fix`);
  }
});

test('a clean campaign passes all three versions', () => {
  for (const v of CAMPAIGN_VARIANTS) {
    assert.deepEqual(review(GOOD, v.id), [], `${v.label}: ${say(GOOD, v.id)}`);
  }
  assert.deepEqual(review(GOOD), [], say(GOOD));
});

// ── Numbers ────────────────────────────────────────────────────────────────

test('the two facts the brief allows are not flagged', () => {
  assert.ok(!flags(GOOD, /Numbers the brief/), say(GOOD));
  const c = vary('donor', { body: 'Thank you. About 5,600 guests a year, across 16 counties, through five programs. Thank you again for your part in it.' });
  assert.ok(!flags(c, /Numbers the brief/, 'donor'), say(c, 'donor'));
});

test('any other figure is a must-fix, because nothing stands behind it', () => {
  const c = vary('donor', { body: 'Thank you. This month 321 guests came through the Day Shelter door, and we are grateful to you for it.' });
  assert.ok(musts(c, 'donor').some((i) => /321/.test(i.problem)), say(c, 'donor'));
});

test('a suggested dollar amount is a must-fix even though it looks harmless', () => {
  // A suggested amount is an implied goal, and this is JC's first year.
  const c = vary('donor', { body: 'Thank you for giving. A gift of $25 today goes straight to meals and supplies for guests.' });
  assert.ok(musts(c, 'donor').some((i) => /\$25/.test(i.problem)), say(c, 'donor'));
});

test("JC's own phone number and the year are not figures", () => {
  const c = vary('donor', { body: 'Thank you. Call (970) 245-4672 any time — we have been the bridge since 2016 and we are glad you are part of it.' });
  assert.ok(!flags(c, /Numbers the brief/, 'donor'), say(c, 'donor'));
});

// ── Subject, preview and length ────────────────────────────────────────────

test('no preview text is a must-fix', () => {
  const c = vary('donor', { previewText: '' });
  assert.ok(musts(c, 'donor').some((i) => /preview text/i.test(i.problem)), say(c, 'donor'));
});

test('preview text past the cut-off is a must-fix and says where the cut is', () => {
  const c = vary('donor', { previewText: 'x'.repeat(PREVIEW_LIMIT + 1) });
  const found = musts(c, 'donor').filter((i) => /preview text/i.test(i.problem));
  assert.equal(found.length, 1);
  assert.match(found[0]!.problem, new RegExp(String(PREVIEW_LIMIT)));
});

test('preview text that only repeats the subject is raised', () => {
  const c = vary('donor', { previewText: GOOD.variants.donor!.subject });
  assert.ok(flags(c, /repeats the subject/i, 'donor'));
});

test('a long subject is a check, not a blocker', () => {
  const c = vary('donor', { subject: 'Thank you so very much for everything you have already given to The Joseph Center this year' });
  const found = review(c, 'donor').filter((i) => /subject/i.test(i.problem));
  assert.ok(found.length);
  assert.ok(found.every((i) => i.severity === 'should'));
});

test('the length each version is meant to run to is the length checked', () => {
  // 80–120 for the community version, 60–90 for the donor ones.
  const short = vary('community-friend', { body: 'Today is Giving Tuesday. Any amount helps. Thank you.' });
  assert.ok(flags(short, /80–120/), say(short, 'community-friend'));
  const longDonor = vary('donor', { body: Array(40).fill('Thank you for everything you have given.').join(' ') });
  assert.ok(flags(longDonor, /60–90/, 'donor'), say(longDonor, 'donor'));
});

test('an empty version says what to write rather than listing every rule', () => {
  const c = vary('recurring-donor', { body: '' });
  const found = review(c, 'recurring-donor');
  assert.equal(found.filter((i) => /No copy written/.test(i.problem)).length, 1);
  assert.ok(found.length <= 2, say(c, 'recurring-donor'));
});

// ── Names ──────────────────────────────────────────────────────────────────

test('a full name in the copy is raised', () => {
  const c = vary('donor', { body: 'Thank you. Dana Whitfield came back this month to tell us what happened next, and we were glad to hear it.' });
  assert.ok(flags(c, /Dana Whitfield/, 'donor'), say(c, 'donor'));
});

test("a program's official name is not mistaken for a person", () => {
  const c = vary('donor', {
    body: 'Thank you. The Golden Girls Project and the Family Center both had a full house this month across the Western Slope, and that is down to you.',
  });
  assert.ok(!flags(c, /reads as a full name/, 'donor'), say(c, 'donor'));
});

test("Mona's own signature is not a first-names violation", () => {
  // It is her name on her own letter, and it is rendered outside the body.
  assert.ok(!flags(GOOD, /Mona Highline/, 'donor'), say(GOOD, 'donor'));
  assert.ok(render('donor').html.includes('Mona Highline'));
});

// ── Setting an item aside ──────────────────────────────────────────────────

test('a dismissed item leaves the review and keeps its reason', () => {
  // Two partner organisations, which the first-names rule reads as people.
  const c = vary('donor', {
    body: `${GOOD.variants.donor!.body}\n\nRocky Mountain and High Desert both stood with us this year.`,
  });
  const found = reviewCampaign({ campaign: c, variantId: 'donor' }).issues
    .find((i) => /reads as a full name/.test(i.problem));
  assert.ok(found, say(c, 'donor'));
  const r = reviewCampaign({
    campaign: c, variantId: 'donor',
    overrides: [{ id: found!.id, reason: 'Both are partner organisations, not people.' }],
  });
  assert.ok(!r.issues.some((i) => i.id === found!.id));
  assert.equal(r.dismissed.length, 1);
  assert.equal(r.dismissed[0]!.reason, 'Both are partner organisations, not people.');
  assert.equal(r.stale.length, 0);
});

test('everything in a campaign review can be set aside', () => {
  // Unlike the newsletter, where a reused AWeber tag cannot: nothing here is a
  // mechanical fact about an account, it is all the brief's judgement.
  const c = vary('community-friend', { body: 'Help us build a bridge. A gift of any size. We have 16 beds.' });
  const found = review(c, 'community-friend');
  assert.ok(found.length > 2);
  for (const i of found) assert.equal(i.overridable, true, `${i.where}: ${i.problem}`);
});

test('a dismissal that matches nothing any more is reported as stale', () => {
  const r = reviewCampaign({
    campaign: GOOD, variantId: 'donor',
    overrides: [{ id: 'nothingatall', reason: 'this was fixed properly' }],
  });
  assert.equal(r.dismissed.length, 0);
  assert.equal(r.stale.length, 1);
});

test('every issue carries a unique handle', () => {
  const c = vary('community-friend', { body: 'Help us build a bridge. A gift of any size. Our clients need you. Last chance.' });
  const found = review(c, 'community-friend');
  assert.ok(found.length > 3);
  for (const i of found) assert.match(i.id, /^[0-9a-z]+$/);
  assert.equal(new Set(found.map((i) => i.id)).size, found.length);
});

// ── The gate the AWeber build goes through ─────────────────────────────────
//
// Three callers read this: the editor's Review panel, the readiness check, and
// the server's refusal to create drafts. They have to agree, so there is one
// of it.

test('a clean campaign has nothing blocking the drafts', () => {
  assert.deepEqual(blockingFor(GOOD), []);
  assert.deepEqual(reviewEveryVersion(GOOD).issues, []);
});

test('a problem in one version alone still blocks the build', () => {
  // The donor version is fine and the community one says "16 beds". Building
  // two good drafts and one bad one is the worst of the three outcomes.
  const c = vary('community-friend', { body: 'Today is Giving Tuesday. Golden Girls has 16 beds for women in crisis, and any amount helps us keep them open for the guests who need them most this winter.' });
  const blocking = blockingFor(c);
  assert.ok(blocking.some((i) => /16 beds/.test(i.problem)), JSON.stringify(blocking));
  assert.ok(blockingFor(GOOD).length < blocking.length);
});

test('one pass covers every version plus the campaign-wide fields', () => {
  // A broken link is one item, not three, even though three versions were read.
  const c = { ...GOOD, link: 'josephcentergj.com/donate' };
  const linkIssues = reviewEveryVersion(c).issues.filter((i) => i.where === 'Link');
  assert.equal(linkIssues.length, 1, JSON.stringify(linkIssues));
});

test('setting an item aside unblocks the build', () => {
  const c = vary('donor', { body: `${GOOD.variants.donor!.body}\n\nRocky Mountain stood with us this year.` });
  const name = reviewEveryVersion(c).issues.find((i) => /reads as a full name/.test(i.problem));
  assert.ok(name);
  // That one is a 'should', so it was never blocking — but it must leave the
  // list the panel shows, and the two must not disagree about why.
  const after = reviewEveryVersion(c, [{ id: name!.id, reason: 'A foundation, not a person.' }]);
  assert.ok(!after.issues.some((i) => i.id === name!.id));
  assert.equal(after.dismissed.length, 1);
  assert.equal(after.stale.length, 0);
});

test('an override that matched one version only is not called stale', () => {
  // It is raised on the community version and not the donor one. Computing
  // staleness per version would report it stale on two passes out of three.
  const c = vary('community-friend', { body: `${GOOD.variants['community-friend']!.body}\n\nHigh Desert stood with us.` });
  const name = reviewEveryVersion(c).issues.find((i) => /High Desert/.test(i.problem));
  assert.ok(name, JSON.stringify(reviewEveryVersion(c).issues));
  const after = reviewEveryVersion(c, [{ id: name!.id, reason: 'A foundation, not a person.' }]);
  assert.equal(after.stale.length, 0);
  assert.equal(after.dismissed.length, 1);
});

test('two versions may share a subject line, which is why drafts track by id', () => {
  // The newsletter dedupes its AWeber drafts by subject and can, because each
  // tier's subject is generated from the month. These are written by hand and
  // Giving Tuesday's two donor versions deliberately match: same message, same
  // reader, and the difference is the ask rather than the envelope. Subject
  // matching would have built two drafts and skipped the third.
  const subjects = CAMPAIGN_VARIANTS.map((v) => GOOD.variants[v.id]!.subject);
  assert.equal(new Set(subjects).size, 2, 'the fixture has a deliberate collision');
  assert.equal(subjects[1], subjects[2]);
});
