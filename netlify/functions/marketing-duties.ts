import { requireCapability, denial } from './_lib/verify-okta';
import { isAdmin, hasCapability } from '../../src/lib/capabilities';
import { turso } from './_lib/staff-directory';

/**
 * The recurring marketing duties list.
 *
 * Everything except `status` is reference data seeded from
 * jc_marketing_recurring_duties.json, so this endpoint reads it and writes
 * exactly one column. That is enforced here rather than only in the interface:
 * a form that shows one editable field is a courtesy, not access control.
 *
 * Visibility is per row. A duty is shown to the group named in its
 * `access_group`; a duty with no group is shown to dashboard admins only.
 * Unassigned must not mean unrestricted — three duties currently have no owner
 * and no group, and defaulting those to "everyone" would be the wrong way
 * round.
 *
 * Reading and editing are separate permissions. Several people can open the
 * list; only `dutiesEdit` can change a status. The list is currently being used
 * to settle who owns what, so until that conversation has happened the statuses
 * are one person's record rather than a shared scratchpad.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const json = (statusCode: number, body: unknown) => ({
  statusCode, headers: JSON_HEADERS, body: JSON.stringify(body),
});

/**
 * The statuses the list may hold.
 *
 * Seeded from the source file, which uses several near-synonyms — "Ongoing",
 * "Ongoing (manual)", "Ongoing (owned)". Those are kept rather than collapsed,
 * because deciding they mean the same thing is an editorial call for whoever
 * owns the roster. "Done" is added, since nothing in the file could reach a
 * finished state.
 */
export const STATUSES = [
  'Not Started', 'In Progress', 'Ongoing', 'Ongoing (manual)', 'Ongoing (owned)',
  'Needs Decision', 'Needs Improvement', 'Done',
] as const;

const CADENCE_RANK: [RegExp, number][] = [
  [/daily/i, 1], [/\d\s*[-–]\s*\d\s*x\s*\/?\s*week/i, 2], [/week/i, 3],
  [/month|quarter/i, 4], [/per piece/i, 5], [/ongoing/i, 6],
  [/ad hoc|as available|tbd/i, 7],
];
/** Sort order for a cadence written in prose. Unrecognised sorts last. */
function cadenceRank(cadence: string): number {
  for (const [re, rank] of CADENCE_RANK) if (re.test(cadence)) return rank;
  return 8;
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'duties');
  if (!auth.ok) return denial(auth);

  const admin = isAdmin(auth.groups);
  const canEdit = hasCapability(auth.groups, 'dutiesEdit');
  const mine = new Set((auth.groups ?? []).map((g) => g.trim().toLowerCase()));
  const canSee = (accessGroup: string | null) =>
    admin || (!!accessGroup && mine.has(accessGroup.trim().toLowerCase()));

  try {
    const db = turso();

    if (event.httpMethod === 'POST') {
      // Checked before anything is parsed: a reader who can see a row still
      // may not change it, and that is enforced here rather than by the
      // interface disabling a dropdown.
      if (!canEdit) return json(403, { error: 'Changing a status is not available to your account' });

      const body = JSON.parse(event.body || '{}') as { id?: string; status?: string };
      const id = (body.id ?? '').trim();
      const status = (body.status ?? '').trim();
      if (!id || !status) return json(400, { error: 'id and status are required' });
      if (!(STATUSES as readonly string[]).includes(status)) {
        return json(400, { error: 'Unknown status' });
      }

      // Re-read the row's access_group rather than trusting anything sent, so
      // the check is against what is stored, not what was displayed.
      const { rows } = await db.execute({
        sql: 'SELECT access_group FROM marketing_duties WHERE id = ? LIMIT 1',
        args: [id],
      });
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) return json(404, { error: 'No such duty' });
      if (!canSee(row.access_group == null ? null : String(row.access_group))) {
        return json(403, { error: 'Not available to your account' });
      }

      const now = Math.floor(Date.now() / 1000);
      await db.execute({
        sql: `UPDATE marketing_duties
              SET status = ?, status_updated_by = ?, status_updated_at = ?
              WHERE id = ?`,
        args: [status, auth.email ?? 'unknown', now, id],
      });
      return json(200, { saved: true, statusUpdatedBy: auth.email ?? 'unknown', statusUpdatedAt: now });
    }

    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

    const { rows } = await db.execute(
      `SELECT id, task, category, cadence, priority, status, owner, owner_names,
              title_role, access_group, notes, source, status_updated_by, status_updated_at
       FROM marketing_duties`
    );

    const visible = (rows as unknown as Record<string, unknown>[])
      .filter((r) => canSee(r.access_group == null ? null : String(r.access_group)))
      .map((r) => ({
        id: String(r.id),
        task: String(r.task),
        category: String(r.category),
        cadence: String(r.cadence),
        cadenceRank: cadenceRank(String(r.cadence)),
        priority: String(r.priority),
        status: String(r.status),
        owner: r.owner == null ? null : String(r.owner),
        ownerNames: (() => { try { return JSON.parse(String(r.owner_names ?? '[]')) as string[]; } catch { return []; } })(),
        titleRole: r.title_role == null ? null : String(r.title_role),
        accessGroup: r.access_group == null ? null : String(r.access_group),
        notes: r.notes == null ? null : String(r.notes),
        source: r.source == null ? null : String(r.source),
        statusUpdatedBy: r.status_updated_by == null ? null : String(r.status_updated_by),
        statusUpdatedAt: r.status_updated_at == null ? null : Number(r.status_updated_at),
      }));

    // Owner, then cadence: the list is read as "what am I meant to be doing",
    // and the answer starts with whose it is.
    visible.sort((a, b) =>
      (a.ownerNames[0] ?? a.owner ?? '').localeCompare(b.ownerNames[0] ?? b.owner ?? '') ||
      a.cadenceRank - b.cadenceRank ||
      a.task.localeCompare(b.task)
    );

    return json(200, {
      duties: visible,
      statuses: STATUSES,
      hiddenCount: rows.length - visible.length,
      isAdmin: admin,
      canEdit,
    });
  } catch (err) {
    console.error('marketing-duties:', err);
    return json(500, { error: 'Could not load the duties list' });
  }
}
