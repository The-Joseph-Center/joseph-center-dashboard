import { Resend } from 'resend';
import { turso } from './_lib/staff-directory';
import { SANITY_DATASET } from './_lib/sanity-dataset';

/**
 * The week's sign-ups for a seasonal form, to whoever is running it.
 *
 * A form like Angel Tree is not answered submission by submission — a family
 * signs up, and what the person running it needs is the list on a Friday so
 * they can work from it. An email per arrival would be noise during the rush
 * and silence the rest of the time, so a form set to "weekly" sends nothing on
 * submission and is collected here instead.
 *
 * Sent while the form is open, and once more the week after it closes so the
 * last few are not stranded. A week with no sign-ups still sends, briefly: for
 * a sign-up with a deadline, "nobody yet" is information, and silence from a
 * tool is indistinguishable from a tool that has broken.
 */

const resend = new Resend(process.env.RESEND_API_KEY);
const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const WEEK = 7 * 86400;

interface Form {
  title: string; slug: string; active: boolean;
  notifyEmail: string; notifyMode: string;
  activeDates?: { start?: string; end?: string } | null;
}

interface Submission { at: number; data: Record<string, unknown> }

async function weeklyForms(): Promise<Form[]> {
  const query = `*[_type=="dynamicForm" && notifyMode=="weekly" && defined(notifyEmail) && notifyEmail != ""]{
    title,"slug":slug.current,active,notifyEmail,notifyMode,activeDates
  }`;
  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/data/query/${SANITY_DATASET}?query=${encodeURIComponent(query)}`
  );
  if (!res.ok) throw new Error(`Sanity query: ${res.status}`);
  return ((await res.json()) as { result?: Form[] }).result ?? [];
}

/** Open now, or closed recently enough that the last week still wants reporting. */
function shouldSend(f: Form, now: number): { send: boolean; closed: boolean } {
  const end = f.activeDates?.end ? new Date(f.activeDates.end).getTime() / 1000 : null;
  const start = f.activeDates?.start ? new Date(f.activeDates.start).getTime() / 1000 : null;
  if (start && now < start) return { send: false, closed: false };

  const closedByDate = end !== null && now > end;
  const closed = !f.active || closedByDate;
  if (!closed) return { send: true, closed: false };

  // One final digest, the week after closing — by the switch or by the date.
  if (closedByDate && now - end! < WEEK) return { send: true, closed: true };
  return { send: false, closed: true };
}

function render(f: Form, rows: Submission[], closed: boolean) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const when = (at: number) => new Date(at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const line = (s: Submission) =>
    Object.entries(s.data)
      .filter(([, v]) => String(v ?? '').trim())
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' · ');

  const intro = closed
    ? `${f.title} has closed. This is the last week of sign-ups.`
    : rows.length
      ? `${rows.length} new sign-up${rows.length === 1 ? '' : 's'} this week.`
      : 'No new sign-ups this week.';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#262626;max-width:640px;">
  <h2 style="font-size:17px;margin:0 0 4px;">${esc(f.title)} — this week</h2>
  <p style="margin:0 0 14px;color:#5C5C5C;font-size:14px;">${esc(intro)}</p>
  ${rows.length ? `<ol style="margin:0;padding-left:18px;font-size:14px;">${rows
    .map((s) => `<li style="margin:6px 0;"><span style="color:#5C5C5C;">${esc(when(s.at))}</span> — ${esc(line(s))}</li>`)
    .join('')}</ol>` : ''}
  <p style="margin:16px 0 0;font-size:13px;color:#5C5C5C;">
    Every sign-up, including earlier weeks, is in the dashboard under Seasonal forms.
  </p>
</div>`.trim();

  const text = [
    `${f.title.toUpperCase()} — THIS WEEK`,
    intro,
    '',
    ...rows.map((s) => `  ${when(s.at)} — ${line(s)}`),
    '',
    'Every sign-up, including earlier weeks, is in the dashboard under Seasonal forms.',
  ].join('\n');

  const subject = closed
    ? `${f.title} — final sign-ups`
    : `${f.title} — ${rows.length} sign-up${rows.length === 1 ? '' : 's'} this week`;
  return { subject, html, text };
}

export async function handler() {
  if (!PROJECT || !process.env.RESEND_API_KEY) {
    console.error('form-digest: missing configuration; refusing to run');
    return { statusCode: 500, body: 'not configured' };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const forms = await weeklyForms();
    const db = turso();
    const sent: string[] = [];

    for (const f of forms) {
      const { send, closed } = shouldSend(f, now);
      if (!send) continue;

      const { rows } = await db.execute({
        sql: `SELECT submitted_at AS at, data FROM form_submissions
               WHERE form_slug = ? AND submitted_at >= ?
               ORDER BY submitted_at`,
        args: [f.slug, now - WEEK],
      });
      const subs: Submission[] = rows.map((r) => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(String(r.data ?? '{}')); } catch { /* keep the row, lose the detail */ }
        return { at: Number(r.at ?? 0), data };
      });

      const mail = render(f, subs, closed);
      const { error } = await resend.emails.send({
        from: `The Joseph Center <${process.env.QUOTE_REVIEW_FROM_EMAIL || 'no-reply@josephcentergj.com'}>`,
        to: f.notifyEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (error) console.error('form-digest: Resend rejected the send:', error);
      else sent.push(`${f.slug} → ${f.notifyEmail} (${subs.length})`);
    }

    console.log('form-digest:', JSON.stringify({ forms: forms.length, sent }));
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
  } catch (err) {
    console.error('form-digest:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'digest failed' }) };
  }
}
