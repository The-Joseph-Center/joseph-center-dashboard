/**
 * Rebuilds the Okta account -> Sanity staff card mapping.
 *
 * Matching is tiered, most trustworthy first:
 *
 *   1. email      the card's public email identifies exactly one Okta account
 *                 AND appears on exactly one card. Rejecting shared addresses
 *                 is the whole point — kisaacs@ is on both Mona's and Khira's
 *                 cards, so it proves nothing about who owns which.
 *   2. first-name the card's name matches exactly one Okta first name. This is
 *                 what correctly resolves Mona to mhighline@ and Khira to
 *                 kisaacs@, which tier 1 cannot.
 *
 * Anything ambiguous is left unmatched and reported rather than guessed at. A
 * wrong link here hands someone edit rights over a colleague's record.
 *
 * The matching rules live in netlify/functions/_lib/staff-directory.ts, shared
 * with the daily reconcile-staff job — getting a link wrong hands someone edit
 * rights over a colleague's record, so it is not implemented twice.
 *
 * Day to day the scheduled job keeps this current; this script exists for
 * running it on demand.
 *
 * Dry run by default:
 *   npx tsx scripts/sync-staff-identity.ts
 *   APPLY=yes npx tsx scripts/sync-staff-identity.ts
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const APPLY = process.env.APPLY === 'yes';

for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  if (line.includes('=') && !line.trim().startsWith('#')) {
    const i = line.indexOf('=');
    process.env[line.slice(0, i)] ??= line.slice(i + 1);
  }
}

const OKTA_ORG = (process.env.OKTA_ISSUER || '').replace(/\/$/, '');
const OKTA_TOKEN = process.env.OKTA_API_TOKEN!;
const SANITY_PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const SANITY_DATASET = process.env.VITE_SANITY_DATASET || 'staging';

interface OktaUser {
  id: string;
  status: string;
  profile: { firstName?: string; lastName?: string; email?: string; login?: string };
}
interface Card {
  _id: string;
  name?: string;
  title?: string;
  email?: string;
}

async function oktaUsers(): Promise<OktaUser[]> {
  // Same caveat as the scheduled job: an unfiltered list omits DEPROVISIONED.
  const statuses = ['ACTIVE','DEPROVISIONED','SUSPENDED','PROVISIONED','STAGED','LOCKED_OUT','RECOVERY','PASSWORD_EXPIRED'];
  const filter = encodeURIComponent(statuses.map((s) => `status eq "${s}"`).join(' or '));
  const res = await fetch(`${OKTA_ORG}/api/v1/users?limit=200&filter=${filter}`, {
    headers: { Authorization: `SSWS ${OKTA_TOKEN}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Okta users: ${res.status}`);
  return res.json();
}

async function staffCards(): Promise<Card[]> {
  const q = '*[_type=="staff" && !(_id in path("drafts.**"))]|order(name asc){_id,name,title,email}';
  const url = `https://${SANITY_PROJECT}.apicdn.sanity.io/v2024-01-01/data/query/${SANITY_DATASET}?query=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sanity: ${res.status}`);
  return (await res.json()).result;
}

const login = (u: OktaUser) => (u.profile.login || u.profile.email || '').toLowerCase();

export interface Match {
  card: Card;
  user?: OktaUser;
  via?: 'email' | 'first-name';
}

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

async function run() {
  const [users, cards] = await Promise.all([oktaUsers(), staffCards()]);
  const matches = matchAll(cards, users);

  // Refuse to write anything if two cards resolved to one account.
  const claimed = new Map<string, string[]>();
  for (const m of matches) {
    if (!m.user) continue;
    const l = login(m.user);
    claimed.set(l, [...(claimed.get(l) ?? []), m.card.name ?? m.card._id]);
  }
  const collisions = [...claimed].filter(([, v]) => v.length > 1);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${cards.length} cards, ${users.length} Okta accounts\n`);
  for (const m of matches) {
    const nm = (m.card.name ?? '?').padEnd(11);
    if (m.user) console.log(`  ${nm}${(m.via ?? '').padEnd(12)}${login(m.user).padEnd(32)}${m.user.status}`);
    else console.log(`  ${nm}${'— unmatched —'}`);
  }
  const linked = matches.filter((m) => m.user);
  console.log(`\n  linked ${linked.length}/${cards.length}; unmatched ${cards.length - linked.length}`);

  if (collisions.length) {
    console.error('\n  REFUSING TO WRITE — one Okta account claimed by several cards:');
    for (const [l, v] of collisions) console.error(`    ${l} <- ${v.join(', ')}`);
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\n  Re-run with APPLY=yes to write these links.');
    return;
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  await db.executeMultiple(fs.readFileSync('db/migrations/001_staff_identity.sql', 'utf8'));
  for (const m of linked) {
    await db.execute({
      sql: `INSERT INTO staff_identity (sanity_staff_id, okta_login, okta_user_id, matched_by, updated_at)
            VALUES (?, ?, ?, ?, unixepoch())
            ON CONFLICT(sanity_staff_id) DO UPDATE SET
              okta_login = excluded.okta_login,
              okta_user_id = excluded.okta_user_id,
              matched_by = excluded.matched_by,
              updated_at = excluded.updated_at`,
      args: [m.card._id, login(m.user!), m.user!.id, m.via!],
    });
  }
  const n = await db.execute('SELECT COUNT(*) c FROM staff_identity');
  console.log(`\n  staff_identity now holds ${n.rows[0].c} link(s).`);
}

run().catch((err) => { console.error(err); process.exit(1); });
