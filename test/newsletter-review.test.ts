/**
 * The pre-send review.
 *
 * Every case here is something that reached an inbox. The October fixture is
 * the September → October comparison written down: if one of these assertions
 * starts failing, that fault can ship again.
 *
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bridgeLine, namesInTranscript, outsideQuotes, quoteTitle, reviewNewsletter,
  section1Parts, sensitiveMentions, watchLabel, composeSection3, SECTION3_INTRO,
  episodesLabel, section4, TIERS, APPLY_URL, programKey, PROGRAM_BULLETS,
  type NewsletterDraft,
} from '../netlify/functions/_lib/newsletter.ts';
import { OCTOBER_AS_SENT, OCTOBER_CORRECTED } from './fixtures/newsletters.ts';

const review = (d: NewsletterDraft) => reviewNewsletter(d);
const musts = (d: NewsletterDraft) => review(d).filter((i) => i.severity === 'must');
const text = (d: NewsletterDraft) => review(d).map((i) => `${i.where}: ${i.problem} ${i.fix}`).join('\n');
const flags = (d: NewsletterDraft, pattern: RegExp) => pattern.test(text(d));

test('the fixture ends on the bridge line verbatim', () => {
  assert.ok(OCTOBER_CORRECTED.section1.includes(bridgeLine('October')));
  assert.ok(OCTOBER_AS_SENT.section1.includes(bridgeLine('October')));
});

// ── A1: names ──────────────────────────────────────────────────────────────

test('a guest surname in the prose is a must-fix', () => {
  assert.ok(flags(OCTOBER_AS_SENT, /Dana Whitfield/));
  assert.ok(musts(OCTOBER_AS_SENT).some((i) => i.where === 'No last names'));
});

test('a withheld name anywhere in the draft is a must-fix', () => {
  assert.ok(musts(OCTOBER_AS_SENT).some((i) => i.where === 'Names to withhold' && i.problem.includes('Mason')));
});

test('a withheld name in a video title is caught too', () => {
  const d = { ...OCTOBER_CORRECTED, videos: [{ title: 'Mason turns six', url: 'https://youtu.be/x' }] };
  assert.ok(musts(d).some((i) => i.where === 'Names to withhold'));
});

test('the official program name is not mistaken for a surname', () => {
  const d: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    program: 'The Golden Girls Project',
    staffSurnames: ['Girls'],
    section2: `## Somewhere Safe To Land: The Golden Girls Project\n\nThe Golden Girls Project has 16 beds.\n\n**What we provide:**\n- 16 beds, up to 6 months free of charge\n\nEvery person who walks in is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.\n\nKnow a woman 50 or older who needs somewhere safe? [Complete a Referral Form →](josephcentergj.com/forms/referral)`,
  };
  assert.ok(!flags(d, /Golden Girls" appears as part of a full name/));
});

test('transcript speakers and spoken full names are both found', () => {
  const names = namesInTranscript(OCTOBER_AS_SENT.transcript ?? '');
  assert.ok(names.includes('Mona'));
  assert.ok(names.includes('Dana'));
});

// ── A2: contact details ────────────────────────────────────────────────────

test('a phone number in the story is a must-fix, JC numbers are not', () => {
  const leaked: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    section1: `${OCTOBER_CORRECTED.section1}\n\nShe can be reached on (970) 555-0134 any time.`,
  };
  assert.ok(musts(leaked).some((i) => i.where === 'Contact details' && i.problem.includes('555-0134')));
  // The Day Shelter CTA in the corrected fixture carries (970) 985-6133.
  assert.ok(!musts(OCTOBER_CORRECTED).some((i) => i.where === 'Contact details'));
});

test('an email address in the story is a must-fix', () => {
  const leaked: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    section1: `${OCTOBER_CORRECTED.section1}\n\nWrite to dana@example.com.`,
  };
  assert.ok(musts(leaked).some((i) => i.where === 'Contact details' && i.problem.includes('dana@example.com')));
});

test("JC's own published address does not flag", () => {
  const ours: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    section2: `${OCTOBER_CORRECTED.section2}\n\nQuestions? jc@josephcentergj.com`,
  };
  assert.ok(!musts(ours).some((i) => i.where === 'Contact details'));
});

// ── A3: terminology, outside quotations ────────────────────────────────────

test('"homeless people" in the narration is a must-fix', () => {
  assert.ok(musts(OCTOBER_AS_SENT).some((i) => i.problem.includes('Homeless people')));
});

test('the same words inside a quotation are left alone', () => {
  const quoted: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    section1: `## A Line Somebody Said\n\nShe put it plainly: "I was one of the homeless people everyone drives past."\n\nIt is her sentence, not ours.\n\nShe said it on air, and she meant it to land.\n\nShe has her own kitchen now, and she cooks in it.\n\n${bridgeLine('October')}`,
  };
  assert.ok(!musts(quoted).some((i) => i.where === 'Terminology'));
});

test('a pulled quote is not narration either', () => {
  assert.equal(outsideQuotes('> I was one of the homeless people\n\nOurs now.').includes('homeless people'), false);
});

test('"hand up" and "charity" are should-fixes, not blockers', () => {
  const d: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    section2: `${OCTOBER_CORRECTED.section2}\n\nThis is a hand up, not charity.`,
  };
  const issues = review(d);
  assert.ok(issues.some((i) => i.severity === 'should' && /hand up/i.test(i.problem)));
  assert.ok(issues.some((i) => i.severity === 'should' && /charity/i.test(i.problem)));
  assert.ok(!issues.some((i) => i.severity === 'must' && i.where === 'Terminology'));
});

// ── A4: placeholders ───────────────────────────────────────────────────────

test('[X], "once they\'re finalized" and "we\'ll share" all block the send', () => {
  const problems = musts(OCTOBER_AS_SENT).map((i) => i.problem).join(' ');
  assert.ok(problems.includes('[X]'));
  assert.ok(/finali[sz]ed/.test(problems));
  assert.ok(/we'll share/.test(problems));
});

test("the tool's own stat labels block the send", () => {
  const where = musts(OCTOBER_AS_SENT).filter((i) => /placeholder label/.test(i.problem)).map((i) => i.problem);
  assert.ok(where.some((p) => p.includes('Program spotlight stat')));
  assert.ok(where.some((p) => p.includes('IFS financial stability')));
});

test('a stat label with no unit noun is a should-fix', () => {
  const d = { ...OCTOBER_CORRECTED, stats: { 'Housing retention': '92%' } };
  assert.ok(review(d).some((i) => i.severity === 'should' && /does not say what is being counted/.test(i.problem)));
});

// ── A5: retired links ──────────────────────────────────────────────────────

test('a forms.gle link anywhere is a must-fix', () => {
  const d = { ...OCTOBER_CORRECTED, section2: `${OCTOBER_CORRECTED.section2}\n\nApply: https://forms.gle/aQZRYokrT7YK8GFL9` };
  assert.ok(musts(d).some((i) => i.where === 'Guest form link'));
});

test('the apply link the tool emits is the one on the site', () => {
  assert.equal(APPLY_URL, 'josephcentergj.com/media/apply');
  assert.ok(composeSection3(OCTOBER_CORRECTED).includes(APPLY_URL));
});

// ── B: Section 1's shape ───────────────────────────────────────────────────

test('a missing episode link blocks the send', () => {
  assert.ok(musts(OCTOBER_AS_SENT).some((i) => i.where === 'Section 1' && /episode link/.test(i.problem)));
  assert.ok(!musts(OCTOBER_CORRECTED).some((i) => /episode link/.test(i.problem)));
});

test('a framing first sentence is flagged', () => {
  assert.ok(flags(OCTOBER_AS_SENT, /introduces the story rather than starting it/));
});

test('the headline is read off the first heading line', () => {
  const { headline, body } = section1Parts(OCTOBER_CORRECTED.section1);
  assert.equal(headline, 'She Came In For Lunch And Left With An Interview');
  assert.ok(body.startsWith('Dana had been sleeping'));
});

test('a headline with a colon, or more than ten words, is flagged', () => {
  const d = { ...OCTOBER_CORRECTED, section1: OCTOBER_CORRECTED.section1.replace('## She Came In For Lunch And Left With An Interview', '## A First Door: She Came In For Lunch And Left With An Interview And A Plan') };
  const issues = review(d).filter((i) => i.where === 'Section 1');
  assert.ok(issues.some((i) => /colon/.test(i.problem)));
  assert.ok(issues.some((i) => /words long/.test(i.problem)));
});

test('month-tied wording outside the bridge line is flagged', () => {
  assert.ok(flags(OCTOBER_AS_SENT, /"this October" appears outside the bridge line/));
  assert.ok(!flags(OCTOBER_CORRECTED, /appears outside the bridge line/));
});

test('sensitive ground is raised, not removed', () => {
  assert.deepEqual(sensitiveMentions('Her brother died in April'), ['a death']);
  assert.deepEqual(sensitiveMentions('He lost custody'), ['custody or foster placement']);
  assert.deepEqual(sensitiveMentions('A quiet Tuesday'), []);
});

// ── C: Section 2's shape ───────────────────────────────────────────────────

test('a bare program name as the header is flagged', () => {
  assert.ok(flags(OCTOBER_AS_SENT, /The header is just "Day Shelter"/));
  assert.ok(!flags(OCTOBER_CORRECTED, /The header is just/));
});

test('"What we provide" with no list under it blocks the send', () => {
  const d = {
    ...OCTOBER_CORRECTED,
    section2: OCTOBER_CORRECTED.section2.replace(/- [^\n]+\n?/g, 'Hot lunch at noon — computer access — laundry\n'),
  };
  assert.ok(musts(d).some((i) => /no bullet list/.test(i.problem)));
});

test('each program has its own bullets and its own closing CTA', () => {
  assert.equal(programKey('IFS (Integrated Financial Services)'), 'integrated financial services');
  assert.equal(programKey('The Golden Girls Project'), 'golden girls project');
  assert.ok(PROGRAM_BULLETS['day shelter']!.some((b) => /noon/.test(b)));
  const d = { ...OCTOBER_CORRECTED, section2: OCTOBER_CORRECTED.section2.replace(/Need somewhere to start\?[^\n]*/, 'Contact us.') };
  assert.ok(review(d).some((i) => /No closing CTA for Day Shelter/.test(i.problem)));
});

