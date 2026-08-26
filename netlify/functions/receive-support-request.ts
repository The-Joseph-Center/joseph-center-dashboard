import { Resend } from 'resend';
import { verifyRequest, denial } from './_lib/verify-okta';

// The Contact & Support form on the dashboard.
//
// This function did not exist: SupportPage has been POSTing to it since the
// template was scaffolded, so every support request has returned 404 and been
// lost. Nobody noticed because plain vite never ran the Functions at all.
//
// The submitter's identity comes from the verified token rather than the form
// body — the form pre-fills name and email from the session, and those fields
// are editable, so trusting them would let anyone raise a request as someone
// else.

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX = { subject: 200, message: 4000, category: 40 };

const resend = new Resend(process.env.RESEND_API_KEY);

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CATEGORY_LABELS: Record<string, string> = {
  question: 'Question',
  bug: 'Something is broken',
  change: 'Change request',
  billing: 'Billing',
  other: 'Other',
};

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const subject = clean(body.subject, MAX.subject);
  const message = clean(body.message, MAX.message);
  const category = clean(body.category, MAX.category) || 'question';

  if (!subject || !message) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A subject and a message are required.' }) };
  }

  // From the token, not the form.
  const fromEmail = auth.email ?? 'unknown';
  const fromName = clean(body.name, 120) || fromEmail;
  const clientName = clean(body.clientName, 120) || 'Dashboard';

  const to = process.env.SUPPORT_TO_EMAIL || process.env.QUOTE_REVIEW_TO_EMAIL || 'ephifer@josephcentergj.com';
  const from = process.env.QUOTE_REVIEW_FROM_EMAIL || 'no-reply@josephcentergj.com';
  const label = CATEGORY_LABELS[category] ?? category;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#262626;max-width:620px;">
  <h2 style="font-size:17px;margin:0 0 4px;">${esc(subject)}</h2>
  <p style="margin:0 0 18px;color:#5C5C5C;font-size:14px;">${esc(label)} · raised from the ${esc(clientName)} dashboard</p>
  <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;">
    <tr><td style="padding:6px 0;color:#5C5C5C;width:120px;">From</td><td style="padding:6px 0;"><strong>${esc(fromName)}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#5C5C5C;">Signed in as</td><td style="padding:6px 0;">${esc(fromEmail)}</td></tr>
    <tr><td style="padding:6px 0;color:#5C5C5C;">Category</td><td style="padding:6px 0;">${esc(label)}</td></tr>
  </table>
  <p style="margin:18px 0 6px;font-size:13px;color:#5C5C5C;">Message</p>
  <div style="padding:12px 14px;background:#F7F5EE;border-left:3px solid #1D5F55;font-size:14px;white-space:pre-wrap;">${esc(message)}</div>
</div>`.trim();

  const text = [
    subject,
    `${label} · raised from the ${clientName} dashboard`,
    '',
    `From         : ${fromName}`,
    `Signed in as : ${fromEmail}`,
    `Category     : ${label}`,
    '',
    message,
  ].join('\n');

  try {
    const { error } = await resend.emails.send({
      from: `The Joseph Center Dashboard <${from}>`,
      to,
      replyTo: auth.email,
      subject: `[Support] ${subject}`,
      html,
      text,
    });
    if (error) {
      console.error('receive-support-request: Resend rejected the send:', error);
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not send your request. Please try again.' }) };
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('receive-support-request:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not send your request' }) };
  }
}
