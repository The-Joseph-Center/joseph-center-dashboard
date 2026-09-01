import { verifyRequest, denial } from './_lib/verify-okta';
import { canSeeForm, formsFor, type FormId } from '../../src/lib/capabilities';
import { FORMS, formById, type FormDef, type Column } from '../../src/lib/submissionForms';
import { turso } from './_lib/staff-directory';

/**
 * Reads form submissions out of Turso.
 *
 * Access is decided per form, not per page: the caller's groups are checked
 * against FORM_ACCESS for the specific form being asked for, so reaching this
 * endpoint at all proves nothing about which forms come back. Anyone can name
 * any form in the query string; only the ones their groups allow will answer.
 *
 * Every table and column name comes from the FORMS definition. Nothing from the
 * request is interpolated into SQL — the form id is looked up, not substituted,
 * and values are bound. That is what makes a query built from a definition safe
 * where a query built from a parameter would not be.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_ROWS = 500;

/**
 * The local year a submission belongs to.
 *
 * Timestamps are stored as UTC unix seconds, and a year filter has to agree
 * with the calendar on the wall: an Angel Tree form submitted at 6pm on 31
 * December is December's, not next year's. The offset only ever matters at the
 * year boundary, which is always in standard time, so -7 is exact rather than
 * approximate — no daylight-saving case exists on 1 January.
 */
const localYear = (col: string) => `strftime('%Y', ${col}, 'unixepoch', '-7 hours')`;

function rowsToCsv(columns: Column[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Formatted the same way the table formats it. An export of raw unix seconds
  // is a spreadsheet nobody can read, and the whole point of the export is that
  // it gets opened somewhere else.
  const cell = (c: Column, v: unknown) => {
    if (v == null || v === '') return '';
    if (c.type === 'date') return new Date(Number(v) * 1000).toISOString().replace('T', ' ').slice(0, 16);
    if (c.type === 'bool') return v ? 'Yes' : 'No';
    return v;
  };
  return [
    columns.map((c) => esc(c.label)).join(','),
    ...rows.map((r) => columns.map((c) => esc(cell(c, r[c.key]))).join(',')),
  ].join('\n');
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);

  const q = event.queryStringParameters ?? {};
  const allowed = formsFor(auth.groups);

  try {
    const db = turso();

    // ── No form named: what may this person open, and how much is in each ──
    if (!q.form) {
      const summary = await Promise.all(
        FORMS.filter((f) => allowed.includes(f.id)).map(async (f) => {
          const { rows } = await db.execute(
            `SELECT COUNT(*) AS total, MAX(${f.timeColumn}) AS latest FROM ${f.table}`
          );
          return {
            id: f.id, label: f.label, description: f.description, sensitive: f.sensitive ?? null,
            archived: f.archived ?? false,
            total: Number(rows[0]?.total ?? 0),
            latest: rows[0]?.latest == null ? null : Number(rows[0].latest),
          };
        })
      );
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ forms: summary }) };
    }

    const def: FormDef | undefined = formById(q.form);
    // Same answer for "no such form" and "not yours", so the endpoint cannot be
    // used to enumerate what exists.
    if (!def || !canSeeForm(auth.groups, def.id as FormId)) {
      return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Not available to your account' }) };
    }

    const where: string[] = [];
    const args: unknown[] = [];

    if (q.year) {
      where.push(`${localYear(def.timeColumn)} = ?`);
      args.push(String(Number(q.year)));
    }
    if (q.group && def.groupColumn) {
      where.push(`${def.groupColumn} = ?`);
      args.push(q.group);
    }
    if (q.q?.trim()) {
      const term = `%${q.q.trim()}%`;
      where.push(`(${def.searchColumns.map((c) => `IFNULL(${c},'') LIKE ?`).join(' OR ')})`);
      def.searchColumns.forEach(() => args.push(term));
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const csv = q.format === 'csv';
    const limit = csv ? MAX_ROWS : Math.min(Number(q.limit) || 50, MAX_ROWS);
    const offset = Math.max(Number(q.offset) || 0, 0);

    // Follow-up is keyed by row id, which is not otherwise one of the display
    // columns, so it has to come back with the page.
    const tracksFollowUp = !!def.followUp?.length;
    const keys = def.columns.map((c) => c.key);
    const select = (tracksFollowUp && !keys.includes('id') ? ['id', ...keys] : keys).join(', ');
    const [page, counted, years, groups] = await Promise.all([
      db.execute({
        sql: `SELECT ${select} FROM ${def.table}${clause} ORDER BY ${def.timeColumn} DESC LIMIT ? OFFSET ?`,
        args: [...args, limit, offset],
      }),
      db.execute({ sql: `SELECT COUNT(*) AS n FROM ${def.table}${clause}`, args }),
      db.execute(
        `SELECT DISTINCT ${localYear(def.timeColumn)} AS y FROM ${def.table} ORDER BY y DESC`
      ),
      def.groupColumn
        ? db.execute(`SELECT DISTINCT ${def.groupColumn} AS g FROM ${def.table} ORDER BY g`)
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);

    const rows = page.rows as unknown as Record<string, unknown>[];

    // One query for the whole page rather than one per row.
    let followUps: Record<string, unknown> = {};
    if (tracksFollowUp && rows.length) {
      const ids = rows.map((r) => String(r.id));
      const marks = ids.map(() => '?').join(', ');
      const { rows: fu } = await db.execute({
        sql: `SELECT row_id, status, note, updated_by, updated_at
              FROM submission_followups
              WHERE form_id = ? AND row_id IN (${marks})`,
        args: [def.id, ...ids],
      });
      followUps = Object.fromEntries(fu.map((f) => [String(f.row_id), {
        status: f.status, note: f.note,
        updatedBy: f.updated_by, updatedAt: Number(f.updated_at),
      }]));
    }

    if (csv) {
      // Sensitive forms are readable in the browser but not downloadable: a
      // spreadsheet of home addresses leaves the building the moment it exists,
      // and nothing here can follow it.
      if (def.exportable === false || (def.exportable === undefined && def.sensitive)) {
        return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: 'This form cannot be exported.' }) };
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${def.id}${q.year ? `-${Number(q.year)}` : ''}.csv"`,
        },
        body: rowsToCsv(def.columns, rows),
      };
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        form: {
          id: def.id, label: def.label, description: def.description,
          sensitive: def.sensitive ?? null, columns: def.columns,
          exportable: def.exportable ?? !def.sensitive, groupColumn: def.groupColumn ?? null,
          followUp: def.followUp ?? null,
        },
        rows,
        followUps,
        total: Number(counted.rows[0]?.n ?? 0),
        years: years.rows.map((r) => String(r.y)).filter(Boolean),
        groups: groups.rows.map((r) => String(r.g)).filter(Boolean),
        limit, offset,
      }),
    };
  } catch (err) {
    console.error('list-submissions:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load submissions' }) };
  }
}
