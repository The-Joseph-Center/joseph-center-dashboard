/**
 * The capability table is the only place that decides who can reach what, and
 * it is read by three things that must agree: the nav, the Functions, and now
 * the Request Access grid. What is worth pinning is the ways those three can
 * silently disagree.
 *
 * Run: node --test test/capabilities.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RULES, FORM_ACCESS, CAPABILITY_LABELS, ADMIN_GROUP,
  hasCapability, capabilitiesFor, requestableCapabilities, grantedBy,
  type Capability,
} from '../src/lib/capabilities.ts';

const ALL = Object.keys(RULES) as Capability[];

test('every capability has a label', () => {
  // This is what broke the Access page: the map lived in admin-access.ts and
  // fell three keys behind the union, so duties, dutiesEdit and
  // coffeeChatInvite listed blank. Typing alone catches a missing key; this
  // catches an empty string too.
  for (const c of ALL) {
    assert.ok(CAPABILITY_LABELS[c], `${c} has no label`);
    assert.ok(CAPABILITY_LABELS[c].trim().length > 3, `${c}'s label says nothing`);
  }
});

test('no capability is labelled with its own key', () => {
  // A label is for someone who does not read the source.
  for (const c of ALL) assert.notEqual(CAPABILITY_LABELS[c], c);
});

test('the grid never offers something the person already has', () => {
  const groups = ['Social Media & Content'];
  const held = capabilitiesFor(groups);
  for (const c of requestableCapabilities(groups)) {
    assert.ok(!held.includes(c), `${c} is offered but already held`);
  }
});

test('capabilities granted to everyone can never be requested', () => {
  // myCard, links and support are '*'. Someone with no groups at all still has
  // them, so they must not appear in anyone's grid.
  const everyones = ALL.filter((c) => RULES[c] === '*');
  assert.ok(everyones.length > 0, 'the fixture assumes at least one');
  const offered = requestableCapabilities([]);
  for (const c of everyones) assert.ok(!offered.includes(c), `${c} should not be requestable`);
});

test('the access map is never offered as a tick box', () => {
  // It is the survey of every inbox and group in the directory, granted to one
  // person deliberately. Listing it invites a request that is always declined.
  assert.ok(!requestableCapabilities([]).includes('access'));
  assert.ok(!requestableCapabilities(['Front Desk']).includes('access'));
});

test('someone with no groups is offered everything else', () => {
  const offered = requestableCapabilities([]);
  const expected = ALL.filter((c) => c !== 'access' && RULES[c] !== '*');
  assert.deepEqual([...offered].sort(), [...expected].sort());
});

test('an admin is offered less than a new hire', () => {
  assert.ok(requestableCapabilities([ADMIN_GROUP]).length < requestableCapabilities([]).length);
});

test('every requestable capability can name the groups that grant it', () => {
  // The request email is only useful because it arrives with its own answer.
  for (const c of requestableCapabilities([])) {
    const by = grantedBy(c);
    assert.notEqual(by, '*', `${c} is requestable but granted to everyone`);
    assert.ok(Array.isArray(by) && by.length > 0, `${c} is granted by nobody`);
  }
});

test('the vacant Executive Assistant group grants nothing', () => {
  // The role is unfilled. An empty group left in the table would hand a new
  // hire the letter queue, the Coffee Chat inbox, the seasonal forms and the
  // site banner as a side effect of onboarding.
  const EA = ['Executive Assistant'];
  assert.deepEqual(
    capabilitiesFor(EA).filter((c) => RULES[c] !== '*'),
    [],
    'it should unlock nothing beyond what everyone has',
  );
  for (const form of Object.keys(FORM_ACCESS) as (keyof typeof FORM_ACCESS)[]) {
    assert.ok(!FORM_ACCESS[form].includes('Executive Assistant'), `${form} still names it`);
  }
});

test('no form inbox is readable by the developer alone', () => {
  // The check to repeat whenever a group is removed: taking one out must never
  // leave an inbox with no owner who actually does the work.
  for (const [form, groups] of Object.entries(FORM_ACCESS)) {
    const others = groups.filter((g) => g !== 'Web Developer');
    assert.ok(others.length > 0, `${form} has no owner but the developer`);
  }
});

test('the Coffee Chat invite is held by leadership and the episode makers', () => {
  for (const g of ['Executive Director', 'Operational Director', 'Director', 'Social Media & Content']) {
    assert.ok(hasCapability([g], 'coffeeChatInvite'), `${g} should be able to invite`);
  }
  assert.ok(!hasCapability(['Front Desk'], 'coffeeChatInvite'));
  assert.ok(!hasCapability([], 'coffeeChatInvite'));
});

test('group names match case-insensitively, since Okta is not careful about it', () => {
  assert.ok(hasCapability(['social media & content'], 'newsletter'));
  assert.ok(hasCapability(['  Operational Director  '], 'banners'));
});

test('submissions stays derived from the per-form lists', () => {
  // Written out by hand it would drift the first time a form is added.
  const union = new Set(Object.values(FORM_ACCESS).flat());
  const rule = RULES.submissions;
  assert.ok(Array.isArray(rule));
  assert.deepEqual([...rule].sort(), [...union].sort());
});

test('reading the letter requests and working the queue are the same list', () => {
  assert.deepEqual(RULES.letterQueue, FORM_ACCESS.letters);
});
