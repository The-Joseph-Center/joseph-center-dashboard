import { Resend } from 'resend';
import { verifyRequest, denial } from './_lib/verify-okta';
import {
  CAPABILITY_LABELS, RULES, hasCapability, type Capability,
} from '../../src/lib/capabilities';
import { JSON_HEADERS } from './_lib/http';

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

const MAX = { subject: 200, message: 4000, category: 40 };

const resend = new Resend(process.env.RESEND_API_KEY);

const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CATEGORY_LABELS: Record<string, string> = {
  question: 'Question',
  bug: 'Something is broken',
  // The page's own wording. These two were missing, so a change request
  // arrived labelled with the bare word "update" and an access request would
  // have done the same.
  update: 'Change request',
  access: 'Access request',
  change: 'Change request',
  billing: 'Billing',
  other: 'Other',
};

const CAPABILITIES = Object.keys(CAPABILITY_LABELS) as Capability[];

/**
 * An access request, worked out server-side.
 *
 * The form sends which features were ticked and nothing else that matters. WHO
 * is asking, and what they can already reach, both come from the verified
 * token — so the email cannot be made to misreport someone's current access by
 * editing a request on the way out.
 *
 * Each entry carries the groups that would grant it, read from the same RULES
 * table the dashboard enforces. That is the whole point of the feature: the
 * request arrives with its own answer attached, so granting it is a known
 * change in Okta rather than a reading of the source.
 */
function describeRequest(requested: unknown, groups: string[]) {
  const asked = Array.isArray(requested)
    ? [...new Set(requested.filter((v): v is Capability => CAPABILITIES.includes(v as Capability)))]
    : [];
  return asked.map((c) => {
    const rule = RULES[c];
    return {
      capability: c,
      label: CAPABILITY_LABELS[c],
      // Already held: worth saying rather than silently dropping. It usually
      // means the person could not find the page, which is a different problem
      // from not being allowed to open it.
      alreadyHas: hasCapability(groups, c),
      grantedBy: rule === '*' ? ['everyone already'] : rule,
    };
  });
}

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

  const wanted = category === 'access' ? describeRequest(body.requested, auth.groups) : [];

  if (category === 'access') {
    // The ticked features ARE the request. Insisting on prose as well would
    // turn "I need the banner tool" into a writing task, which is how a form
    // stops being used — but something has to have been asked for.
    if (!wanted.length) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Choose at least one feature you need access to.' }) };
    }
  } else if (!subject || !message) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A subject and a message are required.' }) };
  }

  // From the token, not the form.
  const fromEmail = auth.email ?? 'unknown';
  const fromName = clean(body.name, 120) || fromEmail;
  const clientName = clean(body.clientName, 120) || 'Dashboard';

  // An access request can arrive without a subject, because the grid said it.
  const titled = subject || (wanted.length
    ? `Access to ${wanted.map((w) => w.label).join(', ')}`
    : 'Support request');

  const to = process.env.SUPPORT_TO_EMAIL || process.env.QUOTE_REVIEW_TO_EMAIL || 'ephifer@josephcentergj.com';
  const from = process.env.QUOTE_REVIEW_FROM_EMAIL || 'no-reply@josephcentergj.com';
  const label = CATEGORY_LABELS[category] ?? category;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#262626;max-width:620px;">
  <h2 style="font-size:17px;margin:0 0 4px;">${esc(titled)}</h2>
  <p style="margin:0 0 18px;color:#5C5C5C;font-size:14px;">${esc(label)} · raised from the ${esc(clientName)} dashboard</p>
  <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;">
    <tr><td style="padding:6px 0;color:#5C5C5C;width:120px;">From</td><td style="padding:6px 0;"><strong>${esc(fromName)}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#5C5C5C;">Signed in as</td><td style="padding:6px 0;">${esc(fromEmail)}</td></tr>
    <tr><td style="padding:6px 0;color:#5C5C5C;">Category</td><td style="padding:6px 0;">${esc(label)}</td></tr>
    ${auth.groups.length ? `<tr><td style="padding:6px 0;color:#5C5C5C;">In groups</td><td style="padding:6px 0;">${esc(auth.groups.join(', '))}</td></tr>` : ''}
  </table>
  ${wanted.length ? `
  <p style="margin:18px 0 6px;font-size:13px;color:#5C5C5C;">Asking for</p>
  <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;">
    ${wanted.map((w) => `
    <tr>
      <td style="padding:7px 10px 7px 0;border-top:1px solid #ececec;vertical-align:top;">
        <strong>${esc(w.label)}</strong>
        ${w.alreadyHas ? '<br><span style="font-size:12px;color:#8a5a1f;">They already have this &mdash; they may just not be finding the page.</span>' : ''}
      </td>
      <td style="padding:7px 0;border-top:1px solid #ececec;font-size:13px;color:#5C5C5C;vertical-align:top;">
        Granted by: ${esc(w.grantedBy.join(', '))}
      </td>
    </tr>`).join('')}
  </table>
  <p style="margin:10px 0 0;font-size:12px;color:#8a8a8a;">
    Add them to one of those groups in Okta, or widen the rule in capabilities.ts if the whole role should have it.
  </p>` : ''}
  ${message ? `
  <p style="margin:18px 0 6px;font-size:13px;color:#5C5C5C;">${wanted.length ? 'Why they need it' : 'Message'}</p>
  <div style="padding:12px 14px;background:#F7F5EE;border-left:3px solid #1D5F55;font-size:14px;white-space:pre-wrap;">${esc(message)}</div>` : ''}
</div>`.trim();

  const text = [
    titled,
    `${label} · raised from the ${clientName} dashboard`,
    '',
    `From         : ${fromName}`,
    `Signed in as : ${fromEmail}`,
    `Category     : ${label}`,
    ...(auth.groups.length ? [`In groups    : ${auth.groups.join(', ')}`] : []),
    '',
    ...(wanted.length
      ? [
          'ASKING FOR:',
          ...wanted.flatMap((w) => [
            `  ${w.label}${w.alreadyHas ? '  (they already have this)' : ''}`,
            `    granted by: ${w.grantedBy.join(', ')}`,
          ]),
          '',
        ]
      : []),
    ...(message ? [wanted.length ? 'WHY THEY NEED IT:' : 'MESSAGE:', message] : []),
  ].join('\n');

  try {
    const { error } = await resend.emails.send({
      from: `The Joseph Center Dashboard <${from}>`,
      to,
      replyTo: auth.email,
      subject: wanted.length ? `[Access] ${titled}` : `[Support] ${titled}`,
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
