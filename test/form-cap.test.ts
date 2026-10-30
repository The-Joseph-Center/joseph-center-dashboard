/**
 * How full a form is.
 *
 * Angel Tree is the case. The Center can buy for about 150 children; the form
 * ran for weeks counting nothing, and for most of that time it did not even ask
 * how many children were in the household. So the arithmetic has to survive a
 * count that does not start at zero and cannot be reconstructed from the
 * submissions themselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { atCapacity, capStatus, countRecorded } from '../netlify/functions/_lib/form-cap.ts';

const CAP = { limit: 150, countField: 'childrenCount', alreadyCounted: 0 };
/** Nothing uncounted behind it, so the cap acts. */
const clean_ = (recorded: number) => ({ recorded, withoutCount: 0 });

test('no limit means not capped, and never full', () => {
  for (const cap of [undefined, null, {}, { limit: 0 }, { limit: undefined }]) {
    const s = capStatus(cap, clean_(500));
    assert.equal(s.capped, false);
    assert.equal(s.enforced, false);
    assert.equal(s.full, false);
    assert.equal(atCapacity(s), false);
  }
});

test('the total is what was recorded plus what came before', () => {
  // The real shape of it: 90-odd sign-ups taken before the question existed,
  // then a count that starts from whatever figure staff supply.
  const s = capStatus({ ...CAP, alreadyCounted: 96 }, { recorded: 22, withoutCount: 92 });
  assert.equal(s.recorded, 22);
  assert.equal(s.alreadyCounted, 96);
  assert.equal(s.counted, 118);
  assert.equal(s.remaining, 32);
  assert.equal(s.full, false);
  // A figure was supplied, so it acts.
  assert.equal(s.pending, false);
  assert.equal(s.enforced, true);
});

test('without the opening figure the cap reports but does not act', () => {
  /**
   * The case Eric is actually in: 92 sign-ups predate the question and nobody
   * has the number. Acting on 22-of-150 would leave 128 places apparently free
   * when there are nearer 32 — it would close the form a hundred children late
   * while showing a tidy total. So it is reported and not enforced.
   */
  const s = capStatus(CAP, { recorded: 22, withoutCount: 92, estimate: 310 });
  assert.equal(s.capped, true);
  assert.equal(s.pending, true);
  assert.equal(s.enforced, false);
  assert.equal(s.full, false);
  assert.equal(atCapacity(s), false);
  // Still reports, so the dashboard can show what is missing.
  assert.equal(s.counted, 22);
  assert.equal(s.uncounted, 92);
  assert.equal(s.estimate, 310);
});

test('a cap with nothing uncounted behind it acts immediately', () => {
  // A form capped from the day it opened needs no opening figure.
  const s = capStatus(CAP, { recorded: 150, withoutCount: 0 });
  assert.equal(s.pending, false);
  assert.equal(s.enforced, true);
  assert.equal(s.full, true);
});

test('an unenforced cap never closes the form, even far past the limit', () => {
  const s = capStatus(CAP, { recorded: 400, withoutCount: 92 });
  assert.equal(s.counted, 400);
  assert.equal(s.full, false);
  assert.equal(atCapacity(s), false);
});

test('it is full on the nose, not one past it', () => {
  assert.equal(capStatus(CAP, clean_(149)).full, false);
  assert.equal(capStatus(CAP, clean_(150)).full, true);
  assert.equal(capStatus(CAP, clean_(151)).full, true);
});

test('an overshoot has no room left, rather than negative room', () => {
  const s = capStatus(CAP, clean_(170));
  assert.equal(s.remaining, 0);
  assert.equal(s.full, true);
});

test('a family that crosses the line is still accepted', () => {
  /**
   * The cap is a stopping point, not a quota to fill exactly. At 148 of 150 a
   * family of four is taken and the total goes to 152, because the alternative
   * is signing up two of somebody's children and telling them about the other
   * two. Only an already-met cap refuses anybody.
   */
  assert.equal(atCapacity(capStatus(CAP, clean_(148))), false);
  assert.equal(atCapacity(capStatus(CAP, clean_(150))), true);
});

