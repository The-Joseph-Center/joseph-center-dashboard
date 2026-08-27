import { requireCapability, denial } from './_lib/verify-okta';
import { turso } from './_lib/staff-directory';

/**
 * Opening, closing and editing the seasonal forms.
 *
 * The forms themselves live in Sanity as `dynamicForm` documents — the public
 * page reads them there, so this edits the same documents rather than keeping a
 * second copy that could disagree with what the site is serving.
 *
 * Two things are deliberately not editable here:
 *
 *   slug   is the URL, and it is also the value stored on every past submission
 *          in form_submissions. Changing it would orphan the archive and 404
 *          the page in one move.
 *   new    forms cannot be created: /forms/angel-tree and /forms/easter-basket
 *          are hardcoded routes in the frontend, so a new document would have
 *          no page to appear on. Creating one needs a deploy, not a toggle.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const DATASET = process.env.VITE_SANITY_DATASET || 'staging';
const SANITY = process.env.SANITY_WRITE_TOKEN!;

const FIELD_TYPES = ['text', 'email', 'phone', 'number', 'textarea', 'select'];
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Same local-year rule the submissions inbox uses — see list-submissions. */
const LOCAL_YEAR = "strftime('%Y', submitted_at, 'unixepoch', '-7 hours')";

async function sanityQuery<T>(query: string): Promise<T> {
  const url = `https://${PROJECT}.api.sanity.io/v2024-06-20/data/query/${DATASET}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SANITY}` } });
  if (!res.ok) throw new Error(`Sanity query: ${res.status}`);
  return (await res.json()).result;
}

