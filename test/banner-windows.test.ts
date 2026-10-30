/**
 * Which banners collide.
 *
 * Only one banner shows at a time, so posting one switches off the others it
 * would compete with. The question is which ones those are, and the answer used
 * to be "all of them" — which meant writing a closure notice for a week in
 * November took down the campaign running today.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { windowsOverlap } from '../netlify/functions/_lib/banner.ts';

// The real case: Angel Tree runs all of November, and the building is closed
// for Thanksgiving week inside it.
const ANGEL_TREE = { startsAt: '2026-11-01T07:00:00Z', endsAt: '2026-12-01T07:00:00Z' };
const THANKSGIVING = { startsAt: '2026-11-23T07:00:00Z', endsAt: '2026-11-28T07:00:00Z' };
const CHRISTMAS = { startsAt: '2026-12-21T07:00:00Z', endsAt: '2026-12-26T07:00:00Z' };

test('a closure inside a campaign overlaps it', () => {
  assert.equal(windowsOverlap(ANGEL_TREE, THANKSGIVING), true);
  assert.equal(windowsOverlap(THANKSGIVING, ANGEL_TREE), true);
});

test('a closure after the campaign ends does not', () => {
  // The one that matters: posting the Christmas notice in October must not
  // switch off the Angel Tree banner that runs through November.
  assert.equal(windowsOverlap(ANGEL_TREE, CHRISTMAS), false);
  assert.equal(windowsOverlap(CHRISTMAS, ANGEL_TREE), false);
});

test('the two closures do not collide with each other', () => {
  assert.equal(windowsOverlap(THANKSGIVING, CHRISTMAS), false);
});

test('a banner with no dates collides with everything', () => {
  // It shows until somebody turns it off, so there is no week it is not in.
  const open = {};
  assert.equal(windowsOverlap(open, ANGEL_TREE), true);
  assert.equal(windowsOverlap(open, CHRISTMAS), true);
  assert.equal(windowsOverlap(open, open), true);
});

test('an open-ended start still collides with what comes after it', () => {
  assert.equal(windowsOverlap({ endsAt: '2026-11-25T07:00:00Z' }, THANKSGIVING), true);
  assert.equal(windowsOverlap({ endsAt: '2026-11-25T07:00:00Z' }, CHRISTMAS), false);
  assert.equal(windowsOverlap({ startsAt: '2026-12-01T07:00:00Z' }, CHRISTMAS), true);
  // 2026-12-02, not the 1st: Angel Tree ends at exactly 2026-12-01T07:00:00Z,
  // and a window that begins on the instant another ends counts as overlapping.
  assert.equal(windowsOverlap({ startsAt: '2026-12-02T07:00:00Z' }, ANGEL_TREE), false);
});

test('windows that merely touch at the edge count as overlapping', () => {
  // Angel Tree ending at the exact moment the next begins is a boundary nobody
  // means to cut fine, and treating it as a collision is the safe way to be
  // wrong: one banner shows rather than two racing.
  assert.equal(
    windowsOverlap(
      { startsAt: '2026-11-01T07:00:00Z', endsAt: '2026-11-23T07:00:00Z' },
      THANKSGIVING,
    ),
    true,
  );
});

test('an unparseable date is treated as open-ended, not as the epoch', () => {
  // A blank or malformed value must not quietly become 1970 and stop colliding
  // with everything, which is how a banner survives a save it should not have.
  assert.equal(windowsOverlap({ startsAt: 'not a date' }, CHRISTMAS), true);
  assert.equal(windowsOverlap({ endsAt: '' }, CHRISTMAS), true);
});
