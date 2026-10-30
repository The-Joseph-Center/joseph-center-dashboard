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
 * And it carries `alreadyCounted`, because the count almost never starts at
 * zero. The 2026 form ran for weeks without asking how many children were in
 * the household, so those submissions hold no number to add up; whoever is
 * running it enters their own figure for everyone counted before the field
 * existed, and the total is that plus what the form has recorded since. A cap
 * built without this would silently reset to zero and overshoot by however many
 * families had already signed up.
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
}

const whole = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function capStatus(cap: FormCap | null | undefined, recorded: number): CapStatus {
  const limit = whole(cap?.limit);
  const alreadyCounted = whole(cap?.alreadyCounted);
  const counted = whole(recorded) + alreadyCounted;
  return {
    capped: limit > 0,
    limit,
    counted,
    recorded: whole(recorded),
    alreadyCounted,
    remaining: limit > 0 ? Math.max(0, limit - counted) : 0,
    // A family that crosses the line is not turned away — see `atCapacity`.
    full: limit > 0 && counted >= limit,
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
export const atCapacity = (status: CapStatus): boolean => status.capped && status.full;

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
): Promise<{ recorded: number; submissions: number; withoutCount: number }> {
  const field = (countField ?? '').trim();
  const sql = field
    ? `SELECT
         COALESCE(SUM(CAST(json_extract(data, ?) AS INTEGER)), 0) AS recorded,
         COUNT(*) AS submissions,
         SUM(CASE WHEN json_extract(data, ?) IS NULL THEN 1 ELSE 0 END) AS without_count
       FROM form_submissions WHERE form_slug = ?`
    : `SELECT COUNT(*) AS recorded, COUNT(*) AS submissions, 0 AS without_count
       FROM form_submissions WHERE form_slug = ?`;
  const path = `$.${field}`;
  const args = field ? [path, path, slug] : [slug];
  const row = (await db.execute({ sql, args })).rows[0] as
    | { recorded?: number; submissions?: number; without_count?: number }
    | undefined;
  return {
    recorded: Number(row?.recorded ?? 0),
    submissions: Number(row?.submissions ?? 0),
    // How many submissions predate the counting field. Not a correction — a
    // number for the person deciding what `alreadyCounted` should be.
    withoutCount: Number(row?.without_count ?? 0),
  };
}