async function sanityMutate(mutations: unknown[]) {
  const res = await fetch(
    `https://${PROJECT}.api.sanity.io/v2024-06-20/data/mutate/${DATASET}?returnIds=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${SANITY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations }),
    }
  );
  if (!res.ok) throw new Error(`Sanity mutate: ${res.status} ${await res.text()}`);
  return res.json();
}

interface Field { _key?: string; label?: string; name?: string; type?: string; required?: boolean; options?: string[] }
interface Form {
  _id: string; title?: string; slug?: string; active?: boolean;
  activeDates?: { start?: string; end?: string } | null;
  description?: string; successMessage?: string; notifyEmail?: string; fields?: Field[];
}

/**
 * Whether the form is accepting submissions right now, and which condition
 * decided it.
 *
 * Returns a state, not a sentence. Netlify runs in UTC, so a date formatted
 * here would read a day out for anyone in Colorado whenever the boundary is
 * near midnight — the browser knows the reader's timezone and this does not.
 * The wording is built there; the decision stays here, matching what
 * submit-dynamic-form enforces.
 */
type FormState = 'closed' | 'open' | 'before-start' | 'after-end';
function statusOf(f: Form): { open: boolean; state: FormState } {
  if (f.active === false || f.active == null) return { open: false, state: 'closed' };
  const now = Date.now();
  const start = f.activeDates?.start ? new Date(f.activeDates.start).getTime() : null;
  const end = f.activeDates?.end ? new Date(f.activeDates.end).getTime() : null;
  if (start && start > now) return { open: false, state: 'before-start' };
  if (end && end < now) return { open: false, state: 'after-end' };
  return { open: true, state: 'open' };
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  const auth = await requireCapability(event.headers, 'formsAdmin');
  if (!auth.ok) return denial(auth);

  try {
    const forms = await sanityQuery<Form[]>(
      `*[_type=="dynamicForm" && !(_id in path("drafts.**"))]|order(title asc){
        _id,title,"slug":slug.current,active,activeDates,description,successMessage,notifyEmail,fields
      }`
    );

    if (event.httpMethod === 'GET') {
      // One grouped query rather than one per form — the report is a handful of
      // rows and there is no reason to walk the table repeatedly.
      const counts = await turso().execute(
        `SELECT form_slug, ${LOCAL_YEAR} AS y, COUNT(*) AS n
         FROM form_submissions GROUP BY form_slug, y ORDER BY y DESC`
      );
      const byForm = new Map<string, { year: string; count: number }[]>();
      for (const r of counts.rows) {
        const slug = String(r.form_slug);
        byForm.set(slug, [...(byForm.get(slug) ?? []), { year: String(r.y), count: Number(r.n) }]);
      }
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          forms: forms.map((f) => {
            const years = byForm.get(f.slug ?? '') ?? [];
            return {
              ...f,
              status: statusOf(f),
              years,
              total: years.reduce((n, y) => n + y.count, 0),
            };
          }),
          fieldTypes: FIELD_TYPES,
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const id = clean(body._id, 120);
    const current = forms.find((f) => f._id === id);
    if (!current) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'No such form' }) };
    }

    // ── Open / close ──
    if (clean(body.action, 20) === 'toggle') {
      const active = body.active === true;
      await sanityMutate([{ patch: { id, set: { active } } }]);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ active }) };
    }

    // ── Save ──
    const incoming: Field[] = Array.isArray(body.fields) ? body.fields : [];
    const fields: Field[] = [];
    for (const [i, f] of incoming.entries()) {
      const label = clean(f.label, 200);
      const name = clean(f.name, 60);
      const type = clean(f.type, 20);
      if (!label) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: `Field ${i + 1} needs a label.` }) };
      }
      if (!KEY_RE.test(name)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: `"${label}" needs a key like firstName — letters and numbers, starting with a letter.` }) };
      }
      if (!FIELD_TYPES.includes(type)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: `"${label}" has an unknown type.` }) };
      }
      const options = type === 'select'
        ? (Array.isArray(f.options) ? f.options.map((o) => clean(o, 120)).filter(Boolean) : [])
        : undefined;
      if (type === 'select' && !options?.length) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: `"${label}" is a dropdown, so it needs at least one option.` }) };
      }
      fields.push({
        _key: clean(f._key, 40) || `f${i}${Math.abs(hash(name + label))}`,
        _type: 'formField', label, name, type,
        required: f.required === true,
        ...(options ? { options } : {}),
      } as Field);
    }
    if (new Set(fields.map((f) => f.name)).size !== fields.length) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Two fields share the same key. Each key must be unique.' }) };
    }

    // Past answers are stored under the field key. Renaming or removing a key
    // does not migrate them, so an archived Angel Tree entry would still hold
    // `firstName` while the form no longer has anywhere to show it. Allowed,
    // but never silently: the caller has to say it meant to.
    const before = new Set((current.fields ?? []).map((f) => f.name).filter(Boolean) as string[]);
    const after = new Set(fields.map((f) => f.name!) );
    const lost = [...before].filter((k) => !after.has(k));
    if (lost.length && body.confirmKeyChange !== true) {
      const { rows } = await turso().execute({
        sql: 'SELECT COUNT(*) AS n FROM form_submissions WHERE form_slug = ?',
        args: [current.slug ?? ''],
      });
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) {
        return {
          statusCode: 409,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            needsConfirm: true, lostKeys: lost, submissionCount: n,
            error: `${lost.join(', ')} ${lost.length === 1 ? 'is' : 'are'} used by ${n} stored submission${n === 1 ? '' : 's'}. Those answers stay in the archive but will no longer line up with the form.`,
          }),
        };
      }
    }

    const start = clean(body.startAt, 40);
    const end = clean(body.endAt, 40);
    const set: Record<string, unknown> = {
      title: clean(body.title, 200) || current.title,
      description: clean(body.description, 2000),
      successMessage: clean(body.successMessage, 1000),
      notifyEmail: clean(body.notifyEmail, 200),
      fields,
    };
    const unset: string[] = [];
    if (start || end) {
      set.activeDates = { ...(start ? { start } : {}), ...(end ? { end } : {}) };
    } else {
      unset.push('activeDates');
    }

    await sanityMutate([{ patch: { id, set, ...(unset.length ? { unset } : {}) } }]);
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: true }) };
  } catch (err) {
    console.error('admin-forms:', err);
    const message = err instanceof Error ? err.message : 'Request failed';
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
  }
}

/** Stable-enough key for a newly added field. Sanity only needs uniqueness. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
