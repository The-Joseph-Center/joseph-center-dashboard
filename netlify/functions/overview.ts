import { verifyRequest, denial } from './_lib/verify-okta';
import { hasCapability, formsFor, type FormId } from '../../src/lib/capabilities';
import { FORMS } from '../../src/lib/submissionForms';
import { turso } from './_lib/staff-directory';

/**
 * What is waiting on the person who just signed in.
 *
 * Assembled from their capabilities rather than from a fixed list, because
 * eleven tools and nine groups means no two people are owed the same things.
 * The front desk should not be nagged about the Okta queue and the social
 * media team should not be shown the letter log. Anything this returns, the
 * caller could already have opened for themselves — the strip is a shortcut,
 * never a way around FORM_ACCESS.
 *
 * Every source is read independently and allowed to fail on its own: a strip
 * that is empty because one query threw is worse than a strip missing one
 * line, since "nothing is waiting" is a claim the page makes out loud.
 *
 * Counts only what nobody has touched. A submission with any follow-up
 * recorded — even "No reply needed" — has been dealt with by a person, and
 * continuing to count it would train everyone to ignore the number.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface Waiting {
  /** Stable key, so the page can order and test them. */
  id: string;
  /** What is waiting, in the words someone would use out loud. */
  text: string;
  /** Where to go and act on it, filtered where the page supports it. */
  href: string;
  /** 'act' is owed by this person; 'watch' is worth knowing, not overdue. */
  tone: 'act' | 'watch';
  count?: number;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function handler(event: { headers: Record<string, string | undefined> }) {
  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);

  const db = turso();
  const groups = auth.groups;
  const can = (c: Parameters<typeof hasCapability>[1]) => hasCapability(groups, c);

  /** Runs a source, and lets it fail without taking the others with it. */
  const source = async (name: string, fn: () => Promise<Waiting[]>): Promise<Waiting[]> => {
    try {
      return await fn();
    } catch (err) {
      console.error(`overview: ${name} failed`, err);
      return [];
    }
  };

  const jobs: Promise<Waiting[]>[] = [];

  // ── Submissions nobody has answered ──
  // One tile per form, because "7 waiting" across three different inboxes is
  // not an action; "3 contact messages" is.
  if (can('submissions')) {
    const mine = formsFor(groups);
    for (const form of FORMS) {
      if (!form.followUp?.length || form.archived) continue;
      if (!mine.includes(form.id as FormId)) continue;
      jobs.push(source(`submissions:${form.id}`, async () => {
        const { rows } = await db.execute({
          sql: `SELECT COUNT(*) AS n FROM ${form.table} t
                 WHERE NOT EXISTS (
                   SELECT 1 FROM submission_followups f
                    WHERE f.form_id = ? AND f.row_id = CAST(t.id AS TEXT)
                 )`,
          args: [form.id],
        });
        const n = Number(rows[0]?.n ?? 0);
        if (!n) return [];
        return [{
          id: `submissions-${form.id}`,
          text: `${plural(n, form.label.replace(/s$/, '').toLowerCase())} with no reply recorded`,
          href: `/submissions?form=${form.id}`,
          tone: 'act',
          count: n,
        }];
      }));
    }
  }

  // ── This month's newsletter ──
  if (can('newsletter')) {
    jobs.push(source('newsletter', async () => {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { rows } = await db.execute({
        sql: 'SELECT status, section1, section2 FROM newsletters WHERE month = ?',
        args: [month],
      });
      const row = rows[0];
      const name = MONTHS[now.getMonth()]!;
      if (row?.status === 'sent') return [];

      // The send is meant to land at the end of the month, so the back half is
      // when an unfinished draft stops being fine and starts being late.
      const dayOfMonth = now.getDate();
      const started = !!String(row?.section1 ?? '').trim() || !!String(row?.section2 ?? '').trim();
      if (!row || !started) {
        return [{
          id: 'newsletter-unstarted',
          text: `${name}'s newsletter has not been started`,
          href: '/newsletter',
          tone: dayOfMonth >= 15 ? 'act' : 'watch',
        }];
      }
      return [{
        id: 'newsletter-draft',
        text: `${name}'s newsletter is still a draft`,
        href: '/newsletter',
        tone: dayOfMonth >= 22 ? 'act' : 'watch',
      }];
    }));
  }

  // ── Seasonal forms: what is open, and what is about to close ──
  if (can('formsAdmin')) {
    jobs.push(source('forms', async () => {
      const project = process.env.VITE_SANITY_PROJECT_ID;
      if (!project) return [];
      const query = `*[_type=="dynamicForm" && active == true]{title,"slug":slug.current,activeDates}`;
      const res = await fetch(
        `https://${project}.api.sanity.io/v2024-06-20/data/query/${process.env.VITE_SANITY_DATASET || 'production'}?query=${encodeURIComponent(query)}`
      );
      if (!res.ok) throw new Error(`Sanity ${res.status}`);
      const forms = ((await res.json()) as { result?: { title: string; slug: string; activeDates?: { end?: string } }[] }).result ?? [];

      const out: Waiting[] = [];
      for (const f of forms) {
        const end = f.activeDates?.end ? new Date(f.activeDates.end).getTime() : null;
        const days = end === null ? null : Math.ceil((end - Date.now()) / 86400000);
        if (days !== null && days <= 7) {
          out.push({
            id: `form-closing-${f.slug}`,
            text: days <= 0 ? `${f.title} has closed — switch it off` : `${f.title} closes in ${plural(days, 'day')}`,
            href: '/forms',
            tone: 'act',
          });
        }
        const { rows } = await db.execute({
          sql: `SELECT COUNT(*) AS n FROM form_submissions
                 WHERE form_slug = ? AND submitted_at >= unixepoch() - 7 * 86400`,
          args: [f.slug],
        });
        const n = Number(rows[0]?.n ?? 0);
        if (n) {
          out.push({
            id: `form-new-${f.slug}`,
            text: `${plural(n, 'new sign-up')} for ${f.title} this week`,
            href: `/submissions?form=seasonal`,
            tone: 'watch',
            count: n,
          });
        }
      }
      return out;
    }));
  }

  // ── Duties: mine, and the hands up waiting on an answer ──
  if (can('duties')) {
    jobs.push(source('duties', async () => {
      const out: Waiting[] = [];
      const email = (auth.email ?? '').toLowerCase();
      const name = String(auth.claims?.name ?? '').trim();

      if (name) {
        const { rows } = await db.execute({
          sql: `SELECT COUNT(*) AS n FROM marketing_duties
                 WHERE status <> 'Done' AND owner_names LIKE ?`,
          args: [`%${name.split(' ')[0]}%`],
        });
        const n = Number(rows[0]?.n ?? 0);
        if (n) {
          out.push({
            id: 'duties-mine',
            text: `${plural(n, 'duty', 'duties')} assigned to you are not done`,
            href: '/duties',
            tone: 'watch',
            count: n,
          });
        }
      }

      // Someone offering to take a duty on is waiting for an answer from the
      // one person who can give it.
      if (can('dutiesEdit')) {
        // A hand up stops waiting when that person is made an owner of the
        // duty — there is no "handled" flag, and adding one would just be a
        // second place to forget. owner_names is a JSON array of display
        // names, so a name match is the honest test available.
        const { rows } = await db.execute(
          `SELECT COUNT(*) AS n FROM duty_interest i
             JOIN marketing_duties d ON d.id = i.duty_id
            WHERE i.person_name IS NULL
               OR LOWER(COALESCE(d.owner_names, '')) NOT LIKE '%' || LOWER(i.person_name) || '%'`
        );
        const n = Number(rows[0]?.n ?? 0);
        if (n) {
          out.push({
            id: 'duties-interest',
            text: `${plural(n, 'person', 'people')} put a hand up for a duty`,
            href: '/duties',
            tone: 'act',
            count: n,
          });
        }
      }
      return out;
    }));
  }

  const waiting = (await Promise.all(jobs)).flat();
  // Owed before interesting, then the biggest number — the same order the page
  // reads in.
  waiting.sort((a, b) =>
    a.tone === b.tone ? (b.count ?? 0) - (a.count ?? 0) : a.tone === 'act' ? -1 : 1
  );

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      name: String(auth.claims?.name ?? '').split(' ')[0] ?? '',
      waiting,
    }),
  };
}
