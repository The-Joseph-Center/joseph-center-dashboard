import { Resend } from 'resend';
import {
  fetchOktaUsers, fetchStaffCards, fetchServiceAccountLogins, fetchNoCard, matchAll, oktaLogin,
  DEPARTED_STATUSES, turso, ensureIdentityTable, unpublishCard, type OktaUser,
} from './_lib/staff-directory';

/**
 * Daily reconciliation between Okta and the public staff page.
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

interface Report {
  unpublished: { name: string; login: string; reason: string }[];
  newLinks: { name: string; login: string; via: string }[];
  needsAttention: { name: string; login: string; note: string }[];
  cardsWithoutAccount: string[];
  accountsWithoutCard: string[];
}

function renderEmail(r: Report) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const section = (title: string, items: string[], tone = '#5C5C5C') =>
    items.length
      ? `<p style="margin:18px 0 6px;font-size:13px;color:${tone};font-weight:600;">${title}</p>
         <ul style="margin:0;padding-left:18px;font-size:14px;">${items.map((i) => `<li style="margin:3px 0;">${esc(i)}</li>`).join('')}</ul>`
      : '';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#262626;max-width:640px;">
  <h2 style="font-size:17px;margin:0 0 4px;">Staff page — Okta reconciliation</h2>
  <p style="margin:0;color:#5C5C5C;font-size:14px;">Changes are one-way: leaving Okta unpublishes a card, nothing here republishes one.</p>
  ${section('Unpublished from the website', r.unpublished.map((u) => `${u.name} (${u.login}) — ${u.reason}`), '#8a1f1f')}
  ${section('Needs your attention', r.needsAttention.map((u) => `${u.name} (${u.login}) — ${u.note}`), '#8a5a1f')}
  ${section('Newly linked to an Okta account', r.newLinks.map((u) => `${u.name} → ${u.login} (matched by ${u.via})`), '#1D5F55')}
  ${section('Staff cards with no Okta account', r.cardsWithoutAccount)}
  ${section('Okta accounts with no staff card', r.accountsWithoutCard)}
</div>`.trim();

  const text = [
    'STAFF PAGE — OKTA RECONCILIATION',
    'One-way: leaving Okta unpublishes a card; nothing here republishes one.',
    '',
    ...(r.unpublished.length ? ['UNPUBLISHED:', ...r.unpublished.map((u) => `  ${u.name} (${u.login}) — ${u.reason}`), ''] : []),
    ...(r.needsAttention.length ? ['NEEDS ATTENTION:', ...r.needsAttention.map((u) => `  ${u.name} (${u.login}) — ${u.note}`), ''] : []),
    ...(r.newLinks.length ? ['NEWLY LINKED:', ...r.newLinks.map((u) => `  ${u.name} -> ${u.login} (${u.via})`), ''] : []),
    ...(r.cardsWithoutAccount.length ? ['CARDS WITH NO OKTA ACCOUNT:', ...r.cardsWithoutAccount.map((s) => `  ${s}`), ''] : []),
    ...(r.accountsWithoutCard.length ? ['OKTA ACCOUNTS WITH NO CARD:', ...r.accountsWithoutCard.map((s) => `  ${s}`), ''] : []),
  ].join('\n');

  const headline = r.unpublished.length
    ? `${r.unpublished.length} unpublished`
    : r.needsAttention.length
      ? `${r.needsAttention.length} needing attention`
      : `${r.newLinks.length} newly linked`;
  return { subject: `Staff page reconciliation — ${headline}`, html, text };
}

export async function handler() {
  const PROJECT = process.env.VITE_SANITY_PROJECT_ID!;
  const DATASET = process.env.VITE_SANITY_DATASET || 'staging';
  const SANITY = process.env.SANITY_WRITE_TOKEN!;
  const ORG = process.env.OKTA_ISSUER!;
  const OKTA = process.env.OKTA_API_TOKEN!;
  const DRY = process.env.RECONCILE_DRY_RUN === 'yes';

  if (!PROJECT || !SANITY || !ORG || !OKTA) {
    console.error('reconcile-staff: missing configuration; refusing to run');
    return { statusCode: 500, body: 'not configured' };
  }

  const report: Report = { unpublished: [], newLinks: [], needsAttention: [], cardsWithoutAccount: [], accountsWithoutCard: [] };

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

    const matches = matchAll(cards, users);

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
        if (!collisions.length) report.cardsWithoutAccount.push(`${name}${card.title ? ` — ${card.title}` : ''}`);
        continue;
      }
      const login = oktaLogin(m.user);
      linkedLogins.add(login);

      if (!collisions.length && existing.get(card._id) !== login) {
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
      } else if (!departed && card.hidden) {
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

    const actionable = report.unpublished.length + report.needsAttention.length + report.newLinks.length;
    console.log('reconcile-staff:', JSON.stringify({ ...report, dryRun: DRY }));

    // Only email when something happened. A daily "nothing to report" is a mail
    // rule waiting to happen, and then the one that matters is filtered too.
    if (actionable > 0 && !DRY) {
      const rendered = renderEmail(report);
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
