import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
// The same table the SPA renders its nav from, so the menu and the API cannot
// disagree about who may do what.
import { hasCapability, isAdmin as groupsAreAdmin, type Capability } from '../../../src/lib/capabilities';

/**
 * Verifies the Okta token presented by the dashboard.
 *
 * Every Function in this directory was previously "protected" by checking that
 * an Authorization header existed — any string passed — and two checked nothing
 * at all. This replaces that with real verification: RS256 signature against
 * Okta's published keys, plus issuer, audience and expiry.
 *
 * We verify the ID token rather than an access token. That is a deliberate
 * consequence of the tenant, not a shortcut: without API Access Management
 * there is no custom authorization server, and Okta will only put group claims
 * in an ID token. Both the SPA and these Functions are first party, so the ID
 * token is the only credential that carries the authorisation signal we need.
 * If API Access Management is ever licensed, switching to access tokens is a
 * change to ISSUER/AUDIENCE here and nothing else.
 *
 * createRemoteJWKSet caches keys and re-fetches on rotation, so this does not
 * hit Okta on every request.
 */

const ISSUER = process.env.OKTA_ISSUER || '';
const AUDIENCE = process.env.OKTA_CLIENT_ID || '';
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keyStore() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${ISSUER}/oauth2/v1/keys`));
  return jwks;
}

export interface AuthResult {
  ok: boolean;
  status: number;
  error?: string;
  claims?: JWTPayload;
  groups: string[];
  isAdmin: boolean;
  email?: string;
}

const DENY = (status: number, error: string): AuthResult => ({
  ok: false, status, error, groups: [], isAdmin: false,
});

function bearer(headers: Record<string, string | undefined>): string | null {
  const raw = headers['authorization'] || headers['Authorization'];
  if (!raw) return null;
  const [scheme, token] = raw.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}

export async function verifyRequest(
  headers: Record<string, string | undefined>
): Promise<AuthResult> {
  // Misconfiguration must fail closed. An empty issuer would otherwise make
  // every token "valid" against a JWKS URL of "/oauth2/v1/keys".
  if (!ISSUER || !AUDIENCE) {
    console.error('verify-okta: OKTA_ISSUER or OKTA_CLIENT_ID is not configured');
    return DENY(500, 'Auth is not configured');
  }

  const token = bearer(headers);
  if (!token) return DENY(401, 'Missing bearer token');

  try {
    const { payload } = await jwtVerify(token, keyStore(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const raw = (payload as Record<string, unknown>).groups;
    const groups = Array.isArray(raw) ? raw.filter((g): g is string => typeof g === 'string') : [];

    return {
      ok: true,
      status: 200,
      claims: payload,
      groups,
      isAdmin: groupsAreAdmin(groups),
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  } catch (err) {
    // Covers a bad signature, wrong issuer or audience, and expiry alike —
    // the caller learns only that it was rejected.
    console.warn('verify-okta: token rejected:', err instanceof Error ? err.message : err);
    return DENY(401, 'Invalid or expired token');
  }
}

/**
 * Verify, and additionally require a capability.
 *
 * This is the enforcement half of the feature map. The SPA hides what a user
 * cannot do; this is what makes hiding it mean something, because a hidden nav
 * item in front of an endpoint that still answers is decoration.
 */
export async function requireCapability(
  headers: Record<string, string | undefined>,
  capability: Capability
): Promise<AuthResult> {
  const result = await verifyRequest(headers);
  if (!result.ok) return result;
  if (!hasCapability(result.groups, capability)) {
    return { ...result, ok: false, status: 403, error: 'Your account does not have access to this' };
  }
  return result;
}

/** Convenience for the admin-only case. */
export async function requireAdmin(
  headers: Record<string, string | undefined>
): Promise<AuthResult> {
  return requireCapability(headers, 'billing');
}

export function denial(result: AuthResult, cors: Record<string, string> = {}) {
  return {
    statusCode: result.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: result.error ?? 'Unauthorized' }),
  };
}
