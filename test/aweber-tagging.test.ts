/**
 * Applying the month's tag, one pass at a time.
 *
 * October's send is what these are about. Tagging is one PATCH per subscriber,
 * Netlify stops a function at ten seconds, and the first real run got through
 * 76 of 243 before the gateway answered 504 — no record of where it stopped, no
 * "sent" written, and a page showing nothing but the number.
 *
 * So a pass has to stop itself, say what is left, and be safe to repeat. These
 * cover exactly that, with the clock and the PATCH both handed in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AweberThrottled, tagEveryone, type Subscriber } from '../netlify/functions/_lib/aweber.ts';

const TAG = 'oct-2026-newsletter';

const list = (n: number, tagged = 0): Subscriber[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    email: `person${i + 1}@example.com`,
    status: 'subscribed',
    tags: i < tagged ? ['community-friend', TAG] : ['community-friend'],
    selfLink: `https://api.aweber.com/1.0/accounts/1/lists/2/subscribers/${i + 1}`,
  }));

/** A clock that advances by `per` on every PATCH, so the budget is reachable. */
function fakeClock(per: number) {
  let t = 1000;
  return { now: () => t, tick: () => { t += per; } };
}

test('a whole list that fits in the budget is done in one pass', async () => {
  const clock = fakeClock(10);
  const run = await tagEveryone(list(243), TAG, async () => clock.tick(), {
    budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now,
  });
  assert.equal(run.added, 243);
  assert.equal(run.already, 0);
  assert.equal(run.remaining, 0);
  assert.equal(run.done, true);
});

test('a list that does not fit stops short and says how many are left', async () => {
  // 80ms a PATCH is what AWeber actually answers in, and 6500 / 80 is 81.
  const clock = fakeClock(80);
  const run = await tagEveryone(list(243), TAG, async () => clock.tick(), {
    budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now,
  });
  assert.equal(run.done, false);
  assert.ok(run.added > 0 && run.added < 243);
  assert.equal(run.remaining, 243 - run.added);
});

test('passes resume where the last one stopped, and finish', async () => {
  // The whole of October: four passes over the real list, each one seeing the
  // tags the last one applied.
  const subscribers = list(243);
  let passes = 0;
  let total = 0;
  for (;;) {
    const clock = fakeClock(80);
    const run = await tagEveryone(subscribers, TAG, async (s) => {
      clock.tick();
      s.tags = [...s.tags, TAG];
    }, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });
    passes++;
    total += run.added;
    if (run.done) {
      assert.equal(run.remaining, 0);
      break;
    }
    assert.ok(passes < 20, 'should not take twenty passes');
  }
  // Tagged once each, which is what keeps the automations firing once.
  assert.equal(total, 243);
  assert.ok(passes > 1, 'the point is that it takes more than one');
  assert.ok(subscribers.every((s) => s.tags.filter((t) => t === TAG).length === 1));
});

test('nobody is tagged twice, so a repeat pass does nothing', async () => {
  const clock = fakeClock(10);
  const touched: string[] = [];
  const run = await tagEveryone(list(243, 243), TAG, async (s) => {
    clock.tick();
    touched.push(s.email);
  }, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });
  assert.deepEqual(touched, []);
  assert.equal(run.added, 0);
  assert.equal(run.already, 243);
  assert.equal(run.done, true);
  assert.equal(run.remaining, 0);
});

test('the 76 already tagged are counted, not re-tagged', async () => {
  const clock = fakeClock(10);
  const run = await tagEveryone(list(243, 76), TAG, async () => clock.tick(), {
    budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now,
  });
  assert.equal(run.already, 76);
  assert.equal(run.added, 167);
  assert.equal(run.done, true);
});

test('one subscriber failing does not strand the rest of the list', async () => {
  const clock = fakeClock(10);
  const run = await tagEveryone(list(10), TAG, async (s) => {
    clock.tick();
    if (s.email === 'person4@example.com') throw new Error('AWeber said no');
  }, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });
  assert.equal(run.added, 9);
  assert.deepEqual(run.failed, ['person4@example.com']);
  // Reached the end, so there is no more to try — but one is still untagged,
  // which is what keeps the month from being marked sent.
  assert.equal(run.done, true);
  assert.equal(run.remaining, 1);
});

test('a failure is retried by the next pass', async () => {
  const subscribers = list(3);
  let attempts = 0;
  const apply = async (s: Subscriber) => {
    attempts++;
    if (s.email === 'person2@example.com' && attempts < 4) throw new Error('wobble');
    s.tags = [...s.tags, TAG];
  };
  const clock = fakeClock(10);
  const first = await tagEveryone(subscribers, TAG, apply, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });
  assert.deepEqual(first.failed, ['person2@example.com']);
  const second = await tagEveryone(subscribers, TAG, apply, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });
  assert.deepEqual(second.failed, []);
  assert.equal(second.added, 1);
  assert.equal(second.remaining, 0);
});

test('an empty list is done, not stuck', async () => {
  const run = await tagEveryone([], TAG, async () => {}, {
    budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: () => 1000,
  });
  assert.equal(run.done, true);
  assert.equal(run.remaining, 0);
  assert.equal(run.stoppedBy, undefined);
});

