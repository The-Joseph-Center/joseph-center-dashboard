import { Resend } from 'resend';
import { verifyRequest, denial } from './_lib/verify-okta';
import { staffIdForLogin, fetchCard } from './_lib/staff-card';
import { quoteRequestEmail } from './_lib/quote-request-email';

// A quote is a REQUEST, not a save.
//
// Nothing is written to Sanity here. The submission is emailed for review and
// applied by hand, which keeps a human between the third-party quote APIs and a
// public page — ZenQuotes does no content filtering, so nothing sourced from it
// should reach the site unreviewed. The UI says so plainly; a staff member who
// thinks they published something and finds it absent a week later is a worse
// outcome than one who knows it is pending.

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_QUOTE = 400;

const resend = new Resend(process.env.RESEND_API_KEY);

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
  if (!auth.email) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Token carries no email claim' }) };
  }

  let proposed = '';
  try {
    proposed = String(JSON.parse(event.body || '{}').quote ?? '').trim().slice(0, MAX_QUOTE);
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  try {
    // Identity comes from the token, so a request cannot be made on someone
    // else's behalf.
    const staffId = await staffIdForLogin(auth.email);
    if (!staffId) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'No staff card is linked to your account' }) };
    }
    const card = await fetchCard(staffId);
    if (!card) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Your staff card could not be found' }) };
    }
    if ((card.quote ?? '').trim() === proposed) {
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ submitted: false, reason: 'unchanged' }) };
    }

    const rendered = quoteRequestEmail({
      staffName: card.name || auth.email,
      staffTitle: card.title,
      requesterEmail: auth.email,
      currentQuote: card.quote,
      proposedQuote: proposed,
      staffId,
    });

    const to = process.env.QUOTE_REVIEW_TO_EMAIL || 'ephifer@josephcentergj.com';
    const from = process.env.QUOTE_REVIEW_FROM_EMAIL || 'no-reply@josephcentergj.com';

    const { error } = await resend.emails.send({
      from: `The Joseph Center <${from}>`,
      to,
      replyTo: auth.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (error) {
      console.error('request-quote-change: Resend rejected the send:', error);
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not send your request. Please try again.' }) };
    }

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ submitted: true }) };
  } catch (err) {
    console.error('request-quote-change:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not submit your request' }) };
  }
}
