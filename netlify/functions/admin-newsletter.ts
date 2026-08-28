import { requireCapability, denial } from './_lib/verify-okta';
import { turso, fetchOktaUsers } from './_lib/staff-directory';
import {
  TIERS, section4, closingSection, aweberPlan, reviewNewsletter, bridgeLine,
  type NewsletterDraft,
} from './_lib/newsletter';

/**
 * The monthly newsletter, assembled.
 *
 * What this does and does not do is the important part. It builds the three
 * versions, runs the review the process document asks for, and works out the
 * AWeber settings for the month. It does **not** touch AWeber. Applying the
 * monthly tag is what sends the newsletter to every active subscriber, and that
 * is not an action a tool should be able to take on someone's behalf — the last
 * step stays a human in AWeber, with this page telling them exactly what to set.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthName = (month: string) => MONTHS[Number(month.split('-')[1]) - 1] ?? '';
const clean = (v: unknown, max = 20000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const parse = <T,>(v: unknown, fallback: T): T => {
  try { return typeof v === 'string' ? JSON.parse(v) as T : fallback; } catch { return fallback; }
};

const SANITY_PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
const SANITY_DATASET = process.env.VITE_SANITY_DATASET || 'staging';

/**
 * Every partner already on the website's home-page marquee.
 *
 * These are the organizations The Joseph Center already names publicly, so they
 * are the pool a quarter's foundation partners come from — no reason to retype
 * a name and a URL that are already in the CMS, and no reason for the two to
 * disagree about how a partner is spelled.
 */
async function marqueePartners(): Promise<{ name: string; url: string }[]> {
  try {
    const q = `*[_type=="page" && slug.current=="/"][0].sections[_type=="partnersSection"][0].partners[]{name, "url": href}`;
    const res = await fetch(
      `https://${SANITY_PROJECT}.apicdn.sanity.io/v2024-01-01/data/query/${SANITY_DATASET}?query=${encodeURIComponent(q)}`
    );
    if (!res.ok) return [];
    const rows = (await res.json()).result as { name?: string; url?: string }[] | null;
    return (rows ?? [])
      .filter((p) => p?.name)
      .map((p) => ({ name: p.name!.trim(), url: (p.url ?? '').trim() }));
  } catch {
    return [];
  }
}

/**
 * Surnames from the directory, for the "first names only" rule.
 *
 * Read from Okta rather than hardcoded so it stays right as people join and
 * leave — the rule applies to everyone, and a list typed out today is wrong by
 * the next hire.
 */
