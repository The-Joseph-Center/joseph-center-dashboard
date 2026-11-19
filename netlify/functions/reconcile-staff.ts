import { Resend } from 'resend';
import {
  fetchOktaUsers, fetchStaffCards, fetchServiceAccountLogins, fetchNoCard, matchAll, oktaLogin,
  DEPARTED_STATUSES, turso, ensureIdentityTable, unpublishCard, fetchMutes, type OktaUser,
} from './_lib/staff-directory';
import { SANITY_DATASET } from './_lib/sanity-dataset';
import { renderEmail, type Report } from './_lib/reconcile-email.ts';

/**
 * Reconciliation between Okta and the public staff page.
 *
 * Runs daily, writes daily, but only emails weekly. Acting daily is what keeps
 * a departure off the website within a day; emailing daily meant the same
 * settled list arriving every morning, which is how a report stops being read.
 * Anything that actually changed the public site, or that blocked a write,
 * still emails the moment it happens.
 *
 * ONE DIRECTION ONLY. Leaving Okta takes someone off the website; nothing here
 * ever puts anyone back. A reactivated account is reported so a human decides
 * whether the card returns, because "employed again" and "should appear on the
 * public site again" are not the same question, and getting that wrong
 * republishes someone without their knowing.
 *
 * Polling rather than an Okta event hook: it is idempotent, it self-heals if a
 * run is missed, and it surfaces drift a webhook never would — cards with no
 * account, accounts with no card, links that have appeared since last time.
 * Immediacy is not the concern, because Okta app assignment already revokes
 * dashboard access the moment someone is deactivated. This is only about how
 * quickly their photo leaves the website.
 */

const resend = new Resend(process.env.RESEND_API_KEY);


