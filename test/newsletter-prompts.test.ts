/**
 * The drafting prompts.
 *
 * A prompt cannot be unit-tested for quality, but it can be tested for the
 * instructions it must never lose — the frame being the clearest case. The
 * guest frame and the calling frame are different pieces of writing, and the
 * selector on the page is the only thing that chooses between them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { section1System, spotlightSystem } from '../netlify/functions/_lib/newsletter-prompts.ts';
import { bridgeLine } from '../netlify/functions/_lib/newsletter.ts';

const base = {
  guest: 'Dana',
  monthName: 'October',
  program: 'Day Shelter',
  facts: '',
  brandReference: '[brand reference]',
  withhold: [] as string[],
};

test('the guest frame asks for the arc', () => {
  const p = section1System({ ...base, frame: 'guest' });
  assert.match(p, /before \/ support \/ transformation arc/);
  assert.ok(!/were not in crisis/.test(p));
});

test('the calling frame forbids the arc', () => {
  const p = section1System({ ...base, frame: 'calling', guest: 'Dee' });
  assert.match(p, /Do NOT use a before\/support\/transformation arc/);
  assert.match(p, /There is no "before", no rescue and nothing to transform/);
  assert.ok(!/Use the before \/ support \/ transformation arc/.test(p));
});

test('the shape asked for is a headline and four or five paragraphs', () => {
  const p = section1System({ ...base, frame: 'guest' });
  assert.match(p, /as "## "/);
  assert.match(p, /Ten words at most, and no colon/);
  assert.match(p, /four or five short paragraphs/);
  assert.match(p, /two to four sentences each/);
});

test('it is told to start inside the story', () => {
  const p = section1System({ ...base, frame: 'guest' });
  assert.match(p, /goes straight into the story/);
  assert.match(p, /This month's Coffee Chat spotlight lands on/);
});

test('it is told not to write the eyebrow or the button', () => {
  const p = section1System({ ...base, frame: 'guest' });
  assert.match(p, /Do not write an eyebrow line/);
  assert.match(p, /added when the email is built/);
});

test('the bridge line is handed over verbatim', () => {
  assert.ok(section1System({ ...base, frame: 'guest' }).includes(bridgeLine('October')));
});

test('withheld names are named in the prompt', () => {
  const p = section1System({ ...base, frame: 'guest', withhold: ['Mason', 'Aunt Carol'] });
  assert.match(p, /must not appear at all: Mason, Aunt Carol/);
  assert.ok(!/must not appear at all/.test(section1System({ ...base, frame: 'guest' })));
});

test('the standing rules are all still in there', () => {
  const p = section1System({ ...base, frame: 'guest' });
  for (const rule of [
    /First names only/,
    /No phone numbers, email addresses or street addresses/,
    /people experiencing homelessness/,
    /hand forward/,
    /Never write a placeholder/,
    /Nothing tied to the month except the bridge line/,
    /Dignity first/,
  ]) assert.match(p, rule);
});

test('the fact sheet, when there is one, is marked as settled', () => {
  const p = section1System({ ...base, frame: 'guest', facts: 'Dana — the guest' });
  assert.match(p, /it is right and you are wrong/);
  assert.match(p, /Dana — the guest/);
});

// ── Section 2 ──────────────────────────────────────────────────────────────

test('the spotlight asks for the header pattern, not the program name', () => {
  const p = spotlightSystem({ program: 'Day Shelter', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /\{Short hook\}: \{Program\}/);
  assert.match(p, /Never the bare program name/);
});

test("the Day Shelter's bullets include the noon lunch", () => {
  const p = spotlightSystem({ program: 'Day Shelter', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /Hot, homemade lunch served at noon, Tuesday–Friday/);
  assert.match(p, /walk-ins are welcome/);
  assert.match(p, /\(970\) 245-4672/);
});

// ── Where the reference is out of date ─────────────────────────────────────

test('the prompt overrides the phone number the reference still lists', () => {
  for (const p of [
    spotlightSystem({ program: 'Day Shelter', monthName: 'October', brandReference: '[ref]' }),
  ]) {
    assert.match(p, /the public phone number is \(970\) 245-4672/);
    assert.match(p, /Never write \(970\) 985-6133, whatever the reference says/);
  }
});

test('a service that is out of order is named, and left out of the bullets', () => {
  const p = spotlightSystem({ program: 'Day Shelter', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /Day Shelter is not currently offering: laundry/);
  assert.match(p, /Do not mention laundry in a bullet, a description, a hook or a quotation/);
  // And the bullet list it is handed does not contain it to copy.
  assert.ok(!/ {3}- Laundry services/.test(p));
  assert.match(p, / {3}- Computer access for job applications/);
});

test('Section 1 is told about it too', () => {
  const p = section1System({ ...base, frame: 'guest', program: 'Day Shelter' });
  assert.match(p, /Day Shelter is not currently offering laundry/);
  assert.ok(!/not currently offering/.test(section1System({ ...base, frame: 'guest', program: 'Family Center' })));
});

test("the Golden Girls Project keeps the laundry it has", () => {
  const p = spotlightSystem({ program: 'The Golden Girls Project', monthName: 'October', brandReference: '[ref]' });
  assert.ok(!/not currently offering/.test(p));
  assert.match(p, /on-site laundry/);
});

test("the Day Shelter's closing line is handed over as settled copy", () => {
  const p = spotlightSystem({ program: 'Day Shelter', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /it is settled copy — write it exactly, word for word/);
  assert.match(p, /Every person who walks through the Day Shelter door is walking across the bridge\./);
  assert.ok(!/\[action, e\.g\./.test(p));
  // Every other program still fills the blank in itself.
  assert.match(spotlightSystem({ program: 'Family Center', monthName: 'October', brandReference: '[ref]' }), /\[action, e\.g\./);
});

test('IFS gets its own terminology and its own CTA', () => {
  const p = spotlightSystem({ program: 'IFS (Integrated Financial Services)', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /say "the people we serve", never "guests" and never "clients"/);
  assert.match(p, /\(970\) 985-5114/);
  assert.match(p, /Representative payee services/);
});

test('the Family Center and Golden Girls get the referral form', () => {
  for (const program of ['Family Center', 'The Golden Girls Project']) {
    const p = spotlightSystem({ program, monthName: 'October', brandReference: '[ref]' });
    assert.match(p, /Complete a Referral Form/);
    assert.match(p, /josephcentergj\.com\/forms\/referral/);
  }
});

test('Golden Girls keeps the official-name rule', () => {
  const p = spotlightSystem({ program: 'The Golden Girls Project', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /first mention must be "The Golden Girls Project" in full/);
});

test('the stat paragraph is omitted rather than guessed at', () => {
  const p = spotlightSystem({ program: 'Day Shelter', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /leave this paragraph out entirely and ask for them in gaps/);
  assert.match(p, /never write a placeholder like \[X\] or TBD/);
});

test('an unknown program still gets usable instructions', () => {
  const p = spotlightSystem({ program: 'Ways to support', monthName: 'October', brandReference: '[ref]' });
  assert.match(p, /Four to six items, drawn from the program's entry/);
  assert.match(p, /a referral form or a phone number, whichever fits/);
});
