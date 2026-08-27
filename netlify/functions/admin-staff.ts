import { requireCapability, denial } from './_lib/verify-okta';
import {
  fetchOktaUsers, fetchServiceAccountLogins, fetchNoCard, ensureNoCardTable,
  ensureIdentityTable, oktaLogin, DEPARTED_STATUSES, turso, type OktaUser,
} from './_lib/staff-directory';

/**
 * Staff administration — read the roster, edit public details, create a card.
 *
 * Okta is NOT the source of truth for what appears on the website. `department`
 * is absent from this org's Okta profile schema entirely and `title` is set on
 * 2 of 32 users, but more fundamentally the public title is copy written to read
 * on a card, not an HR record — binding them makes every wording tweak a
 * directory edit. Okta owns identity, access and employment status; Sanity owns
 * the public-facing copy and the photo, which Okta cannot store at all.
 *
 * Creating a card pre-fills name and email from Okta so onboarding is a click
 * plus a photo, without a directory change ever silently rewriting public copy.
 *
 * Not every Okta account is a person. "Not a staff card" records that decision
 * so the account stops being reported as outstanding work — see the note on
 * staff_no_card in _lib/staff-directory.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const DATASET = process.env.VITE_SANITY_DATASET || 'staging';
const SANITY = process.env.SANITY_WRITE_TOKEN!;

const DEPARTMENTS = [
  'day-shelter', 'family-center', 'golden-girls', 'ifs', 'it-marketing',
  'kitchen', 'maintenance', 'security', 'operations', 'unknown',
];

/** Why an account will never have a card. Free text lives in `note`. */
const REASONS: Record<string, string> = {
  'shared-inbox': 'Shared inbox or device',
  duplicate: 'Duplicate account',
  'not-staff': 'Not staff',
  other: 'Other',
};

/**
 * Accounts that look like the same person twice.
 *
 * Matched on recovery email or mobile number **and** a shared last name, not on
 * name alone: Okta holds legal names, and the duplicate worth catching is
 * exactly the one where the given names differ — a "Trisha" account from April
 * and a "Patricia" account from August are one person if they share a recovery
 * address, and comparing names would never say so.
 *
 * The last-name condition is what makes the hint trustworthy. A recovery email
 * on its own is a false positive generator here: the admin's own address is the
 * recovery address on scanner@, itadmin@ and jc@, which pairs him with three
 * accounts that are not him. Requiring the surname to match as well costs a
 * missed duplicate across a name change and buys a hint that is worth reading.
 *
 * Reported, never acted on: merging or deactivating is a decision for the
 * directory, not a side effect of tidying this page.
 */
export function duplicateHints(users: OktaUser[]): Map<string, string[]> {
  const norm = (v?: string) => (v || '').toLowerCase().replace(/[^a-z0-9@.]/g, '').trim();
  const surname = (u: OktaUser) => norm(u.profile.lastName);
  const who = (u: OktaUser) =>
    `${[u.profile.firstName, u.profile.lastName].filter(Boolean).join(' ') || oktaLogin(u)} (${oktaLogin(u)}, ${u.status})`;

  const hints = new Map<string, string[]>();
  const add = (u: OktaUser, text: string) =>
    hints.set(oktaLogin(u), [...(hints.get(oktaLogin(u)) ?? []), text]);

  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const [a, b] = [users[i], users[j]];
      if (!surname(a) || surname(a) !== surname(b)) continue;
      const shared =
        (norm(a.profile.secondEmail) && norm(a.profile.secondEmail) === norm(b.profile.secondEmail) && 'the same recovery email') ||
        (norm(a.profile.mobilePhone) && norm(a.profile.mobilePhone) === norm(b.profile.mobilePhone) && 'the same mobile number');
      if (!shared) continue;
      add(a, `same last name and ${shared} as ${who(b)}`);
      add(b, `same last name and ${shared} as ${who(a)}`);
    }
  }
  return hints;
}

const clean = (v: unknown, max = 200) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

async function sanityQuery<T>(query: string): Promise<T> {
  const url = `https://${PROJECT}.api.sanity.io/v2024-06-20/data/query/${DATASET}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SANITY}` } });
  if (!res.ok) throw new Error(`Sanity query: ${res.status}`);
  return (await res.json()).result;
}

