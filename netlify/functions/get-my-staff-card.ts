import { verifyRequest, denial } from './_lib/verify-okta';
import { staffIdForLogin, fetchCard } from './_lib/staff-card';

// Returns the signed-in user's own staff card.
//
// The identity comes from the verified token, never from the request body —
// a caller cannot ask for somebody else's card because they never get to name
// one.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function handler(event: { headers: Record<string, string> }) {
  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);

  if (!auth.email) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Token carries no email claim' }) };
  }

  try {
    const staffId = await staffIdForLogin(auth.email);
    if (!staffId) {
      // Legitimate: some staff have no card, and some cards have no Okta
      // account. The UI explains rather than erroring.
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ linked: false, card: null }),
      };
    }
    const card = await fetchCard(staffId);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ linked: !!card, card, canEditDetails: auth.isAdmin }),
    };
  } catch (err) {
    console.error('get-my-staff-card:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load your staff card' }) };
  }
}