// ── D: Section 3 ───────────────────────────────────────────────────────────

test('doubled quotation marks in a title are flagged', () => {
  assert.ok(flags(OCTOBER_AS_SENT, /doubled quotation marks/));
  assert.ok(!flags(OCTOBER_CORRECTED, /doubled quotation marks/));
});

test('a title is wrapped once, however it arrives', () => {
  assert.equal(quoteTitle('I didn\'t have my own bed'), '“I didn\'t have my own bed”');
  assert.equal(quoteTitle('"I didn\'t have my own bed"'), '“I didn\'t have my own bed”');
  assert.equal(quoteTitle('““I didn\'t have my own bed””'), '“I didn\'t have my own bed”');
  assert.equal(quoteTitle('Coffee Chat with Dana'), '“Coffee Chat with Dana”');
});

test('shorts keep their label', () => {
  assert.equal(watchLabel({ title: 'One minute', url: 'https://youtube.com/shorts/x', kind: 'Short' }), 'Watch Short:');
  assert.equal(watchLabel({ title: 'Coffee Chat', url: 'https://youtu.be/x', kind: 'Episode' }), 'Watch:');
  assert.equal(watchLabel({ title: 'One minute', url: 'https://youtube.com/shorts/x' }), 'Watch Short:');
});

test('Section 3 carries the fixed intro line and the episodes label', () => {
  const s3 = composeSection3(OCTOBER_CORRECTED);
  assert.ok(s3.includes(SECTION3_INTRO));
  assert.ok(s3.includes(episodesLabel('2026-10')));
  assert.equal(episodesLabel('2026-10'), "September's episodes:");
  assert.ok(s3.includes('October Impact & September Videos'));
  assert.ok(s3.includes('Watch Short:'));
});