test('no budget left tags nobody rather than one more', async () => {
  // The guard is checked before the PATCH, not after: a pass that arrives with
  // its time already spent must not fire a request that gets cut off midway.
  const run = await tagEveryone(list(5), TAG, async () => { throw new Error('should not be called'); }, {
    budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: () => 9000,
  });
  assert.equal(run.added, 0);
  assert.equal(run.done, false);
  assert.equal(run.remaining, 5);
});

// ── AWeber's rate limit ────────────────────────────────────────────────────
// 120 requests a minute per account, then 403 with "Rate Limit Error" in the
// body and sixty seconds of refusing everything. October's send met it at 175
// of 243 and reported "Could not read subscribers (403)".

test('a throttle stops the pass instead of failing everyone after it', async () => {
  const clock = fakeClock(10);
  let calls = 0;
  const run = await tagEveryone(list(243), TAG, async () => {
    clock.tick();
    if (++calls > 90) throw new AweberThrottled(60_000);
  }, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });

  assert.equal(run.added, 90);
  assert.equal(run.done, false);
  assert.equal(run.stoppedBy, 'throttled');
  assert.equal(run.retryAfterMs, 60_000);
  // The 153 it never reached are remaining, not failed. Writing them into
  // `failed` would read as 153 subscribers AWeber refused to tag.
  assert.deepEqual(run.failed, []);
  assert.equal(run.remaining, 153);
});

test('the wait AWeber asks for is the wait reported', async () => {
  const clock = fakeClock(10);
  const run = await tagEveryone(list(5), TAG, async () => {
    clock.tick();
    throw new AweberThrottled(12_000);
  }, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });
  assert.equal(run.retryAfterMs, 12_000);
  assert.equal(run.added, 0);
});

test('the request quota stops a pass that still has time on the clock', async () => {
  // The clock is generous; the quota is not. Reads before the loop have spent
  // some of it, which is why it is counted rather than assumed.
  let spent = 3;
  const run = await tagEveryone(list(243), TAG, async () => { spent++; }, {
    budgetMs: 6500, startedAt: 1000, maxRequests: 90,
    now: () => 1000, spent: () => spent,
  });
  assert.equal(run.added, 87);
  assert.equal(run.done, false);
  assert.equal(run.stoppedBy, 'quota');
  assert.equal(run.retryAfterMs, 60_000);
});

test('an unfinished pass always asks to be left a minute', async () => {
  // Whichever way it stopped. Stopping on the clock means about eighty
  // requests went out in under seven seconds, so the minute is spent either
  // way and coming straight back earns the 403.
  const clock = fakeClock(80);
  const run = await tagEveryone(list(243), TAG, async () => clock.tick(), {
    budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now,
  });
  assert.equal(run.stoppedBy, 'time');
  assert.equal(run.retryAfterMs, 60_000);
});

test('a finished pass asks for no wait at all', async () => {
  const clock = fakeClock(10);
  const run = await tagEveryone(list(243), TAG, async () => clock.tick(), {
    budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now,
  });
  assert.equal(run.done, true);
  assert.equal(run.retryAfterMs, undefined);
});

test('a throttle keeps the failures it had already collected', async () => {
  const clock = fakeClock(10);
  const run = await tagEveryone(list(10), TAG, async (s) => {
    clock.tick();
    if (s.email === 'person2@example.com') throw new Error('AWeber said no');
    if (s.email === 'person6@example.com') throw new AweberThrottled();
  }, { budgetMs: 6500, startedAt: 1000, maxRequests: 10_000, now: clock.now });

  assert.deepEqual(run.failed, ['person2@example.com']);
  assert.equal(run.added, 4);
  assert.equal(run.stoppedBy, 'throttled');
  // person2 failed and 6 through 10 were never tried: all five still untagged.
  assert.equal(run.remaining, 6);
});

test('243 subscribers finish in a handful of throttled passes', async () => {
  /**
   * The whole of a real send, as the page drives it: burst a pass, meet the
   * limit, wait, come back. What matters is that it terminates, that it
   * terminates in minutes rather than hours, and that every subscriber is
   * tagged exactly once across all of it.
   */
  const subscribers = list(243);
  let passes = 0, waits = 0, total = 0;
  for (;;) {
    let calls = 0;
    const clock = fakeClock(80);
    const run = await tagEveryone(subscribers, TAG, async (s) => {
      clock.tick();
      // 90 requests a pass, a few of them spent reading the list.
      if (++calls > 87) throw new AweberThrottled();
      s.tags = [...s.tags, TAG];
    }, { budgetMs: 6500, startedAt: 1000, maxRequests: 90, now: clock.now });

    passes++;
    total += run.added;
    if (run.done) break;
    waits++;
    assert.ok(run.retryAfterMs! > 0, 'an unfinished pass must ask for a wait');
    assert.ok(passes < 20, `took ${passes} passes`);
  }

  assert.equal(total, 243);
  assert.ok(subscribers.every((s) => s.tags.filter((t) => t === TAG).length === 1));
  // Four passes and three minutes of waiting, not forty.
  assert.ok(waits <= 4, `waited ${waits} times`);
});
