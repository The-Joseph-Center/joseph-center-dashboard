import { requireCapability, denial } from './_lib/verify-okta';
import { isAdmin, hasCapability, RULES } from '../../src/lib/capabilities';
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
 * Holding the capability is necessary but not sufficient: a caller who can see
 * no duties has no page. The Event Coordinator group can open the list, but no
 * duty is assigned to it, so the answer is 403 rather than an empty screen —
 * a menu item leading to nothing is worse than no menu item.
 *
 * `?probe=1` answers only whether there is anything to see, so the sidebar can
 * decide whether to draw the link without pulling the rows to do it.
 *
 * Two things are editable, and they are one decision rather than two: who owns
 * a duty, and which group can see it. Assigning a duty to someone who is not in
 * its access_group hands them work they cannot open, which is the exact gap
 * this list was built to expose — so the two are set together and the caller is
 * told when they disagree.
 *
 * Anyone who can see a duty can put their hand up for it. That is deliberately
 * a wider permission than editing: the list exists partly so somebody new can
 * read the shape of the job and say what they could take on, and requiring
 * edit rights to do that would defeat the purpose. Registering interest changes
 * nothing — not the owner, not who can see the duty — it is a note for whoever
 * vets it.
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

/** The groups a duty may be assigned to — exactly those that can open the page. */
const ASSIGNABLE = (RULES.duties === '*' ? [] : RULES.duties).filter((g) => g !== 'jc-dashboard-admins');

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
  queryStringParameters?: Record<string, string> | null;
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
      const body = JSON.parse(event.body || '{}') as {
        id?: string; status?: string; ownerNames?: unknown; accessGroup?: unknown;
        interested?: unknown; note?: unknown;
      };
      const id = (body.id ?? '').trim();
      if (!id) return json(400, { error: 'id is required' });

      // Putting a hand up is open to anyone who can see the duty, so it is
      // handled before the edit gate rather than behind it.
      if ('interested' in body) {
        const seen = await db.execute({
          sql: 'SELECT access_group FROM marketing_duties WHERE id = ? LIMIT 1',
          args: [id],
        });
        const dutyRow = seen.rows[0] as Record<string, unknown> | undefined;
        if (!dutyRow) return json(404, { error: 'No such duty' });
        if (!canSee(dutyRow.access_group == null ? null : String(dutyRow.access_group))) {
          return json(403, { error: 'Not available to your account' });
        }

        const who = auth.email ?? 'unknown';
        if (body.interested) {
          const name = typeof auth.claims?.name === 'string' ? auth.claims.name : null;
          const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null;
          await db.execute({
            sql: `INSERT INTO duty_interest (duty_id, person, person_name, note, created_at)
                  VALUES (?, ?, ?, ?, unixepoch())
                  ON CONFLICT(duty_id, person) DO UPDATE SET note = excluded.note`,
            args: [id, who, name, note],
          });
        } else {
          // Withdrawing removes the row. A stored "no" would make never having
          // looked and having considered it look the same.
          await db.execute({
            sql: 'DELETE FROM duty_interest WHERE duty_id = ? AND person = ?',
            args: [id, who],
          });
        }
        return json(200, { saved: true, interested: !!body.interested });
      }

      // Everything below changes the duty itself, which is editors only.
      if (!canEdit) return json(403, { error: 'Changing a duty is not available to your account' });

      const settingStatus = typeof body.status === 'string';
      const settingOwner = 'ownerNames' in body || 'accessGroup' in body;
      if (!settingStatus && !settingOwner) {
        return json(400, { error: 'Nothing to change' });
      }

      const status = (body.status ?? '').trim();
      if (settingStatus && !(STATUSES as readonly string[]).includes(status)) {
        return json(400, { error: 'Unknown status' });
      }

      let ownerNames: string[] = [];
      let accessGroup: string | null = null;
      if (settingOwner) {
        const raw = Array.isArray(body.ownerNames) ? body.ownerNames : [];
        ownerNames = raw
          .map((n) => String(n).trim())
          .filter(Boolean)
          .slice(0, 5);
        const ag = body.accessGroup == null ? null : String(body.accessGroup).trim();
        // Only a group that can open the page may own a duty. Anything else
        // would assign work to people who cannot see it, silently.
        if (ag && !ASSIGNABLE.some((g) => g.toLowerCase() === ag.toLowerCase())) {
          return json(400, { error: 'That group cannot open the duties list' });
        }
        accessGroup = ag || null;
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
      const by = auth.email ?? 'unknown';

      if (settingStatus) {
        await db.execute({
          sql: `UPDATE marketing_duties
                SET status = ?, status_updated_by = ?, status_updated_at = ?
                WHERE id = ?`,
          args: [status, by, now, id],
        });
      }
      if (settingOwner) {
        await db.execute({
          sql: `UPDATE marketing_duties
                SET owner = ?, owner_names = ?, access_group = ?,
                    owner_updated_by = ?, owner_updated_at = ?
                WHERE id = ?`,
          args: [
            // The display string is derived rather than typed, so it cannot
            // drift from the list it summarises.
            ownerNames.length ? ownerNames.join(' / ') : null,
            JSON.stringify(ownerNames),
            accessGroup,
            by, now, id,
          ],
        });
      }

      return json(200, {
        saved: true,
        updatedBy: by,
        updatedAt: now,
        ...(settingOwner ? { owner: ownerNames.length ? ownerNames.join(' / ') : null, ownerNames, accessGroup } : {}),
      });
    }

    if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

    const { rows } = await db.execute(
      `SELECT id, task, category, cadence, priority, status, owner, owner_names,
              title_role, access_group, notes, source,
              status_updated_by, status_updated_at, owner_updated_by, owner_updated_at
       FROM marketing_duties`
    );

    // For editors only: who the duties can be handed to, and which group each
    // person is in. Offered as a list rather than a text box because the source
    // spreadsheet already carries "TBD", "Leslie / Khira" and "Eric (final
    // sign-off)" as owner values, and free text is how that happens.
    let assignable: { group: string; members: string[] }[] | null = null;
    if (canEdit) {
      try {
        const org = process.env.VITE_OKTA_ISSUER;
        const token = process.env.OKTA_API_TOKEN;
        if (org && token) {
          const base = new URL(org).origin;
          const headers = { Authorization: `SSWS ${token}`, Accept: 'application/json' };
          const oktaGroups = await (await fetch(`${base}/api/v1/groups?limit=200`, { headers })).json() as
            { id: string; profile: { name: string } }[];
          assignable = [];
          for (const name of ASSIGNABLE) {
            const g = oktaGroups.find((x) => x.profile.name.toLowerCase() === name.toLowerCase());
            if (!g) { assignable.push({ group: name, members: [] }); continue; }
            const members = await (await fetch(`${base}/api/v1/groups/${g.id}/users?limit=200`, { headers })).json() as
              { status?: string; profile?: { firstName?: string; lastName?: string } }[];
            assignable.push({
              group: g.profile.name,
              members: members
                .filter((m) => m.status === 'ACTIVE')
                .map((m) => (m.profile?.firstName ?? '').trim())
                .filter(Boolean)
                .sort(),
            });
          }
        }
      } catch (err) {
        // The list still works without it; the picker falls back to what the
        // duties already name.
        console.error('marketing-duties: could not read assignable people:', err);
        assignable = null;
      }
    }

    const interestRows = (await db.execute(
      'SELECT duty_id, person, person_name, note, created_at FROM duty_interest'
    )).rows as unknown as Record<string, unknown>[];
    const me = auth.email ?? '';
    const interestByDuty = new Map<string, Record<string, unknown>[]>();
    for (const r of interestRows) {
      const k = String(r.duty_id);
      if (!interestByDuty.has(k)) interestByDuty.set(k, []);
      interestByDuty.get(k)!.push(r);
    }

    const all = rows as unknown as Record<string, unknown>[];
    const mineRows = all.filter((r) => canSee(r.access_group == null ? null : String(r.access_group)));

    // An editor keeps the page even when it is empty — somebody has to be able
    // to reach a list in order to fill it.
    const available = mineRows.length > 0 || canEdit;

    if ((event.queryStringParameters ?? {}).probe) {
      return json(200, { available, visibleCount: mineRows.length, canEdit });
    }
    if (!available) {
      return json(403, { error: 'No duties are assigned to your account' });
    }

    const visible = mineRows
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
        ownerUpdatedBy: r.owner_updated_by == null ? null : String(r.owner_updated_by),
        ownerUpdatedAt: r.owner_updated_at == null ? null : Number(r.owner_updated_at),
        // Whether I have put my hand up. Everyone gets their own answer.
        myInterest: (() => {
          const mine = (interestByDuty.get(String(r.id)) ?? []).find((x) => String(x.person) === me);
          return mine ? { note: mine.note == null ? null : String(mine.note) } : null;
        })(),
        // Who else has, shown only to whoever vets them.
        interest: canEdit
          ? (interestByDuty.get(String(r.id)) ?? []).map((x) => ({
              person: String(x.person),
              personName: x.person_name == null ? null : String(x.person_name),
              note: x.note == null ? null : String(x.note),
              createdAt: Number(x.created_at),
            })).sort((a, b) => a.createdAt - b.createdAt)
          : [],
        interestCount: canEdit ? (interestByDuty.get(String(r.id)) ?? []).length : 0,
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
      assignable,
    });
  } catch (err) {
    console.error('marketing-duties:', err);
    return json(500, { error: 'Could not load the duties list' });
  }
}
