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
  episodesLabel, section4, TIERS, APPLY_URL, programKey, PROGRAM_BULLETS, PROGRAM_CTA,
  PUBLIC_PHONE, JC_PHONES, availableBullets, closingLineFor, CLOSING_SECOND_SENTENCE,
  quarterOf, partnersForMonth,
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

test('a church is not a person, in the transcript or in the prose', () => {
  // "Seventh Day Adventist Church" came back as the full name "Seventh Day".
  const transcript = `[00:04] MONA: Where were you on Sundays?\n[00:09] DANA: Seventh Day Adventist Church, over on Orchard.`;
  const d: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    transcript,
    section1: `${OCTOBER_CORRECTED.section1}\n\nSeventh Day Adventist Church had been feeding her on Sundays.`,
  };
  assert.ok(!namesInTranscript(transcript).includes('Seventh'));
  assert.ok(!flags(d, /Seventh Day/), text(d));
});

test('a name the check cannot know about is cleared by the not-people list', () => {
  const transcript = `[00:04] MONA: How did you hear about us?\n[00:11] DANA: The notice board at Horizon Drive.`;
  const base: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    transcript,
    section1: `${OCTOBER_CORRECTED.section1}\n\nShe found us on the notice board at Horizon Drive.`,
  };
  assert.ok(flags(base, /Horizon Drive" reads as a full name/));
  assert.ok(!flags({ ...base, notPeople: ['Horizon Drive'] }, /Horizon Drive/));
});

test('a partner organisation is never read as somebody\'s name', () => {
  const d: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    partners: [{ name: 'Mesa Roots', url: 'https://example.org' }],
    transcript: `[00:04] DANA: Mesa Roots drove me to the appointment.`,
    section1: `${OCTOBER_CORRECTED.section1}\n\nMesa Roots drove her to the appointment.`,
  };
  assert.ok(!flags(d, /Mesa Roots" reads as a full name/), text(d));
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

test("the tool's own slot name blocks the send", () => {
  const where = musts(OCTOBER_AS_SENT).filter((i) => /slot name/.test(i.problem)).map((i) => i.problem);
  assert.ok(where.some((p) => p.includes('Program spotlight stat')));
});

test('a real measurement with a poor label is a should-fix, not a block', () => {
  // "IFS financial stability" is the document's own label, shortened. It needs
  // renaming; it is not a reason to hold a month, and it was blocking one.
  const about = review(OCTOBER_AS_SENT).filter((i) => i.problem.includes('IFS financial stability'));
  assert.ok(about.length);
  assert.ok(about.every((i) => i.severity === 'should'), JSON.stringify(about));
});

test('the fix names the field the label is edited in', () => {
  const issue = musts(OCTOBER_AS_SENT).find((i) => i.problem.includes('Program spotlight stat'));
  assert.match(issue!.fix, /Rename the label in This Month in Numbers/);
});

test('a figure with a number and no label is a must-fix', () => {
  const d = { ...OCTOBER_CORRECTED, stats: { ...OCTOBER_CORRECTED.stats, '': '42' } };
  assert.ok(musts(d).some((i) => /no label/.test(i.problem)));
  // A blank row nobody has filled in yet is just a blank row.
  const blank = { ...OCTOBER_CORRECTED, stats: { ...OCTOBER_CORRECTED.stats, '': '' } };
  assert.ok(!musts(blank).some((i) => /no label/.test(i.problem)));
});

test('a thin set of figures is a should-fix, and an empty one blocks', () => {
  const thin = { ...OCTOBER_CORRECTED, stats: { 'Meals served': '1,418', 'Families served': '96' } };
  assert.ok(review(thin).some((i) => i.severity === 'should' && /has 2 figures/.test(i.problem)));
  assert.ok(musts({ ...OCTOBER_CORRECTED, stats: {} }).some((i) => /no figures/.test(i.problem)));
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

test('one Section 4, whatever the frame', () => {
  // The calling frame was going to have its own donor and recurring openers;
  // Eric withdrew that on 2026-10-30 — the existing phrasing reads correctly
  // for a community partner — so there is one version of this copy again.
  const calling: NewsletterDraft = { ...OCTOBER_CORRECTED, guestFrame: 'calling' };
  assert.deepEqual(review(calling), review({ ...OCTOBER_CORRECTED, guestFrame: 'guest' }));
  assert.ok(!review(calling).some((i) => i.where === 'Section 4'));
  assert.equal(section4(TIERS[1]!, 'October', 'Dee'), section4(TIERS[1]!, 'October', 'Dee'));
});

// ── The public phone number ────────────────────────────────────────────────

test('the retired number is a should-fix, and it says which number to use', () => {
  const issues = review(OCTOBER_AS_SENT).filter((i) => i.problem.includes('985-6133'));
  assert.ok(issues.length, text(OCTOBER_AS_SENT));
  assert.ok(issues.every((i) => i.severity === 'should'));
  assert.match(issues[0]!.fix, /\(970\) 245-4672/);
  // And not as a privacy leak, which is what an unknown number is.
  assert.ok(!musts(OCTOBER_AS_SENT).some((i) => i.problem.includes('985-6133')));
});

test('the public number is the one the CTAs are built from', () => {
  assert.ok(PROGRAM_CTA['day shelter']!.includes(PUBLIC_PHONE));
  assert.ok(PROGRAM_CTA['food pantry']!.includes(PUBLIC_PHONE));
  assert.ok(JC_PHONES.includes(PUBLIC_PHONE));
  assert.ok(!JC_PHONES.includes('(970) 985-6133'));
  assert.ok(!musts(OCTOBER_CORRECTED).some((i) => i.where === 'Contact details'));
});

test("a stranger's number is still a must-fix", () => {
  const d = { ...OCTOBER_CORRECTED, section2: `${OCTOBER_CORRECTED.section2}\n\nCall Dana on (970) 555-0134.` };
  assert.ok(musts(d).some((i) => i.where === 'Contact details' && i.problem.includes('555-0134')));
});

// ── Services that are not running ──────────────────────────────────────────

test('laundry at the Day Shelter blocks the send', () => {
  const issues = musts(OCTOBER_AS_SENT).filter((i) => /laundry/i.test(i.problem));
  assert.ok(issues.length, text(OCTOBER_AS_SENT));
  assert.match(issues[0]!.problem, /not offering laundry/i);
  assert.ok(!musts(OCTOBER_CORRECTED).some((i) => /laundry/i.test(i.problem)));
});

test('the bullets handed to the generator leave it out', () => {
  assert.ok(PROGRAM_BULLETS['day shelter']!.some((b) => /laundry/i.test(b)));
  assert.ok(!availableBullets('Day Shelter').some((b) => /laundry/i.test(b)));
  assert.equal(availableBullets('Day Shelter').length, PROGRAM_BULLETS['day shelter']!.length - 1);
});

test('the Golden Girls Project keeps its own laundry', () => {
  const d: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    program: 'The Golden Girls Project',
    section2: `## Somewhere Safe To Land: The Golden Girls Project\n\nSixteen beds.\n\n**What we provide:**\n- Recovery meetings, cooking classes and on-site laundry\n\nEvery person who walks in is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.\n\nKnow a woman 50 or older who needs somewhere safe? [Complete a Referral Form →](josephcentergj.com/forms/referral)`,
  };
  assert.ok(!flags(d, /laundry/i), text(d));
  assert.ok(availableBullets('The Golden Girls Project').some((b) => /laundry/i.test(b)));
});

test('a guest quoting laundry is raised, not blocked', () => {
  const d: NewsletterDraft = {
    ...OCTOBER_CORRECTED,
    section1: `${OCTOBER_CORRECTED.section1}\n\n"I did my laundry there every Tuesday," she says of that winter.`,
  };
  const issues = review(d).filter((i) => /laundry/i.test(i.problem));
  assert.ok(issues.length);
  assert.ok(issues.every((i) => i.severity === 'should'), JSON.stringify(issues));
});

// ── The Day Shelter's closing line ─────────────────────────────────────────

test("the Day Shelter's closing line is settled copy", () => {
  assert.equal(closingLineFor('Day Shelter'),
    'Every person who walks through the Day Shelter door is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.');
  assert.ok(closingLineFor('Day Shelter').endsWith(CLOSING_SECOND_SENTENCE));
  assert.equal(closingLineFor('Family Center'), '');
});

test('a Day Shelter month that does not use it is flagged', () => {
  const d = {
    ...OCTOBER_CORRECTED,
    section2: OCTOBER_CORRECTED.section2.replace('walks through the Day Shelter door', 'walks through the door for a hot lunch'),
  };
  const issues = review(d).filter((i) => i.where === 'Section 2' && /settled wording/.test(i.problem));
  assert.equal(issues.length, 1);
  assert.ok(issues[0]!.fix.includes(CLOSING_SECOND_SENTENCE));
  assert.ok(!review(OCTOBER_CORRECTED).some((i) => /settled wording/.test(i.problem)));
});

// ── The quarter's foundation partners ──────────────────────────────────────

test("October's foundations come from the quarter, not from the month", () => {
  assert.equal(quarterOf('2026-10'), '2026-Q4');
  assert.equal(quarterOf('2026-09'), '2026-Q3');
  const names = partnersForMonth('2026-10').map((p) => p.name);
  assert.deepEqual(names, ['Colorado Health Foundation', 'Western Colorado Community Foundation']);
  for (const p of partnersForMonth('2026-10')) assert.match(p.url, /^https:\/\//);
  // Every month of the quarter gets the same two.
  assert.deepEqual(partnersForMonth('2026-12'), partnersForMonth('2026-10'));
});

test('an empty partner list is still a should-fix naming who to ask', () => {
  const d = { ...OCTOBER_CORRECTED, partners: [] };
  const issue = review(d).find((i) => i.where === 'Closing');
  assert.match(issue!.fix, /Mona or Shawna/);
});

// ── First names ────────────────────────────────────────────────────────────

test("a child's first name is fine unless it is on the withhold list", () => {
  // First names are acceptable in this piece. The checks are for surnames and
  // for names the writer has asked to keep out — nothing else.
  const transcript = `[00:04] MONA: Who was with you?\n[00:09] DANA: My daughter Milly Fairweather, she was four.`;
  const section1 = `${OCTOBER_CORRECTED.section1}\n\nMilly was four that winter, and she slept in the back seat.`;
  const open: NewsletterDraft = { ...OCTOBER_CORRECTED, transcript, section1, withholdNames: [] };
  assert.ok(!flags(open, /Milly/), text(open));

  const withheld: NewsletterDraft = { ...open, withholdNames: ['Milly'] };
  assert.ok(musts(withheld).some((i) => i.where === 'Names to withhold' && i.problem.includes('Milly')));

  // Her surname is a must-fix even with nothing on the withhold list, because
  // the transcript says it out loud and the draft is where it must not land.
  const surnamed: NewsletterDraft = { ...open, section1: `${section1} Milly Fairweather started school this year.` };
  assert.ok(musts(surnamed).some((i) => i.where === 'No last names' && i.problem.includes('Milly Fairweather')), text(surnamed));
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
