import { verifyRequest, denial } from './_lib/verify-okta';
import { staffIdForLogin, patchCard } from './_lib/staff-card';

// Saves the signed-in user's favourite quote onto their own card.
//
// Scope is enforced by construction: the document id is resolved from the
// verified token, so the request cannot name a card. Title and department are
// deliberately NOT writable here — staff view those, admins change them.

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const MAX_QUOTE = 400;

export async function handler(event: { httpMethod: string; headers: Record<string, string>; body: string | null }) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);
  if (!auth.email) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Token carries no email claim' }) };
  }

  let quote = '';
  try {
    quote = String(JSON.parse(event.body || '{}').quote ?? '').trim().slice(0, MAX_QUOTE);
  } catch {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  try {
    const staffId = await staffIdForLogin(auth.email);
    if (!staffId) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'No staff card is linked to your account' }) };
    }
    // Only ever `quote`, and only ever on the caller's own document.
    await patchCard(staffId, { quote });
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, quote }) };
  } catch (err) {
    console.error('update-my-quote:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not save your quote' }) };
  }
}