test('nonsense numbers are treated as nothing, not as NaN', () => {
  const s = capStatus({ limit: 150, alreadyCounted: Number.NaN }, clean_(Number.NaN));
  assert.equal(s.counted, 0);
  assert.equal(s.remaining, 150);
  assert.equal(s.full, false);
  // A negative opening figure must not buy extra places.
  assert.equal(capStatus({ limit: 150, alreadyCounted: -40 }, clean_(150)).full, true);
});

test('a fractional answer counts as whole children', () => {
  assert.equal(capStatus({ limit: 10, alreadyCounted: 2.7 }, clean_(3.9)).counted, 5);
});

// ── The query ──────────────────────────────────────────────────────────────

/** Records what SQL it was asked for, and answers with a fixed row. */
const fakeDb = (row: Record<string, number>) => {
  const seen: { sql: string; args: unknown[] }[] = [];
  return {
    seen,
    execute: async (q: { sql: string; args: unknown[] }) => {
      seen.push(q);
      return { rows: [row] };
    },
  };
};

test('a counted field is summed in SQL, by a bound path', () => {
  return (async () => {
    const db = fakeDb({ recorded: 22, submissions: 118, without_count: 96, estimate: 0 });
    const out = await countRecorded(db, 'angel-tree', 'childrenCount');
    assert.deepEqual(out, { recorded: 22, submissions: 118, withoutCount: 96, estimate: 0 });
    const q = db.seen[0]!;
    assert.match(q.sql, /SUM\(CAST\(json_extract\(data, \?\) AS INTEGER\)\)/);
    // Field names are parameters, never spliced into the SQL.
    assert.deepEqual(q.args, ['$.childrenCount', '$.childrenCount', 'angel-tree']);
    assert.ok(!q.sql.includes('childrenCount'));
  })();
});

test('the estimate sums the other field over only the uncounted sign-ups', () => {
  return (async () => {
    const db = fakeDb({ recorded: 22, submissions: 118, without_count: 92, estimate: 310 });
    const out = await countRecorded(db, 'angel-tree', 'childrenCount', 'householdSize');
    assert.equal(out.estimate, 310);
    const q = db.seen[0]!;
    // The CASE is what keeps it to the uncounted ones: a sign-up with a real
    // child count must not also contribute its household size.
    assert.match(q.sql, /CASE WHEN json_extract\(data, \?\) IS NULL\s+THEN CAST\(json_extract\(data, \?\) AS INTEGER\) ELSE 0 END/);
    assert.deepEqual(q.args, ['$.childrenCount', '$.childrenCount', '$.childrenCount', '$.householdSize', 'angel-tree']);
    assert.ok(!q.sql.includes('householdSize'));
  })();
});

test('no counted field falls back to counting sign-ups', () => {
  return (async () => {
    const db = fakeDb({ recorded: 118 });
    const out = await countRecorded(db, 'angel-tree', '');
    assert.deepEqual(out, { recorded: 118, submissions: 118, withoutCount: 0, estimate: 0 });
    assert.ok(!db.seen[0]!.sql.includes('json_extract'));
    assert.deepEqual(db.seen[0]!.args, ['angel-tree']);
    // Counting sign-ups leaves nothing unknown, so such a cap acts at once.
    assert.equal(capStatus({ limit: 150 }, out).enforced, true);
  })();
});

test('a missing row counts as nothing rather than throwing', () => {
  return (async () => {
    const db = { execute: async () => ({ rows: [] }) };
    assert.deepEqual(await countRecorded(db, 'angel-tree', 'childrenCount'), {
      recorded: 0, submissions: 0, withoutCount: 0, estimate: 0,
    });
  })();
});
