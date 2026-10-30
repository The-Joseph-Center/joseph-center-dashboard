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

import { tagEveryone, type Subscriber } from '../netlify/functions/_lib/aweber.ts';

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
    budgetMs: 6500, startedAt: 1000, now: clock.now,
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
    budgetMs: 6500, startedAt: 1000, now: clock.now,
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
    }, { budgetMs: 6500, startedAt: 1000, now: clock.now });
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
  }, { budgetMs: 6500, startedAt: 1000, now: clock.now });
  assert.deepEqual(touched, []);
  assert.equal(run.added, 0);
  assert.equal(run.already, 243);
  assert.equal(run.done, true);
  assert.equal(run.remaining, 0);
});

test('the 76 already tagged are counted, not re-tagged', async () => {
  const clock = fakeClock(10);
  const run = await tagEveryone(list(243, 76), TAG, async () => clock.tick(), {
    budgetMs: 6500, startedAt: 1000, now: clock.now,
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
  }, { budgetMs: 6500, startedAt: 1000, now: clock.now });
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
  const first = await tagEveryone(subscribers, TAG, apply, { budgetMs: 6500, startedAt: 1000, now: clock.now });
  assert.deepEqual(first.failed, ['person2@example.com']);
  const second = await tagEveryone(subscribers, TAG, apply, { budgetMs: 6500, startedAt: 1000, now: clock.now });
  assert.deepEqual(second.failed, []);
  assert.equal(second.added, 1);
  assert.equal(second.remaining, 0);
});

test('an empty list is done, not stuck', async () => {
  const run = await tagEveryone([], TAG, async () => {}, { budgetMs: 6500, startedAt: 1000, now: () => 1000 });
  assert.deepEqual(run, { added: 0, already: 0, failed: [], remaining: 0, done: true });
});

test('no budget left tags nobody rather than one more', async () => {
  // The guard is checked before the PATCH, not after: a pass that arrives with
  // its time already spent must not fire a request that gets cut off midway.
  const run = await tagEveryone(list(5), TAG, async () => { throw new Error('should not be called'); }, {
    budgetMs: 6500, startedAt: 1000, now: () => 9000,
  });
  assert.equal(run.added, 0);
  assert.equal(run.done, false);
  assert.equal(run.remaining, 5);
});
