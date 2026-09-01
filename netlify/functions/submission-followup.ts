import { verifyRequest, denial } from './_lib/verify-okta';
import { canSeeForm, type FormId } from '../../src/lib/capabilities';
import { formById } from '../../src/lib/submissionForms';
import { turso } from './_lib/staff-directory';

/**
 * Records who followed up on a submission, and what came of it.
 *
 * Access is the same question as reading the form: if you can open the
 * Coffee Chat inbox you can say you have spoken to an applicant. There is no
 * separate permission, because a reader who cannot record what they did is how
 * two people end up emailing the same guest.
 *
 * `updated_by` is taken from the verified token, never from the request body —
 * otherwise anyone could file their follow-up under someone else's name.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const json = (statusCode: number, body: unknown) => ({
  statusCode, headers: JSON_HEADERS, body: JSON.stringify(body),
});

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: { form?: string; id?: string; status?: string; note?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const def = body.form ? formById(body.form) : undefined;
  // Same answer for "no such form" and "not yours", matching list-submissions,
  // so the endpoint cannot be used to enumerate what exists.
  if (!def || !canSeeForm(auth.groups, def.id as FormId)) {
    return json(403, { error: 'Not available to your account' });
  }
  if (!def.followUp?.length) {
    return json(400, { error: 'This form does not track follow-up' });
  }
  if (!body.id) return json(400, { error: 'id is required' });

  // Clearing the status removes the row rather than storing an empty one, so
  // "never touched" and "explicitly un-set" look the same in the inbox.
  if (!body.status) {
    await turso().execute({
      sql: 'DELETE FROM submission_followups WHERE form_id = ? AND row_id = ?',
      args: [def.id, String(body.id)],
    });
    return json(200, { ok: true, cleared: true });
  }

  if (!def.followUp.includes(body.status)) {
    return json(400, { error: 'Unknown status for this form' });
  }

  const note = (body.note ?? '').trim().slice(0, 2000) || null;
  const now = Math.floor(Date.now() / 1000);
  // The token always carries email in practice; the fallback exists so a
  // malformed one records an unattributed follow-up rather than throwing away
  // the fact that somebody acted.
  const by = auth.email ?? 'unknown';

  await turso().execute({
    sql: `INSERT INTO submission_followups (form_id, row_id, status, note, updated_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(form_id, row_id) DO UPDATE SET
            status = excluded.status,
            note = excluded.note,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
    args: [def.id, String(body.id), body.status, note, by, now],
  });

  return json(200, {
    ok: true,
    followUp: { status: body.status, note, updatedBy: by, updatedAt: now },
  });
}
