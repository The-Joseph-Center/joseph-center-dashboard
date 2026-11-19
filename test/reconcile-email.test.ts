/**
 * The weekly staff report is read on a Monday by one person, and its failure
 * mode is not a crash — it is being skimmed. So what these tests pin is mostly
 * what the email LEAVES OUT, and whether a reader is told how to make a
 * settled row stop coming back.
 *
 * Run: node --test test/reconcile-email.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderEmail, type Report } from '../netlify/functions/_lib/reconcile-email.ts';

const empty: Report = {
  unpublished: [], newLinks: [], needsAttention: [],
  cardsWithoutAccount: [], accountsWithoutCard: [], newApplicants: [],
};
const report = (over: Partial<Report> = {}): Report => ({ ...empty, ...over });

const APPLICANT = { name: 'Jane Okonkwo', connection: 'Golden Girls', at: 1_763_000_000, careful: false };

test('staff cards with no Okta account are never in the email', () => {
  // The complaint that prompted this: most of the staff do not use a computer
  // at work, so this list never changes and never needs action.
  const { html, text, subject } = renderEmail(
    report({ cardsWithoutAccount: ['Gerald — Maintenance', 'Luisa — Food Service Assistant'] }),
    'weekly',
  );
  assert.ok(!html.includes('Gerald'), 'html must not list them');
  assert.ok(!text.includes('Gerald'), 'text must not list them');
  assert.ok(!html.includes('no Okta account'), 'the section heading must be gone too');
  assert.ok(!subject.includes('2'), 'and they must not be counted in the subject');
});

test('a new application leads the subject line', () => {
  const { subject } = renderEmail(report({ newApplicants: [APPLICANT] }), 'weekly');
  assert.match(subject, /1 new Coffee Chat application\b/);
  assert.ok(!subject.includes('applications'), 'singular for one');
});

test('several applications are pluralized', () => {
  const { subject } = renderEmail(report({ newApplicants: [APPLICANT, { ...APPLICANT, name: 'Sam' }] }), 'weekly');
  assert.match(subject, /2 new Coffee Chat applications/);
});

test('an unpublished card still outranks an application in the subject', () => {
  // Something changed on the public website. That is the one thing more
  // arresting than someone waiting on a reply.
  const { subject } = renderEmail(
    report({
      unpublished: [{ name: 'A Person', login: 'a@b.c', reason: 'Okta status SUSPENDED' }],
      newApplicants: [APPLICANT],
    }),
    'now',
  );
  assert.match(subject, /1 unpublished/);
});

test('an application appears with its name, connection and date, and nothing else', () => {
  const { html, text } = renderEmail(report({ newApplicants: [APPLICANT] }), 'weekly');
  for (const out of [html, text]) {
    assert.ok(out.includes('Jane Okonkwo'));
    assert.ok(out.includes('Golden Girls'));
    assert.ok(out.includes('Nov 12'), 'a human date, not an epoch');
    assert.ok(!out.includes('1763000000'), 'never the raw timestamp');
  }
});

test('dates are Denver time, not the server clock', () => {
  // 1763000000 is Nov 13 at 01:33 UTC, which is Nov 12 at 18:33 in Denver.
  // Netlify runs these functions in UTC, so without a fixed zone an evening
  // application would be reported as having arrived the next day — and this
  // test would pass or fail depending on the machine running it.
  const { html, text } = renderEmail(report({ newApplicants: [APPLICANT] }), 'weekly');
  assert.ok(html.includes('Nov 12'), 'html uses the Denver date');
  assert.ok(text.includes('Nov 12'), 'text uses the same one');
  assert.ok(!html.includes('Nov 13'), 'never the UTC date');
});

test('the sensitive answers are flagged but never quoted', () => {
  // has_legal_matters and sensitive_topics decide `careful` in the handler, and
  // that single bit is all that may reach an inbox. The text itself stays in
  // the dashboard behind the capability that guards the inbox.
  const { html, text } = renderEmail(
    report({ newApplicants: [{ ...APPLICANT, careful: true }] }),
    'weekly',
  );
  assert.ok(html.includes('read this one before replying'));
  assert.ok(text.includes('read before replying'));
  for (const out of [html, text]) {
    assert.ok(!/legal/i.test(out), 'no legal-matters wording');
    assert.ok(!/sensitive/i.test(out), 'no sensitive-topics wording');
  }
});

test('a settled row is told how to stop coming back', () => {
  // The whole reason the same person arrived every Monday for weeks: the
  // report named the problem and never the cure.
  const { html, text } = renderEmail(
    report({ needsAttention: [{ name: 'A Person', login: 'a@b.c', note: 'active in Okta but hidden on the site' }] }),
    'weekly',
  );
  assert.ok(html.includes('stop reporting it'), 'html names the button');
  assert.ok(text.includes('button that ends it'), 'text points at it too');
});

test('the how-to-stop line is absent when there is nothing to stop', () => {
  const { html } = renderEmail(report({ newApplicants: [APPLICANT] }), 'weekly');
  assert.ok(!html.includes('stop reporting it'));
});

test('accounts with no card carry their next step', () => {
  const { html, text } = renderEmail(report({ accountsWithoutCard: ['New Hire (nh@josephcentergj.com)'] }), 'weekly');
  assert.ok(html.includes('Make a card'));
  assert.ok(text.includes('Make a card'));
});

test('applications come before the directory tidying', () => {
  const { html } = renderEmail(
    report({ newApplicants: [APPLICANT], accountsWithoutCard: ['Someone (s@x.y)'], newLinks: [] }),
    'weekly',
  );
  assert.ok(html.indexOf('Jane Okonkwo') < html.indexOf('Someone'), 'a person waiting comes first');
});

test('the Staff page link appears only when a base url is configured', () => {
  const saved = process.env.DASHBOARD_BASE_URL;
  try {
    delete process.env.DASHBOARD_BASE_URL;
    assert.ok(!renderEmail(report({ newApplicants: [APPLICANT] }), 'weekly').html.includes('Open the Staff page'),
      'no guessed host, because a dead link is worse than none');

    process.env.DASHBOARD_BASE_URL = 'https://dash.example.org/';
    const { html } = renderEmail(report({ newApplicants: [APPLICANT] }), 'weekly');
    assert.ok(html.includes('https://dash.example.org/staff'), 'trailing slash collapsed');
    assert.ok(!html.includes('example.org//staff'));
  } finally {
    if (saved === undefined) delete process.env.DASHBOARD_BASE_URL;
    else process.env.DASHBOARD_BASE_URL = saved;
  }
});

test('names from the directory are escaped, not emitted', () => {
  const { html } = renderEmail(
    report({ newApplicants: [{ ...APPLICANT, name: '<b>Jane</b>' }] }),
    'weekly',
  );
  assert.ok(!html.includes('<b>Jane</b>'));
  assert.ok(html.includes('&lt;b&gt;Jane'));
});

test('the weekly and same-day messages introduce themselves differently', () => {
  const r = report({ newApplicants: [APPLICANT] });
  assert.ok(renderEmail(r, 'weekly').html.includes('standing picture'));
  assert.ok(renderEmail(r, 'now').html.includes('changed on the site today'));
  assert.match(renderEmail(r, 'weekly').subject, /^Staff page, this week —/);
  assert.match(renderEmail(r, 'now').subject, /^Staff page —/);
});

test('the one-way promise is still stated in both versions', () => {
  // Leaving Okta unpublishes a card; nothing here republishes one. A reader who
  // forgets that misreads the whole report.
  const r = report({ newApplicants: [APPLICANT] });
  assert.ok(renderEmail(r, 'weekly').html.includes('nothing here republishes'));
  assert.ok(renderEmail(r, 'weekly').text.includes('nothing here republishes one'));
});
