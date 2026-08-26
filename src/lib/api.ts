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

  // An expired session mid-visit should send the user back to sign in rather
  // than surface as an unexplained failure inside a widget.
  if (res.status === 401 && !(await oktaAuth.isAuthenticated())) {
    sessionStorage.setItem('postLoginUri', window.location.pathname + window.location.search);
    window.location.assign('/login');
  }

  return res;
}
