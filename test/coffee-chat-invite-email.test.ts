/**
 * The Coffee Chat invitation goes to someone outside the organization, so the
 * things worth pinning are the ones a guest would see go wrong: their name
 * mangled, the apply link missing, or a stray apostrophe rendered as markup.
 *
 * Run: node --test test/coffee-chat-invite-email.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { coffeeChatInviteEmail } from '../netlify/functions/_lib/coffee-chat-invite-email.ts';

const APPLY = 'https://josephcentergj.com/media/apply';

const render = (over: Partial<Parameters<typeof coffeeChatInviteEmail>[0]> = {}) =>
  coffeeChatInviteEmail({
    name: 'Jane',
    applyUrl: APPLY,
    senderName: 'Eric Phifer',
    senderTitle: 'Director of Technology & Marketing',
    ...over,
  });

test('greets with the name exactly as given', () => {
  const { html, text } = render({ name: 'Jane' });
  assert.ok(html.includes('Hi Jane,'), 'html greeting');
  assert.ok(text.includes('Hi Jane,'), 'text greeting');
});

test('does not try to shorten a name to a first name', () => {
  // "Hi Dr.," is the failure this guards against.
  const { html } = render({ name: 'Dr. Alvarez' });
  assert.ok(html.includes('Hi Dr. Alvarez,'));
});

test('trims surrounding whitespace from the name', () => {
  const { html } = render({ name: '  Jane  ' });
  assert.ok(html.includes('Hi Jane,'));
  assert.ok(!html.includes('Hi   Jane'));
});

test('escapes HTML in a name rather than emitting it', () => {
  const { html } = render({ name: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw tag must not survive');
  assert.ok(html.includes('&lt;script&gt;'), 'should appear escaped');
});

test("an apostrophe in a name does not break the greeting", () => {
  const { html } = render({ name: "Siobhán O'Doherty" });
  // escapeHtml turns ' into &#39; — correct, and still renders as an apostrophe.
  assert.ok(html.includes('O&#39;Doherty'));
  assert.ok(!html.includes("O'Doherty</p>"), 'should be escaped, not raw');
});

test('the apply link is present in both the button and the plain text', () => {
  const { html, text } = render();
  assert.ok(html.includes(APPLY), 'html button href');
  assert.ok(text.includes(`Apply here: ${APPLY}`), 'text fallback link');
});

test('honours a non-default apply url', () => {
  const alt = 'https://example.org/apply';
  const { html, text } = render({ applyUrl: alt });
  assert.ok(html.includes(alt));
  assert.ok(text.includes(alt));
  assert.ok(!html.includes(APPLY), 'the default must not be baked in');
});

test('signs with the sender name and title', () => {
  const { html, text } = render();
  assert.ok(html.includes('Eric Phifer'));
  assert.ok(html.includes('Director of Technology &amp; Marketing'), 'ampersand escaped');
  assert.ok(text.includes('Eric Phifer'));
  assert.ok(text.includes('Director of Technology & Marketing'), 'plain text keeps the ampersand');
});

test('omits the title line entirely when there is no title', () => {
  const { html, text } = render({ senderTitle: null });
  assert.ok(html.includes('Eric Phifer'));
  assert.ok(!/font-size:14px;">\s*<\/span>/.test(html), 'no empty title span');
  assert.ok(text.trimEnd().endsWith('Eric Phifer') || text.includes('Eric Phifer\n'), 'text ends cleanly');
});

test('it does not propose a time — the application collects availability', () => {
  // The scheduler works from the guest's own answers. An invitation that named
  // a slot would be guessing, and would contradict the form it links to.
  const { text } = render();
  assert.ok(!/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(text), 'no clock time in the copy');
});

test('is a complete HTML document with a plain-text companion', () => {
  const { subject, html, text } = render();
  assert.ok(subject.length > 0 && subject.length < 120, 'a usable subject line');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('</html>'));
  assert.ok(!text.includes('<'), 'the text version carries no markup');
});

test('carries the organization footer, but not the donation tax line', () => {
  // taxLine is opt-in and belongs to donation emails only — telling an invited
  // guest their gift may be tax-deductible would make no sense.
  const { html, text } = render();
  assert.ok(html.includes('501(c)(3)'), 'footer present');
  assert.ok(!html.includes('tax-deductible'), 'no tax line in html');
  assert.ok(!text.includes('tax-deductible'), 'no tax line in text');
});
