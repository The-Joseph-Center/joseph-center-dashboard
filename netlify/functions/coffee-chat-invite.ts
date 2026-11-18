import { Resend } from 'resend';
import { requireCapability, denial } from './_lib/verify-okta';
import { staffIdForLogin, fetchCard } from './_lib/staff-card';
import { coffeeChatInviteEmail } from './_lib/coffee-chat-invite-email';
import { turso } from './_lib/staff-directory';

/**
 * Invites one person to apply as a Coffee Chat guest.
 *
 * Preview and send run through the SAME render. `mode: 'preview'` renders and
 * returns; `mode: 'send'` renders and hands that exact HTML to Resend. There is
 * no second code path and no client-side templating, so what the dashboard
 * shows cannot drift from what the guest receives — which is the entire reason
 * the preview exists. A preview built in the browser from its own copy of the
 * copy would be a different email that merely looked the same.
 *
 * The signature and the reply-to come from the signed-in staff member, not from
 * a shared address: an invitation is a personal note, and a guest's reply
 * should reach the person who sent it.
 *
 * GET returns the invitations sent so far. A successful send records one, but
 * the record is written AFTER the email and its failure is logged rather than
 * raised: the invitation has already arrived by then, and reporting "could not
 * send" over a bookkeeping error would be a lie that invites a second send to
 * the same person. The same ordering as submit-dynamic-form, for the same
 * reason.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const resend = new Resend(process.env.RESEND_API_KEY);

const MAX_NAME = 120;
const LIST_LIMIT = 100;

/** Deliberately permissive — this rejects typos, not unusual addresses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const APPLY_URL =
  process.env.COFFEE_CHAT_APPLY_URL || 'https://josephcentergj.com/media/apply';

function bad(message: string) {
  return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}) {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await requireCapability(event.headers, 'coffeeChatInvite');
  if (!auth.ok) return denial(auth);

  if (event.httpMethod === 'GET') {
    try {
      const db = turso();
      const result = await db.execute(
        `SELECT id, name, email, sent_by, sent_at
           FROM coffee_chat_invites
          ORDER BY sent_at DESC
          LIMIT ${LIST_LIMIT}`,
      );
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          invites: result.rows.map((r) => ({
            id: String(r.id),
            name: String(r.name),
            email: String(r.email),
            sentBy: String(r.sent_by),
            sentAt: Number(r.sent_at),
          })),
        }),
      };
    } catch (err) {
      // A missing table is the likely cause before migration 021 is applied.
      // The invite tool still works without its history, so say so and carry on
      // rather than taking the page down.
      console.error('coffee-chat-invite: could not read the history:', err);
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ invites: [], unavailable: true }),
      };
    }
  }

  // The signature needs a person. Without a verified email there is nobody to
  // sign as and nowhere to send a reply.
  if (!auth.email) {
    return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Your sign-in carries no email address.' }) };
  }

  let body: { name?: unknown; email?: unknown; mode?: unknown };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return bad('Could not read the request.');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const to = typeof body.email === 'string' ? body.email.trim() : '';
  const mode = body.mode === 'send' ? 'send' : 'preview';

  if (!name) return bad('Add the name you would like the email to greet.');
  if (name.length > MAX_NAME) return bad(`That name is longer than ${MAX_NAME} characters.`);

  // A preview is useful before the address is known — you are checking the
  // wording. Only a send needs somewhere to go.
  if (mode === 'send') {
    if (!to) return bad('Add the email address to send to.');
    if (!EMAIL_RE.test(to)) return bad('That email address does not look right.');
  }

  try {
    const staffId = await staffIdForLogin(auth.email);
    const card = staffId ? await fetchCard(staffId) : null;

    const rendered = coffeeChatInviteEmail({
      name,
      applyUrl: APPLY_URL,
      // Falling back to the login address is ugly in a signature but honest —
      // better than signing a guest's invitation "The Joseph Center" when a
      // named person wrote it. Staff without a card should make one.
      senderName: card?.name || auth.email,
      senderTitle: card?.title ?? null,
    });

    if (mode === 'preview') {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          applyUrl: APPLY_URL,
          senderName: card?.name || auth.email,
          senderTitle: card?.title ?? null,
          unlinked: !card,
        }),
      };
    }

    const from = process.env.COFFEE_CHAT_FROM_EMAIL
      || process.env.CONTACT_FROM_EMAIL
      || 'no-reply@josephcentergj.com';

    const { error } = await resend.emails.send({
      from: `The Joseph Center <${from}>`,
      to: [to],
      replyTo: auth.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (error) {
      console.error('coffee-chat-invite: Resend rejected the send:', error);
      return {
        statusCode: 502,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'The email could not be sent. Nothing was delivered.' }),
      };
    }

    // Recorded after the fact, and never allowed to fail the send.
    let recorded = true;
    try {
      const db = turso();
      await db.execute({
        sql: 'INSERT INTO coffee_chat_invites (name, email, sent_by) VALUES (?, ?, ?)',
        args: [name, to.toLowerCase(), auth.email],
      });
    } catch (err) {
      recorded = false;
      console.error('coffee-chat-invite: sent, but could not record it:', err);
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ sent: true, to, subject: rendered.subject, recorded }),
    };
  } catch (err) {
    console.error('coffee-chat-invite:', err);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Something went wrong preparing the invitation.' }),
    };
  }
}
