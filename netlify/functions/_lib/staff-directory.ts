import { createClient } from '@libsql/client/web';

// Shared by the reconciliation job and the one-off sync script, so the matching
// rules exist once. Getting a link wrong hands someone edit rights over a
// colleague's record, which is not a thing to reimplement twice.

export interface OktaUser {
  id: string;
  status: string;
  profile: { firstName?: string; lastName?: string; email?: string; login?: string };
}
export interface Card {
  _id: string;
  name?: string;
  title?: string;
  email?: string;
  hidden?: boolean;
}

export const oktaLogin = (u: OktaUser) => (u.profile.login || u.profile.email || '').toLowerCase();

/**
 * Okta statuses that mean "this person has left".
 *
 * PROVISIONED and STAGED are deliberately absent: those are pending onboarding,
 * not offboarding. Treating a new hire who has not activated their account yet
 * as a departure would unpublish someone on their first day.
 */
export const DEPARTED_STATUSES = new Set(['DEPROVISIONED', 'SUSPENDED']);

/**
 * Every user, including the departed ones.
 *
 * /api/v1/users WITHOUT a filter silently omits DEPROVISIONED accounts — this
 * org has two that the plain call never returns. Since departure is precisely
 * what this job exists to detect, the filter is not optional: without it a
 * deactivated person is invisible rather than reported, and only gets caught
 * incidentally by the "no longer present in Okta" fallback, with a misleading
 * reason attached.
 */
const ALL_STATUSES = [
  'ACTIVE', 'DEPROVISIONED', 'SUSPENDED', 'PROVISIONED',
  'STAGED', 'LOCKED_OUT', 'RECOVERY', 'PASSWORD_EXPIRED',
];

export async function fetchOktaUsers(org: string, token: string): Promise<OktaUser[]> {
  const filter = ALL_STATUSES.map((s) => `status eq "${s}"`).join(' or ');
  const url = `${org.replace(/\/$/, '')}/api/v1/users?limit=200&filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, {
    headers: { Authorization: `SSWS ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Okta users: ${res.status}`);
  return res.json();
}

/**
 * Logins in Okta's "Service Accounts" group — shared inboxes, not people.
 *
 * They belong to the Staff group (they need mail and app access) so they cannot
 * be filtered by that, and they would otherwise appear in every report as staff
 * missing a website card. Reading the group rather than hardcoding a list means
 * the answer stays correct as the directory changes.
 */
export async function fetchServiceAccountLogins(org: string, token: string): Promise<Set<string>> {
  const base = org.replace(/\/$/, '');
  const headers = { Authorization: `SSWS ${token}`, Accept: 'application/json' };
  try {
    const groups = await (await fetch(`${base}/api/v1/groups?q=Service%20Accounts`, { headers })).json();
    const group = (groups as { id: string; profile: { name: string } }[])
      .find((g) => g.profile.name.trim().toLowerCase() === 'service accounts');
    if (!group) return new Set();
    const members = await (await fetch(`${base}/api/v1/groups/${group.id}/users?limit=200`, { headers })).json();
    return new Set((members as OktaUser[]).map(oktaLogin));
  } catch {
    // Not worth failing the whole run over — the list just stays noisier.
    return new Set();
  }
}

export async function fetchStaffCards(project: string, dataset: string, token: string): Promise<Card[]> {
  const q = '*[_type=="staff" && !(_id in path("drafts.**"))]|order(name asc){_id,name,title,email,hidden}';
  const url = `https://${project}.api.sanity.io/v2024-06-20/data/query/${dataset}?query=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sanity query: ${res.status}`);
  return (await res.json()).result;
}

export interface Match { card: Card; user?: OktaUser; via?: 'email' | 'first-name' }

/**
 * Tiered, and refuses to guess.
 *
 *  email       the card's public address identifies exactly one Okta account
 *              AND appears on exactly one card. Shared addresses prove nothing:
 *              kisaacs@ sits on both Mona's and Khira's cards because Mona's
 *              public contact routes to her assistant.
 *  first-name  the card's name matches exactly one Okta first name. This is
 *              what correctly separates those two.
 */
export function matchAll(cards: Card[], users: OktaUser[]): Match[] {
  const byEmail = new Map<string, OktaUser[]>();
  const byFirst = new Map<string, OktaUser[]>();
  for (const u of users) {
    const e = (u.profile.email || '').toLowerCase().trim();
    if (e) byEmail.set(e, [...(byEmail.get(e) ?? []), u]);
    const f = (u.profile.firstName || '').toLowerCase().trim();
    if (f) byFirst.set(f, [...(byFirst.get(f) ?? []), u]);
  }
  const cardsPerEmail = new Map<string, number>();
  for (const c of cards) {
    const e = (c.email || '').toLowerCase().trim();
    if (e) cardsPerEmail.set(e, (cardsPerEmail.get(e) ?? 0) + 1);
  }
  return cards.map((card) => {
    const e = (card.email || '').toLowerCase().trim();
    if (e && byEmail.get(e)?.length === 1 && cardsPerEmail.get(e) === 1) {
      return { card, user: byEmail.get(e)![0], via: 'email' as const };
    }
    const f = (card.name || '').toLowerCase().trim();
    if (f && byFirst.get(f)?.length === 1) {
      return { card, user: byFirst.get(f)![0], via: 'first-name' as const };
    }
    return { card };
  });
}

export function turso() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
}

export async function ensureIdentityTable(db: ReturnType<typeof turso>) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS staff_identity (
      sanity_staff_id TEXT PRIMARY KEY,
      okta_login      TEXT NOT NULL,
      okta_user_id    TEXT NOT NULL,
      matched_by      TEXT NOT NULL,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS staff_identity_okta_login_idx ON staff_identity(okta_login);
  `);
}

/** Sets hidden on a staff document. Only ever called with true. */
export async function unpublishCard(project: string, dataset: string, token: string, staffId: string) {
  const res = await fetch(`https://${project}.api.sanity.io/v2024-06-20/data/mutate/${dataset}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutations: [{ patch: { id: staffId, set: { hidden: true } } }] }),
  });
  if (!res.ok) throw new Error(`Sanity mutate: ${res.status} ${await res.text()}`);
}
