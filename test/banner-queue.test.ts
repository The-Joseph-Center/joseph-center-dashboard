/**
 * Which banner the site shows, when two are live at once.
 *
 * There is one slot and banners can be scheduled, so overlap is the ordinary
 * case rather than a mistake — the Thanksgiving closure sits inside the Angel
 * Tree campaign. These pin the rule the dashboard's queue shows, so the page
 * cannot promise something other than what SiteBanner.vue will do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bannerShowingAt, isShowingAt } from '../netlify/functions/_lib/banner.ts';

const at = (s: string) => new Date(s).getTime();

const ANGEL_TREE = {
  _id: 'angel', startsAt: '2026-11-01T07:00:00Z', endsAt: '2026-12-01T07:00:00Z',
  _updatedAt: '2026-10-30T00:00:00Z',
};
const THANKSGIVING = {
  _id: 'thanks', startsAt: '2026-11-09T07:00:00Z', endsAt: '2026-11-28T07:00:00Z',
  _updatedAt: '2026-10-25T00:00:00Z',
};
const CHRISTMAS = {
  _id: 'xmas', startsAt: '2026-12-07T07:00:00Z', endsAt: '2026-12-26T07:00:00Z',
  _updatedAt: '2026-10-25T00:00:00Z',
};
const ALL = [ANGEL_TREE, THANKSGIVING, CHRISTMAS];

test('before anything starts, nothing shows', () => {
  assert.equal(bannerShowingAt(ALL, at('2026-10-15T12:00:00Z')), null);
});

test('only the campaign is up in early November', () => {
  assert.equal(bannerShowingAt(ALL, at('2026-11-05T12:00:00Z'))?._id, 'angel');
});

test('the closure notice takes the slot once it starts', () => {
  // Both are live from Nov 9. Thanksgiving ends Nov 28, Angel Tree Dec 1, so
  // the closure wins — which is the whole point of the rule.
  assert.equal(bannerShowingAt(ALL, at('2026-11-09T12:00:00Z'))?._id, 'thanks');
  assert.equal(bannerShowingAt(ALL, at('2026-11-25T12:00:00Z'))?._id, 'thanks');
});

test('editing the campaign does not displace the closure', () => {
  /**
   * The bug this replaced. The old rule was most-recently-edited, so touching
   * the Angel Tree wording during Thanksgiving week took the closure notice
   * down — and the closure is the one somebody arrives at a locked door over.
   */
  const touched = { ...ANGEL_TREE, _updatedAt: '2026-11-24T09:00:00Z' };
  assert.equal(bannerShowingAt([touched, THANKSGIVING], at('2026-11-25T12:00:00Z'))?._id, 'thanks');
});

test('the campaign comes back when the closure ends', () => {
  assert.equal(bannerShowingAt(ALL, at('2026-11-29T12:00:00Z'))?._id, 'angel');
});

test('the gap between the campaign and Christmas is empty', () => {
  assert.equal(bannerShowingAt(ALL, at('2026-12-03T12:00:00Z')), null);
});

test('Christmas takes over in December', () => {
  assert.equal(bannerShowingAt(ALL, at('2026-12-22T12:00:00Z'))?._id, 'xmas');
});

test('a switched-off banner never shows, whatever its dates', () => {
  const off = [{ ...THANKSGIVING, active: false }, ANGEL_TREE];
  assert.equal(bannerShowingAt(off, at('2026-11-25T12:00:00Z'))?._id, 'angel');
  assert.equal(isShowingAt({ ...THANKSGIVING, active: false }, at('2026-11-25T12:00:00Z')), false);
});

test('a banner with no dates shows, and loses to anything time-boxed', () => {
  // "Until somebody turns it off" must never outrank a closure.
  const openEnded = { _id: 'open', _updatedAt: '2026-11-27T00:00:00Z' };
  assert.equal(bannerShowingAt([openEnded], at('2026-11-25T12:00:00Z'))?._id, 'open');
  assert.equal(bannerShowingAt([openEnded, THANKSGIVING], at('2026-11-25T12:00:00Z'))?._id, 'thanks');
});

test('two open-ended banners fall back to the most recently edited', () => {
  const older = { _id: 'older', _updatedAt: '2026-10-01T00:00:00Z' };
  const newer = { _id: 'newer', _updatedAt: '2026-10-20T00:00:00Z' };
  assert.equal(bannerShowingAt([older, newer], at('2026-11-25T12:00:00Z'))?._id, 'newer');
  assert.equal(bannerShowingAt([newer, older], at('2026-11-25T12:00:00Z'))?._id, 'newer');
});

test('a banner is showing on the instant it starts and the instant it ends', () => {
  assert.equal(isShowingAt(THANKSGIVING, at('2026-11-09T07:00:00Z')), true);
  assert.equal(isShowingAt(THANKSGIVING, at('2026-11-28T07:00:00Z')), true);
  assert.equal(isShowingAt(THANKSGIVING, at('2026-11-09T06:59:59Z')), false);
  assert.equal(isShowingAt(THANKSGIVING, at('2026-11-28T07:00:01Z')), false);
});

test('the pick does not depend on the order it was given', () => {
  const shuffled = [CHRISTMAS, ANGEL_TREE, THANKSGIVING];
  for (const t of ['2026-11-05', '2026-11-25', '2026-11-29', '2026-12-22']) {
    assert.equal(
      bannerShowingAt(shuffled, at(`${t}T12:00:00Z`))?._id,
      bannerShowingAt(ALL, at(`${t}T12:00:00Z`))?._id,
    );
  }
});