export async function handler() {
  const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
  const DATASET = SANITY_DATASET;
  const SANITY = process.env.SANITY_WRITE_TOKEN!;
  const ORG = process.env.OKTA_ISSUER!;
  const OKTA = process.env.OKTA_API_TOKEN!;
  const DRY = process.env.RECONCILE_DRY_RUN === 'yes';

  if (!PROJECT || !SANITY || !ORG || !OKTA) {
    console.error('reconcile-staff: missing configuration; refusing to run');
    return { statusCode: 500, body: 'not configured' };
  }

  const report: Report = {
    unpublished: [], newLinks: [], needsAttention: [],
    cardsWithoutAccount: [], accountsWithoutCard: [], newApplicants: [],
  };

  try {
    const [users, cards, serviceAccounts] = await Promise.all([
      fetchOktaUsers(ORG, OKTA),
      fetchStaffCards(PROJECT, DATASET, SANITY),
      fetchServiceAccountLogins(ORG, OKTA),
    ]);
    const byLogin = new Map<string, OktaUser>(users.map((u) => [oktaLogin(u), u]));

    const db = turso();
    await ensureIdentityTable(db);
    // Accounts a human has already said will never have a card. Without this the
    // report repeats the same known-fine list every day and stops being read.
    const notStaff = new Set((await fetchNoCard(db)).map((d) => d.login));
    const existing = new Map<string, string>(
      (await db.execute('SELECT sanity_staff_id, okta_login FROM staff_identity')).rows.map(
        (r) => [r.sanity_staff_id as string, r.okta_login as string]
      )
    );

    const mutes = await fetchMutes(db);
    const mutedNoAccount = new Set(mutes.filter((m) => m.kind === 'no-okta-account').map((m) => m.staffId));
    const mutedHidden = new Set(mutes.filter((m) => m.kind === 'hidden-ok').map((m) => m.staffId));

    /**
     * A link someone made by hand outranks the name and email guesswork.
     * "Tricia" on the website and "Patricia" in Okta is one person, and without
     * this she is reported twice every run — her card as having no account, her
     * account as having no card — however many times the link is made.
     */
    const matches = matchAll(cards, users).map((m) => {
      if (m.user) return m;
      const linked = existing.get(m.card._id);
      const user = linked ? byLogin.get(linked) : undefined;
      return user ? { ...m, user, via: 'linked by hand' as const } : m;
    });

    // Refuse to write anything if two cards resolved to one account.
    const claimed = new Map<string, string[]>();
    for (const m of matches) {
      if (!m.user) continue;
      const l = oktaLogin(m.user);
      claimed.set(l, [...(claimed.get(l) ?? []), m.card.name ?? m.card._id]);
    }
    const collisions = [...claimed].filter(([, v]) => v.length > 1);
    if (collisions.length) {
      console.error('reconcile-staff: collisions, refusing to write:', collisions);
      report.needsAttention.push(
        ...collisions.map(([l, v]) => ({ name: v.join(' & '), login: l, note: 'several cards resolve to this one account — nothing was changed' }))
      );
    }

    const linkedLogins = new Set<string>();

    for (const m of matches) {
      const card = m.card;
      const name = card.name ?? card._id;

      if (!m.user) {
        if (!collisions.length && !mutedNoAccount.has(card._id)) {
          report.cardsWithoutAccount.push(`${name}${card.title ? ` — ${card.title}` : ''}`);
        }
        continue;
      }
      const login = oktaLogin(m.user);
      linkedLogins.add(login);

      if (!collisions.length && existing.get(card._id) !== login && m.via !== 'linked by hand') {
        if (!DRY) {
          await db.execute({
            sql: `INSERT INTO staff_identity (sanity_staff_id, okta_login, okta_user_id, matched_by, updated_at)
                  VALUES (?, ?, ?, ?, unixepoch())
                  ON CONFLICT(sanity_staff_id) DO UPDATE SET
                    okta_login=excluded.okta_login, okta_user_id=excluded.okta_user_id,
                    matched_by=excluded.matched_by, updated_at=excluded.updated_at`,
            args: [card._id, login, m.user.id, m.via!],
          });
        }
        report.newLinks.push({ name, login, via: m.via! });
      }

      const departed = DEPARTED_STATUSES.has(m.user.status);
      if (departed && !card.hidden) {
        if (!DRY) await unpublishCard(PROJECT, DATASET, SANITY, card._id);
        report.unpublished.push({ name, login, reason: `Okta status ${m.user.status}` });
      } else if (!departed && card.hidden && !mutedHidden.has(card._id)) {
        // Never republished automatically — reported so a person decides.
        report.needsAttention.push({ name, login, note: 'active in Okta but hidden on the site — republish only if intended' });
      }
    }

    // Someone deleted outright from Okta still has a link but no account.
    for (const [staffId, login] of existing) {
      if (byLogin.has(login)) continue;
      const card = cards.find((c) => c._id === staffId);
      if (!card || card.hidden) continue;
      if (!DRY) await unpublishCard(PROJECT, DATASET, SANITY, staffId);
      report.unpublished.push({ name: card.name ?? staffId, login, reason: 'no longer present in Okta' });
    }

    for (const u of users) {
      const l = oktaLogin(u);
      // Shared inboxes are not people and are never expected to have a card.
      if (!linkedLogins.has(l) && !DEPARTED_STATUSES.has(u.status) && !serviceAccounts.has(l) && !notStaff.has(l)) {
        report.accountsWithoutCard.push(`${u.profile.firstName ?? ''} ${u.profile.lastName ?? ''}`.trim() + ` (${l})`);
      }
    }

    console.log('reconcile-staff:', JSON.stringify({ ...report, dryRun: DRY }));

    /**
     * Two reasons to write, and only two.
     *
     * Something changed the public site or blocked a write — a card was
     * unpublished, or several cards claim one account — and that is worth an
     * email the day it happens. Otherwise the standing picture goes out once a
     * week, because a list that has not changed since yesterday is not news and
     * a daily one trains you to skim past the day it matters.
     */
    const urgent = report.unpublished.length > 0 || collisions.length > 0;
    const digestDay = Number(process.env.STAFF_DIGEST_DAY ?? 1); // Monday, UTC
    const isDigestDay = new Date().getUTCDay() === digestDay;

    /**
     * The week's Coffee Chat guest applications.
     *
     * Not reconciliation, but it belongs in the one report that is already
     * read on a Monday, and somebody is waiting on a reply: an application is
     * how a guest gets booked with Mona.
     *
     * Its own try/catch, and deliberately not awaited alongside anything that
     * writes. This function unpublishes cards from the public website; a
     * missing table or a slow query must not be able to take that down, so a
     * failure here costs the section and nothing else.
     *
     * Names and dates only. The impact statement, the legal-matters answer and
     * the sensitive-topics field stay in the dashboard behind the capability
     * that guards them — `careful` carries the one bit that changes how you
     * read it, without putting any of it in an inbox.
     */
    if (isDigestDay) {
      try {
        const apps = await db.execute(
          `SELECT full_name, connection, has_legal_matters, sensitive_topics, submitted_at
             FROM coffee_chat_applications
            WHERE submitted_at >= unixepoch() - 7 * 86400
            ORDER BY submitted_at DESC
            LIMIT 50`,
        );
        report.newApplicants = apps.rows.map((r) => ({
          name: String(r.full_name ?? '').trim() || 'Name not given',
          connection: String(r.connection ?? '').trim() || 'connection not given',
          at: Number(r.submitted_at ?? 0),
          careful: Number(r.has_legal_matters ?? 0) === 1 || !!String(r.sensitive_topics ?? '').trim(),
        }));
      } catch (err) {
        console.error('reconcile-staff: could not read the week\u2019s applications:', err);
      }
    }

    /**
     * What is worth an email. cardsWithoutAccount is absent on purpose: it is
     * no longer rendered, so counting it here would send a message whose only
     * contents had been left out.
     */
    const anythingToSay =
      report.needsAttention.length + report.newLinks.length +
      report.accountsWithoutCard.length + report.newApplicants.length > 0;

    if (isDigestDay && !urgent && anythingToSay) {
      // The week's links, not just this morning's — the digest is the only
      // place they are reported, so a Tuesday match still gets mentioned.
      const week = await db.execute(
        `SELECT sanity_staff_id, okta_login, matched_by FROM staff_identity
          WHERE updated_at >= unixepoch() - 7 * 86400`
      );
      for (const r of week.rows) {
        const id = String(r.sanity_staff_id);
        if (report.newLinks.some((l) => l.login === String(r.okta_login))) continue;
        const card = cards.find((c) => c._id === id);
        report.newLinks.push({
          name: card?.name ?? id, login: String(r.okta_login), via: String(r.matched_by),
        });
      }
    }

    if ((urgent || (isDigestDay && anythingToSay)) && !DRY) {
      const rendered = renderEmail(report, urgent ? 'now' : 'weekly');
      const { error } = await resend.emails.send({
        from: `The Joseph Center <${process.env.QUOTE_REVIEW_FROM_EMAIL || 'no-reply@josephcentergj.com'}>`,
        to: process.env.STAFF_ALERT_TO_EMAIL || process.env.QUOTE_REVIEW_TO_EMAIL || 'ephifer@josephcentergj.com',
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (error) console.error('reconcile-staff: Resend rejected the send:', error);
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, dryRun: DRY, ...report }) };
  } catch (err) {
    console.error('reconcile-staff:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'reconciliation failed' }) };
  }
}
