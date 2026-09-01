import { oktaAuth } from '@/lib/okta';

/**
 * fetch() for our own Netlify Functions, with the Okta token attached.
 *
 * Every Function now verifies the token server-side, so a call without this
 * wrapper gets a 401. Going through one helper means a new call site cannot
 * quietly forget the header — the failure would look like a broken endpoint
 * rather than a missing credential, which is a miserable thing to debug.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = oktaAuth.getIdToken();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(input, { ...init, headers });

  // Vite's dev server answers unknown paths with index.html and a 200, so a
  // Function call under `npm run dev:vite` looks successful and then explodes
  // on res.json(). Name that failure instead of letting it surface as a vague
  // "could not load" — run `npm run dev` (netlify dev) to serve the Functions.
  //
  // The test is for HTML specifically, not for "anything that is not JSON".
  // The CSV exports — the donor list and the submissions/letter-queue download
  // — legitimately answer text/csv, and treating those as a missing dev server
  // meant every export threw here and surfaced as "Could not export".
  if (input.startsWith('/.netlify/functions/')) {
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('text/html')) {
      throw new Error(
        'Netlify Functions are not running — start the dashboard with `npm run dev` (netlify dev), not plain vite.'
      );
    }
  }

  // An expired session mid-visit should send the user back to sign in rather
  // than surface as an unexplained failure inside a widget.
  if (res.status === 401 && !(await oktaAuth.isAuthenticated())) {
    sessionStorage.setItem('postLoginUri', window.location.pathname + window.location.search);
    window.location.assign('/login');
  }

  return res;
}
