/**
 * How many a form has room for.
 *
 * Angel Tree is the case this exists for: the Joseph Center can serve about 150
 * children, and until now nothing counted. The form stayed open on whatever
 * dates were set and somebody had to notice, in a spreadsheet, that it was time
 * to close it.
 *
 * Two things worth knowing about the shape of this.
 *
 * It counts a *field*, not submissions. A sign-up is one family, and the number
 * that matters is how many children are in it — "150 sign-ups" and "150
 * children" are different by a factor of two or three, and the second is the
 * one that has to be bought gifts.
 *
 * And the count almost never starts at zero. The 2026 form ran for weeks
 * without asking how many children were in the household, so those submissions
 * hold no number to add up and no arithmetic here can recover them. A cap that
 * ignored them would overshoot by however many families had already signed up.
 *
 * So a cap with uncounted sign-ups behind it is **not enforced** until somebody
 * supplies an opening figure. That is the whole reason `pending` exists. The
 * alternative was enforcing a number known to be wrong, which closes the form
 * hundreds of children late while reporting a tidy "118 of 150" — worse than no
 * cap, because it looks like it is working. An unenforced cap still reports, so
 * the dashboard can show what is missing and what it would take to fix it.
 *
 * `estimate` is there to make that figure answerable rather than invented. It
 * sums some other field across the sign-ups that have no count — household size
 * for Angel Tree — which is not a number of children, but it is evidence, and
 * it is what the person setting the opening figure has to go on. It is never
 * enforced against: counting adults as children would close the form early and
 * turn families away, which is the one error worse than overshooting.
 *
 * The frontend keeps its own copy of this logic — the two repos do not share
 * code — so any change here belongs in frontend/netlify/functions/_lib too. The
 * two must agree: the dashboard reports the number, the frontend acts on it.
 */

export interface FormCap {
  /** Stop accepting once this many are counted. */
  limit?: number;
  /** The field whose numbers are added up. Blank counts submissions instead. */
  countField?: string;
  /** Counted before the form started recording it. */
  alreadyCounted?: number;
  /**
   * A field summed over the sign-ups with no count, as evidence for what the
   * opening figure should be. Reported, never enforced.
   */
  estimateField?: string;
}

export interface CapStatus {
  capped: boolean;
  limit: number;
  /** Everything counted: the recorded total plus the opening figure. */
  counted: number;
  /** Of that, what the form itself recorded. */
  recorded: number;
  alreadyCounted: number;
  /** Never below zero — an overshoot reads as full, not as negative room. */
  remaining: number;
  full: boolean;
  /** Sign-ups carrying no number at all. */
  uncounted: number;
  /** What those sign-ups come to in the estimate field. Evidence, not a count. */
  estimate: number;
  /** Capped, but with uncounted sign-ups and no opening figure for them. */
  pending: boolean;
  /** Capped and trustworthy enough to close the form. */
  enforced: boolean;
}

export interface RecordedCount {
  recorded: number;
  submissions: number;
  /** How many submissions predate the counting field. */
  withoutCount: number;
  /** The estimate field summed over those. */
  estimate: number;
}

const whole = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function capStatus(
  cap: FormCap | null | undefined,
  count: number | Partial<RecordedCount>,
): CapStatus {
  const c: Partial<RecordedCount> = typeof count === 'number' ? { recorded: count } : count;
  const limit = whole(cap?.limit);
  const alreadyCounted = whole(cap?.alreadyCounted);
  const recorded = whole(c.recorded);
  const counted = recorded + alreadyCounted;
  const uncounted = whole(c.withoutCount);
  const capped = limit > 0;
  // Uncounted sign-ups and nothing entered for them: the total is known to be
  // short by an unknown amount, so it is reported and not acted on.
  const pending = capped && uncounted > 0 && alreadyCounted === 0;
  const enforced = capped && !pending;
  return {
    capped,
    limit,
    counted,
    recorded,
    alreadyCounted,
    remaining: capped ? Math.max(0, limit - counted) : 0,
    uncounted,
    estimate: whole(c.estimate),
    pending,
    enforced,
    // A family that crosses the line is not turned away — see `atCapacity`.
    full: enforced && counted >= limit,
  };
}

/**
 * Whether to refuse this submission.
 *
 * The cap is a stopping point, not a quota to fill exactly. A family of four
 * arriving when two places are left is accepted and the total goes to 152,
 * because the alternative is signing up two of somebody's children. So the
 * question asked of each submission is only whether the cap was *already* met
 * before it arrived.
 */
export const atCapacity = (status: CapStatus): boolean => status.enforced && status.full;

/**
 * What the form has recorded, out of Turso.
 *
 * The submissions are JSON text in one column, so the sum happens in SQLite
 * rather than by reading every row back and adding them up here: a seasonal
 * form accumulates hundreds, and this runs on every page view of the form.
 *
 * `json_extract` returns null for a submission with no such key, and SUM
 * ignores nulls — which is exactly right for the months the field did not
 * exist. CAST turns "3" into 3 and anything unparseable into 0.
 */
export async function countRecorded(
  db: { execute: (q: { sql: string; args: unknown[] }) => Promise<{ rows: unknown[] }> },
  slug: string,
  countField?: string,
  estimateField?: string,
): Promise<RecordedCount> {
  const field = (countField ?? '').trim();
  const est = (estimateField ?? '').trim();

  if (!field) {
    // No field to add up, so the cap counts sign-ups. One sign-up is a family,
    // which is a different measurement — but it is never an unknown one, so
    // there is nothing uncounted and nothing to estimate.
    const row = (await db.execute({
      sql: `SELECT COUNT(*) AS recorded FROM form_submissions WHERE form_slug = ?`,
      args: [slug],
    })).rows[0] as { recorded?: number } | undefined;
    const n = Number(row?.recorded ?? 0);
    return { recorded: n, submissions: n, withoutCount: 0, estimate: 0 };
  }

  const path = `$.${field}`;
  const estPath = est ? `$.${est}` : null;
  const sql = `SELECT
      COALESCE(SUM(CAST(json_extract(data, ?) AS INTEGER)), 0) AS recorded,
      COUNT(*) AS submissions,
      SUM(CASE WHEN json_extract(data, ?) IS NULL THEN 1 ELSE 0 END) AS without_count,
      ${estPath
        ? `COALESCE(SUM(CASE WHEN json_extract(data, ?) IS NULL
             THEN CAST(json_extract(data, ?) AS INTEGER) ELSE 0 END), 0)`
        : '0'} AS estimate
    FROM form_submissions WHERE form_slug = ?`;
  const args = estPath
    ? [path, path, path, estPath, slug]
    : [path, path, slug];

  const row = (await db.execute({ sql, args })).rows[0] as
    | { recorded?: number; submissions?: number; without_count?: number; estimate?: number }
    | undefined;
  return {
    recorded: Number(row?.recorded ?? 0),
    submissions: Number(row?.submissions ?? 0),
    // Not a correction — a number for the person deciding what the opening
    // figure should be, and the size of what they are estimating.
    withoutCount: Number(row?.without_count ?? 0),
    estimate: Number(row?.estimate ?? 0),
  };
}