async function sanityMutate(mutations: unknown[]) {
  // returnIds is required for the response to carry the created document's id —
  // without it `results` comes back empty and a caller cannot follow up on what
  // it just made.
  const res = await fetch(`https://${PROJECT}.api.sanity.io/v2024-06-20/data/mutate/${DATASET}?returnIds=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SANITY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutations }),
  });
  if (!res.ok) throw new Error(`Sanity mutate: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Uploads a base64 image and returns the asset id. */
async function uploadImage(base64: string, filename: string): Promise<string> {
  const comma = base64.indexOf(',');
  const meta = comma > -1 ? base64.slice(0, comma) : '';
  const data = comma > -1 ? base64.slice(comma + 1) : base64;
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error('Unsupported image type');

  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Image is larger than 8MB');

  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/assets/images/${DATASET}?filename=${encodeURIComponent(filename || 'staff-photo')}`,
    { method: 'POST', headers: { Authorization: `Bearer ${SANITY}`, 'Content-Type': mime }, body: bytes }
  );
  if (!res.ok) throw new Error(`Asset upload: ${res.status} ${await res.text()}`);
  return (await res.json()).document._id;
}

interface Card {
  _id: string; name?: string; title?: string; email?: string;
  departments?: string[]; hidden?: boolean; imageUrl?: string | null;
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'staffAdmin');
  if (!auth.ok) return denial(auth);

  try {
    // ── Read the roster ──
    if (event.httpMethod === 'GET') {
      const cards = await sanityQuery<Card[]>(
        `*[_type=="staff" && !(_id in path("drafts.**"))]|order(name asc){
          _id,name,title,email,departments,hidden,"imageUrl":image.asset->url
        }`
      );
      const linked = new Map<string, string>(
        (await turso().execute('SELECT okta_login, sanity_staff_id FROM staff_identity')).rows.map(
          (r) => [String(r.okta_login), String(r.sanity_staff_id)]
        )
      );
      const [users, serviceAccounts, dismissed] = await Promise.all([
        fetchOktaUsers(process.env.OKTA_ISSUER!, process.env.OKTA_API_TOKEN!),
        // Okta's own group for shared inboxes. Read rather than duplicated here
        // so adding scanner@ to it in the directory is enough on its own.
        fetchServiceAccountLogins(process.env.OKTA_ISSUER!, process.env.OKTA_API_TOKEN!),
        fetchNoCard(turso()),
      ]);
      const dismissedLogins = new Set(dismissed.map((d) => d.login));
      const hints = duplicateHints(
        users.filter((u) => !DEPARTED_STATUSES.has(u.status) && !serviceAccounts.has(oktaLogin(u)))
      );

      // People in the directory who have no card yet — the onboarding queue.
      const needsCard = users
        .filter((u) => !DEPARTED_STATUSES.has(u.status))
        .filter((u) => !linked.has(oktaLogin(u)))
        .filter((u) => !serviceAccounts.has(oktaLogin(u)) && !dismissedLogins.has(oktaLogin(u)))
        .map((u) => ({
          login: oktaLogin(u),
          firstName: u.profile.firstName ?? '',
          lastName: u.profile.lastName ?? '',
          title: u.profile.title ?? '',
          status: u.status,
          duplicateOf: hints.get(oktaLogin(u)) ?? [],
        }));

      // Names for the dismissed list, so it does not read as bare logins.
      const nameFor = new Map(users.map((u) => [
        oktaLogin(u),
        [u.profile.firstName, u.profile.lastName].filter(Boolean).join(' '),
      ]));

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          cards,
          needsCard,
          departments: DEPARTMENTS,
          reasons: REASONS,
          notStaff: dismissed.map((d) => ({ ...d, name: nameFor.get(d.login) ?? '' })),
          serviceAccounts: [...serviceAccounts].sort(),
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const action = clean(body.action, 20);

    // ── Mark an account as never needing a card, or put it back ──
    if (action === 'dismiss' || action === 'restore') {
      const login = clean(body.login, 200).toLowerCase();
      if (!login) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing login' }) };
      }
      const db = turso();
      await ensureNoCardTable(db);
      if (action === 'restore') {
        await db.execute({ sql: 'DELETE FROM staff_no_card WHERE okta_login = ?', args: [login] });
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ restored: true }) };
      }
      const reason = clean(body.reason, 40);
      if (!REASONS[reason]) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Unknown reason' }) };
      }
      await db.execute({
        sql: `INSERT INTO staff_no_card (okta_login, reason, note, dismissed_by, dismissed_at)
              VALUES (?, ?, ?, ?, unixepoch())
              ON CONFLICT(okta_login) DO UPDATE SET
                reason=excluded.reason, note=excluded.note,
                dismissed_by=excluded.dismissed_by, dismissed_at=excluded.dismissed_at`,
        args: [login, reason, clean(body.note, 300), auth.email ?? 'unknown'],
      });
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ dismissed: true }) };
    }

    const name = clean(body.name, 120);
    const title = clean(body.title, 200);
    const email = clean(body.email, 200);
    const departments = Array.isArray(body.departments)
      ? body.departments.filter((d: unknown) => typeof d === 'string' && DEPARTMENTS.includes(d))
      : [];

    // Photo is optional on both paths — it is the one thing Okta cannot supply.
    let imageAssetId: string | null = null;
    if (typeof body.imageBase64 === 'string' && body.imageBase64) {
      imageAssetId = await uploadImage(body.imageBase64, clean(body.imageFilename, 120));
    }

    const imageField = imageAssetId
      ? { image: { _type: 'image', asset: { _type: 'reference', _ref: imageAssetId } } }
      : {};

    if (action === 'create') {
      if (!name) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A name is required.' }) };
      }
      const login = clean(body.login, 200).toLowerCase();
      const db = turso();
      await ensureIdentityTable(db);

      // A second click must not make a second card. The queue row disappearing
      // depends on the link existing, so the link is written here rather than
      // waiting for the nightly reconciliation to notice the new document —
      // which is what left the row sitting there looking unclicked.
      if (login) {
        const already = await db.execute({
          sql: 'SELECT sanity_staff_id FROM staff_identity WHERE okta_login = ? LIMIT 1',
          args: [login],
        });
        if (already.rows[0]) {
          return {
            statusCode: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify({ created: false, id: String(already.rows[0].sanity_staff_id), alreadyLinked: true }),
          };
        }
      }

      const created = await sanityMutate([
        { create: { _type: 'staff', name, title, email, departments, hidden: false, ...imageField } },
      ]) as { results?: { id: string }[] };
      const newId = created.results?.[0]?.id ?? null;

      if (login && newId) {
        const user = (await fetchOktaUsers(process.env.OKTA_ISSUER!, process.env.OKTA_API_TOKEN!))
          .find((u) => oktaLogin(u) === login);
        if (user) {
          await db.execute({
            sql: `INSERT INTO staff_identity (sanity_staff_id, okta_login, okta_user_id, matched_by, updated_at)
                  VALUES (?, ?, ?, 'dashboard', unixepoch())
                  ON CONFLICT(sanity_staff_id) DO UPDATE SET
                    okta_login=excluded.okta_login, okta_user_id=excluded.okta_user_id,
                    matched_by='dashboard', updated_at=unixepoch()`,
            args: [newId, login, user.id],
          });
        }
      }
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ created: true, id: newId }) };
    }

    // ── Delete a card ──
    // For a card that should not exist — a duplicate, a mistake. Someone who has
    // left is hidden, not deleted: hiding is reversible and keeps the quote and
    // photo. The UI confirms before calling this; the link is dropped alongside
    // the document so the person returns to the onboarding queue rather than
    // pointing at an id that is gone.
    if (action === 'delete') {
      const id = clean(body._id, 120);
      if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing staff id' }) };
      }
      await sanityMutate([{ delete: { id } }]);
      const db = turso();
      await ensureIdentityTable(db);
      await db.execute({ sql: 'DELETE FROM staff_identity WHERE sanity_staff_id = ?', args: [id] });
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ deleted: true }) };
    }

    const id = clean(body._id, 120);
    if (!id) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Missing staff id' }) };
    }

    // `quote` is deliberately absent: staff own it, through the review flow.
    const set: Record<string, unknown> = { name, title, email, departments, ...imageField };
    if (typeof body.hidden === 'boolean') set.hidden = body.hidden;

    await sanityMutate([{ patch: { id, set } }]);
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: true }) };
  } catch (err) {
    console.error('admin-staff:', err);
    const message = err instanceof Error ? err.message : 'Request failed';
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}
