/**
 * The email HTML.
 *
 * The list test is the one that matters most: "What we provide" went out as a
 * single run-on line of dashes because the renderer only recognised a list when
 * every line of the chunk was a bullet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blocksToHtml, button, newsletterHtml, sectionsHtml } from '../netlify/functions/_lib/newsletter-html.ts';
import { APPLY_URL, GREETING, SECTION3_INTRO, episodesLabel, closingSection, section4, TIERS } from '../netlify/functions/_lib/newsletter.ts';
import { OCTOBER_CORRECTED } from './fixtures/newsletters.ts';

const input = (over: Record<string, unknown> = {}) => ({
  month: OCTOBER_CORRECTED.month,
  monthName: OCTOBER_CORRECTED.monthName,
  guestName: OCTOBER_CORRECTED.guestName,
  section1: OCTOBER_CORRECTED.section1,
  section2: OCTOBER_CORRECTED.section2,
  stats: OCTOBER_CORRECTED.stats,
  videos: OCTOBER_CORRECTED.videos,
  section4: section4(TIERS[0]!, OCTOBER_CORRECTED.monthName, OCTOBER_CORRECTED.guestName),
  closing: closingSection(OCTOBER_CORRECTED.partners),
  signature: TIERS[0]!.signature,
  donateUrl: 'josephcentergj.com/donate',
  coffeeChatUrl: OCTOBER_CORRECTED.coffeeChatUrl,
  ...over,
});

// ── Lists ──────────────────────────────────────────────────────────────────

test('a label and the list under it, with no blank line, renders as a list', () => {
  const html = blocksToHtml('**What we provide:**\n- Hot lunch at noon\n- Laundry services');
  assert.match(html, /<p[^>]*><strong>What we provide:<\/strong><\/p>/);
  assert.equal((html.match(/<li/g) ?? []).length, 2);
  assert.match(html, /<ul/);
});

test('a list separated by a blank line still renders as a list', () => {
  const html = blocksToHtml('**What we provide:**\n\n- Hot lunch at noon\n- Laundry services');
  assert.equal((html.match(/<li/g) ?? []).length, 2);
});

test('a list followed by a paragraph keeps both', () => {
  const html = blocksToHtml('- One\n- Two\nAnd then a sentence.');
  assert.match(html, /<ul/);
  assert.match(html, /<p[^>]*>And then a sentence\.<\/p>/);
});

test('the real Section 2 renders its bullets, and not the one that is out of service', () => {
  const html = blocksToHtml(OCTOBER_CORRECTED.section2);
  assert.equal((html.match(/<li/g) ?? []).length, 4);
  assert.match(html, /Hot, homemade lunch served at noon/);
  assert.ok(!/laundry/i.test(html));
});

test('an empty spotlight figure renders nothing at all', () => {
  // The row is optional and has no default label: it used to be seeded with
  // one, which then printed in the email as "Program spotlight stat".
  const stats = { ...OCTOBER_CORRECTED.stats, '': '' };
  const html = newsletterHtml(input({ stats }));
  const from = html.indexOf('This Month in Numbers');
  const card = html.slice(from, html.indexOf('</table>', from));
  assert.equal(card.split('<strong').length - 1, 4);
  assert.ok(!/spotlight/i.test(html));
  assert.ok(!/<strong[^>]*><\/strong>/.test(html));
});

test('headings, quotes and numbered lists are unchanged', () => {
  assert.match(blocksToHtml('## A Header'), /<h2[^>]*>A Header<\/h2>/);
  assert.match(blocksToHtml('> Something she said'), /<blockquote/);
  assert.match(blocksToHtml('1. First\n2. Second'), /<ol/);
  assert.match(blocksToHtml('1. Not a list'), /<p/);
});

// ── Buttons ────────────────────────────────────────────────────────────────

test('buttons take legible ink for their background', () => {
  // White on #60B567 is about 2.5:1; charcoal on it is about 5:1.
  assert.match(button('Give', 'josephcentergj.com/donate', '#60B567'), /color:#2C3531/);
  assert.match(button('Give', 'josephcentergj.com/donate', '#CAA230'), /color:#2C3531/);
  // White on Deep Green is about 7.4:1.
  assert.match(button('Give', 'josephcentergj.com/donate', '#1D5F55'), /color:#ffffff/);
});

// ── Section 1 ──────────────────────────────────────────────────────────────

test('Section 1 carries the eyebrow and the Coffee Chat button', () => {
  const html = newsletterHtml(input());
  assert.match(html, /text-transform:uppercase[^"]*">Coffee Chat with Dana</);
  assert.match(html, /Watch Dana's full story on Coffee Chat with Mona/);
  assert.match(html, /href="https:\/\/youtu\.be\/bbbbbbbbbbb"/);
});

test('no episode link means no button, not a broken one', () => {
  const html = newsletterHtml(input({ coffeeChatUrl: '' }));
  assert.ok(!/full story on Coffee Chat/.test(html));
});

// ── Section 3 ──────────────────────────────────────────────────────────────

test('Section 3 renders the header, the intro line and the episodes label', () => {
  const html = newsletterHtml(input());
  assert.match(html, /October Impact &amp; September Videos/);
  assert.ok(html.includes(SECTION3_INTRO));
  assert.ok(html.includes(episodesLabel('2026-10')));
});

test('episode titles are wrapped once and shorts are labelled', () => {
  const html = newsletterHtml(input());
  assert.match(html, /Watch: “I didn't have my own bed”/);
  assert.match(html, /Watch Short: “One minute on the Day Shelter”/);
  assert.ok(!/“{2}|”{2}/.test(html));
});

test('the apply CTA is a button, pointing at the site', () => {
  const html = newsletterHtml(input());
  assert.match(html, /Apply here →/);
  assert.ok(html.includes(`https://${APPLY_URL}`));
  assert.ok(!/forms\.gle/.test(html));
});

test('the stats card is there, and empty figures are left out', () => {
  const html = newsletterHtml(input({ stats: { 'Meals served': '1,418', 'Families served': '' } }));
  assert.match(html, /This Month in Numbers/);
  assert.match(html, /1,418/);
  assert.ok(!/Families served/.test(html));
});

// ── Per-section copy ───────────────────────────────────────────────────────

test('each section can be had on its own', () => {
  const parts = sectionsHtml(input());
  assert.deepEqual(Object.keys(parts), ['section1', 'section2', 'section3', 'section4', 'closing']);
  assert.ok(parts.section3!.includes(SECTION3_INTRO));
  assert.match(parts.section2!, /<ul/);
  assert.match(parts.section1!, /Coffee Chat with Dana/);
  // Section 4's donate CTAs are buttons here too, not sentences.
  assert.match(parts.section4!, /<table role="presentation"/);
});

// ── The greeting ───────────────────────────────────────────────────────────

test('the message greets once, with a fallback, above everything else', () => {
  const html = newsletterHtml(input());
  assert.equal((html.match(/Hi \{\{ subscriber\.first_name/g) ?? []).length, 1);
  assert.ok(GREETING.includes('or "friend"'));
  assert.ok(html.indexOf(GREETING) < html.indexOf('Coffee Chat with Dana'));
});

test('a single section does not carry the greeting', () => {
  // Pasted into a template that already greets, it would greet twice.
  assert.ok(!sectionsHtml(input()).section1!.includes('subscriber.first_name'));
});