async function staffSurnames(): Promise<string[]> {
  try {
    const users = await fetchOktaUsers(process.env.OKTA_ISSUER!, process.env.OKTA_API_TOKEN!);
    return [...new Set(users.map((u) => u.profile.lastName ?? '').filter((n) => /^[A-Z][a-zA-Z'-]{2,}$/.test(n)))];
  } catch {
    return [];
  }
}

interface Row {
  id: number; month: string; guest_name: string | null; guest_frame: string | null;
  program: string | null; aweber_tag: string | null; section1: string | null; section2: string | null;
  stats: string | null; videos: string | null; partners: string | null; preview_text: string | null;
  status: string; sent_at: number | null; updated_by: string | null; updated_at: number;
}

const shape = (r: Row) => ({
  id: r.id, month: r.month, monthName: monthName(r.month),
  guestName: r.guest_name ?? '', guestFrame: r.guest_frame ?? 'guest',
  program: r.program ?? '', aweberTag: r.aweber_tag ?? '',
  section1: r.section1 ?? '', section2: r.section2 ?? '',
  stats: parse<Record<string, string>>(r.stats, {}),
  videos: parse<{ title: string; url: string }[]>(r.videos, []),
  partners: parse<{ name: string; url: string }[]>(r.partners, []),
  previewText: r.preview_text ?? '',
  status: r.status, sentAt: r.sent_at, updatedBy: r.updated_by, updatedAt: r.updated_at,
});

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'newsletter');
  if (!auth.ok) return denial(auth);

  try {
    const db = turso();

    if (event.httpMethod === 'GET') {
      const month = clean(event.queryStringParameters?.month ?? '', 7);
      const all = (await db.execute('SELECT * FROM newsletters ORDER BY month DESC')).rows as unknown as Row[];

      if (!month) {
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            months: all.map((r) => ({ month: r.month, monthName: monthName(r.month), status: r.status, guest: r.guest_name })),
            tiers: TIERS.map((t) => ({ id: t.id, label: t.label, tag: t.aweberTag, excludes: t.excludes, signature: t.signature })),
          }),
        };
      }

      const row = all.find((r) => r.month === month);

      /**
       * Where a new month starts from.
       *
       * A blank form for a document with this many parts is daunting enough
       * that it gets put off. Foundation partners change quarterly, so last
       * month's are almost always still right and carrying them forward with a
       * reminder to confirm beats retyping them. The stat labels are the
       * standard set from the process document, so the shape of Section 3 is
       * there before any numbers are.
       */
      const previous = all.filter((r) => r.month < month).sort((a, b) => b.month.localeCompare(a.month))[0];
      const draft = row ? shape(row) : {
        id: 0, month, monthName: monthName(month), guestName: '', guestFrame: 'guest',
        program: '', aweberTag: aweberPlan(month, new Date()).tag, section1: '', section2: '',
        stats: { 'Meals served': '', 'Individuals welcomed': '', 'Families served': '', 'Program spotlight stat': '', 'IFS financial stability': '' },
        videos: [],
        partners: previous ? parse<{ name: string; url: string }[]>(previous.partners, []) : [],
        previewText: '', status: 'draft', sentAt: null, updatedBy: null, updatedAt: 0,
      };

      const usedTags = all.filter((r) => r.month !== month).map((r) => r.aweber_tag ?? '').filter(Boolean);

      /**
       * Which partners have been featured, and when.
       *
       * Partners are locked in for a quarter, so the same names recur for three
       * months and it is easy to lose track of who has already had their turn.
       * Least recently featured first, because that is the order the question
       * "who next?" actually wants answering in.
       */
      const partnerHistory = new Map<string, { name: string; url: string; months: string[] }>();
      for (const r of all) {
        for (const p of parse<{ name: string; url: string }[]>(r.partners, [])) {
          if (!p?.name) continue;
          const entry = partnerHistory.get(p.name) ?? { name: p.name, url: p.url ?? '', months: [] };
          entry.months.push(r.month);
          if (!entry.url && p.url) entry.url = p.url;
          partnerHistory.set(p.name, entry);
        }
      }
      const used = [...partnerHistory.values()]
        .map((p) => ({ ...p, months: p.months.sort().reverse(), lastUsed: p.months.sort().reverse()[0] ?? '' }));

      // Everyone on the marquee, whether or not they have been featured. The
      // ones never used sort first: the aim is to give a different partner a
      // turn rather than cycling the same three.
      const usedNames = new Set(used.map((p) => p.name));
      const partners = [
        ...marquee.filter((p) => !usedNames.has(p.name)).map((p) => ({ ...p, months: [] as string[], lastUsed: '' })),
        ...used,
      ].sort((a, b) => (a.lastUsed || '').localeCompare(b.lastUsed || ''));

      // Which programs and guests have already had a turn, so the rotation is
      // visible rather than remembered.
      const history = all
        .filter((r) => r.month !== month)
        .map((r) => ({ month: r.month, monthName: monthName(r.month), guest: r.guest_name, program: r.program }));
      const [surnames, marquee] = await Promise.all([staffSurnames(), marqueePartners()]);
      const issues = reviewNewsletter({ ...draft, usedTags, staffSurnames: surnames } as NewsletterDraft);
      const plan = aweberPlan(month, new Date());

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          draft, issues, plan, usedTags, partners, history,
          carriedPartners: !row && !!previous,
          bridgeLine: bridgeLine(draft.monthName),
          section3Header: `${draft.monthName} Impact & ${MONTHS[(Number(month.split('-')[1]) - 2 + 12) % 12]} Videos`,
          versions: TIERS.map((t) => ({
            id: t.id, label: t.label, tag: t.aweberTag, excludes: t.excludes,
            subject: t.subject(draft.monthName), signature: t.signature,
            section4: section4(t, draft.monthName, draft.guestName),
            closing: closingSection(draft.partners),
          })),
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const month = clean(body.month, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A month is required, as YYYY-MM.' }) };
    }

    if (clean(body.action, 20) === 'sent') {
      await db.execute({
        sql: `UPDATE newsletters SET status='sent', sent_at=unixepoch(), updated_by=?, updated_at=unixepoch() WHERE month=?`,
        args: [auth.email ?? 'unknown', month],
      });
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ status: 'sent' }) };
    }

    await db.execute({
      sql: `INSERT INTO newsletters
              (month, guest_name, guest_frame, program, aweber_tag, section1, section2, stats, videos, partners, preview_text, updated_by, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())
            ON CONFLICT(month) DO UPDATE SET
              guest_name=excluded.guest_name, guest_frame=excluded.guest_frame, program=excluded.program,
              aweber_tag=excluded.aweber_tag, section1=excluded.section1, section2=excluded.section2,
              stats=excluded.stats, videos=excluded.videos, partners=excluded.partners,
              preview_text=excluded.preview_text, updated_by=excluded.updated_by, updated_at=unixepoch()`,
      args: [
        month,
        clean(body.guestName, 120),
        clean(body.guestFrame, 20) === 'calling' ? 'calling' : 'guest',
        clean(body.program, 120),
        clean(body.aweberTag, 60) || aweberPlan(month, new Date()).tag,
        clean(body.section1),
        clean(body.section2),
        JSON.stringify(body.stats ?? {}),
        JSON.stringify(body.videos ?? []),
        JSON.stringify(body.partners ?? []),
        clean(body.previewText, 300),
        auth.email ?? 'unknown',
      ],
    });

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: true }) };
  } catch (err) {
    console.error('admin-newsletter:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load the newsletter' }) };
  }
}
