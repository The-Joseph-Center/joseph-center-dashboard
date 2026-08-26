import { OktaAuth } from '@okta/okta-auth-js';

// Okta OIDC against The Joseph Center's own directory, so staff sign in with
// the account they already have and access is governed by Okta app assignment
// — offboarding someone in Okta removes their dashboard access with no action
// here.
//
// The tenant has no API Access Management, so there is no custom authorization
// server: the issuer is the org itself, and the ID token's `aud` is the client
// id. Group membership arrives as the `groups` claim, filtered in Okta to names
// starting with `jc-dashboard-`.

export const OKTA_ISSUER = import.meta.env.VITE_OKTA_ISSUER as string;
export const OKTA_CLIENT_ID = import.meta.env.VITE_OKTA_CLIENT_ID as string;

/** Group that unlocks admin-only areas. Must match the server-side check. */
export const ADMIN_GROUP =
  (import.meta.env.VITE_OKTA_ADMIN_GROUP as string) || 'jc-dashboard-admins';

export const oktaAuth = new OktaAuth({
  issuer: OKTA_ISSUER,
  clientId: OKTA_CLIENT_ID,
  // Must match the redirect URIs registered on the Okta app exactly.
  redirectUri: `${window.location.origin}/login/callback`,
  postLogoutRedirectUri: window.location.origin,
  // `groups` is a real scope on this tenant; without requesting it the claim is
  // not emitted even though the filter is configured.
  scopes: ['openid', 'profile', 'email', 'groups'],
  pkce: true,
  // Return the user to the page they originally asked for.
  restoreOriginalUri: async (_oktaAuth, originalUri) => {
    window.location.replace(originalUri || window.location.origin);
  },
});

/** Groups from the ID token, or [] when the claim is absent. */
export function groupsFromClaims(claims: Record<string, unknown> | undefined): string[] {
  const raw = claims?.groups;
  return Array.isArray(raw) ? raw.filter((g): g is string => typeof g === 'string') : [];
}

export function isAdminFromClaims(claims: Record<string, unknown> | undefined): boolean {
  return groupsFromClaims(claims).includes(ADMIN_GROUP);
}

/**
 * Bearer token for calls to our own Netlify Functions.
 *
 * Deliberately the ID token, not the access token. Without a custom
 * authorization server Okta cannot put group claims in an access token, so the
 * ID token is the only credential that carries authorisation information. The
 * functions verify it properly — signature, issuer, audience, expiry — so this
 * is a narrower compromise than it looks: both sides are first party, and the
 * alternative is the current state of trusting any string.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const token = oktaAuth.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