test('preview text is required, and capped at 140 characters', () => {
  assert.ok(musts(OCTOBER_AS_SENT).some((i) => i.where === 'Preview text'));
  const long = { ...OCTOBER_CORRECTED, previewText: 'x'.repeat(141) };
  assert.ok(musts(long).some((i) => i.where === 'Preview text' && /141 characters/.test(i.problem)));
});

// ── Section 2's figures ────────────────────────────────────────────────────

test('a figure in the spotlight that is in no source blocks the send', () => {
  const d = {
    ...OCTOBER_CORRECTED,
    section2: OCTOBER_CORRECTED.section2.replace('1,418 lunches and welcomed 362 people', '2,900 lunches and welcomed 801 people'),
  };
  const problems = musts(d).map((i) => i.problem).join(' ');
  assert.match(problems, /not in this month's stats or your notes: 2,900, 801/);
});

test('a figure that came from the stats panel is sourced', () => {
  assert.ok(!musts(OCTOBER_CORRECTED).some((i) => /not in this month's stats/.test(i.problem)));
});

test("a figure from the writer's own notes is sourced too", () => {
  const d: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    section2: OCTOBER_CORRECTED.section2.replace('welcomed 362 people through the doors', 'welcomed 362 people through the doors, 44 of them for the first time'),
    spotlightNotes: '44 first-time guests in October, per Shawna',
  };
  assert.ok(!musts(d).some((i) => /not in this month's stats/.test(i.problem)));
});

test('opening hours and the phone number in the CTA are not figures', () => {
  const d = {
    ...OCTOBER_CORRECTED,
    section2: `${OCTOBER_CORRECTED.section2}\n\nIn October, call (970) 985-6133 between 9am and 1pm.`,
  };
  assert.ok(!musts(d).some((i) => /985/.test(i.problem)));
});

test('a spotlight with no figures at all is a should-fix, not a blocker', () => {
  const d = {
    ...OCTOBER_CORRECTED,
    section2: OCTOBER_CORRECTED.section2.replace(/In October we served[^\n]*\n\n/, ''),
  };
  const issues = review(d);
  assert.ok(issues.some((i) => i.severity === 'should' && /gives no figures for this month/.test(i.problem)));
  assert.ok(!issues.some((i) => i.severity === 'must' && i.where === 'Section 2'));
});

// ── E: Section 4 and the calling frame ─────────────────────────────────────

test('the settled Section 4 copy is unchanged for a guest', () => {
  const donor = section4(TIERS[1]!, 'October', 'Dana');
  assert.ok(donor.includes("You have already given to The Joseph Center, and Dana's story this October is part of what that made possible."));
  const recurring = section4(TIERS[2]!, 'October', 'Dana');
  assert.ok(recurring.includes("Dana's story this October happened because people like you give every month, without being asked twice."));
});

test('the calling frame raises a should-fix while the variant is unwritten', () => {
  const calling: NewsletterDraft = { ...OCTOBER_CORRECTED, guestFrame: 'calling' };
  const issues = review(calling);
  assert.ok(issues.some((i) => i.severity === 'should' && i.where === 'Section 4'));
  assert.ok(!issues.some((i) => i.severity === 'must' && i.where === 'Section 4'));
});

test('a supplied calling variant replaces the sentence and clears the flag', () => {
  const variants = { donor: 'Dee found us and never left.', 'recurring-donor': 'Dee found us and never left.' };
  const donor = section4(TIERS[1]!, 'October', 'Dee', { frame: 'calling', variants });
  assert.ok(donor.includes('Dee found us and never left.'));
  assert.ok(!donor.includes('is part of what that made possible'));
  const calling: NewsletterDraft = { ...OCTOBER_CORRECTED, guestFrame: 'calling', section4Variants: variants };
  assert.ok(!review(calling).some((i) => i.where === 'Section 4'));
});

test('a calling variant is ignored for a guest month', () => {
  const donor = section4(TIERS[1]!, 'October', 'Dana', {
    frame: 'guest',
    variants: { donor: 'should not appear' },
  });
  assert.ok(!donor.includes('should not appear'));
});

// ── The whole thing ────────────────────────────────────────────────────────

test('October as sent trips every fault the comparison found', () => {
  const issues = review(OCTOBER_AS_SENT);
  const summary = issues.map((i) => i.problem).join('\n');
  for (const expected of [
    /Dana Whitfield/,        // the guest's surname
    /Mason/,                 // the withheld minor
    /Homeless people/,       // terminology
    /\[X\]/,                 // placeholders
    /Program spotlight stat/,
    /doubled quotation marks/,
    /episode link/,          // no Section 1 button
  ]) assert.match(summary, expected, `expected ${expected} in:\n${summary}`);
  assert.ok(issues.some((i) => i.where === 'Preview text'));
});

test('the corrected version passes clean', () => {
  const issues = review(OCTOBER_CORRECTED);
  assert.deepEqual(issues, [], `expected no issues, got:\n${text(OCTOBER_CORRECTED)}`);
});
