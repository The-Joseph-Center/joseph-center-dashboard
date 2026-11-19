/**
 * The weekly reconciliation email.
 *
 * Split out from reconcile-staff.ts so it can be rendered in a test without
 * starting a database client or a mail client — the same reason
 * coffee-chat-invite-email.ts is its own module. The handler decides WHETHER to
 * write; this file only decides what the message says.
 *
 * What is deliberately NOT in here is as load-bearing as what is: the
 * "staff cards with no Okta account" list is computed by the handler, returned
 * in its response and shown on the Staff page, but never rendered. Most of the
 * staff do not use a computer at work, so that list is a standing fact rather
 * than drift, and repeating it every Monday is what turned the whole report
 * into something to skim. The test suite pins that.
 */

export interface Report {
  unpublished: { name: string; login: string; reason: string }[];
  newLinks: { name: string; login: string; via: string }[];
  needsAttention: { name: string; login: string; note: string }[];
  /**
   * Still computed, still returned in the response, and deliberately NOT
   * emailed. Most of the staff do not use a computer at work and will never
   * have an Okta account, so this list is a steady-state fact rather than
   * drift, and a weekly reminder of it is what teaches you to skim the whole
   * report. It stays on the Staff page, where there is a button to clear it.
   */
  cardsWithoutAccount: string[];
  accountsWithoutCard: string[];
  /** Coffee Chat guest applications received since the last digest. */
  newApplicants: { name: string; connection: string; at: number; careful: boolean }[];
}

export function renderEmail(r: Report, kind: 'now' | 'weekly') {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /**
   * Denver, not the server's clock. Netlify runs these functions in UTC, so an
   * application submitted at 6pm Mountain would otherwise be reported as the
   * next day — the same reason tax-summary.ts fixes an offset rather than
   * trusting the host. Named zone rather than a fixed offset, so it stays
   * right across the March and November changes.
   */
  const when = (at: number) =>
    new Date(at * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'America/Denver',
    });
  /**
   * A line under a section saying how to make it stop. The standing lists are
   * all clearable, but the report never said so, which is how the same settled
   * row arrived every Monday for weeks.
   */
  const note = (text: string) =>
    `<p style="margin:4px 0 0 18px;font-size:12px;color:#8a8a8a;">${esc(text)}</p>`;
  // Only when it is configured; a guessed host would be a dead link in an
  // email, which is worse than no link.
  const base = process.env.DASHBOARD_BASE_URL;
  const link = base
    ? `<p style="margin:22px 0 0;font-size:13px;"><a href="${base.replace(/\/$/, '')}/staff" style="color:#1D5F55;">Open the Staff page</a></p>`
    : '';
  const section = (title: string, items: string[], tone = '#5C5C5C') =>
    items.length
      ? `<p style="margin:18px 0 6px;font-size:13px;color:${tone};font-weight:600;">${title}</p>
         <ul style="margin:0;padding-left:18px;font-size:14px;">${items.map((i) => `<li style="margin:3px 0;">${esc(i)}</li>`).join('')}</ul>`
      : '';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#262626;max-width:640px;">
  <h2 style="font-size:17px;margin:0 0 4px;">Staff page — Okta reconciliation</h2>
  <p style="margin:0;color:#5C5C5C;font-size:14px;">${kind === 'weekly'
    ? 'The week\'s standing picture. Checks run daily; this goes out on Mondays, and anything that changes the site emails the same day.'
    : 'Something changed on the site today.'} Changes are one-way: leaving Okta unpublishes a card, nothing here republishes one.</p>
  ${section('Unpublished from the website', r.unpublished.map((u) => `${u.name} (${u.login}) — ${u.reason}`), '#8a1f1f')}
  ${section('New Coffee Chat applications', r.newApplicants.map(
    (a) => `${a.name} — ${a.connection}, ${when(a.at)}${a.careful ? ' · read this one before replying' : ''}`,
  ), '#1D5F55')}
  ${section('Okta accounts with no staff card', r.accountsWithoutCard)}
  ${r.accountsWithoutCard.length ? note('Make a card, or mark the account as not needing one, on the Staff page.') : ''}
  ${section('Newly linked to an Okta account', r.newLinks.map((u) => `${u.name} → ${u.login} (matched by ${u.via})`), '#1D5F55')}
  ${section('Needs your attention', r.needsAttention.map((u) => `${u.name} (${u.login}) — ${u.note}`), '#8a5a1f')}
  ${r.needsAttention.length ? note('If one of these is settled and keeps coming back, the Staff page has a button that ends it: “This is intended, stop reporting it”.') : ''}
  ${link}
</div>`.trim();

  const text = [
    'STAFF PAGE — OKTA RECONCILIATION',
    'One-way: leaving Okta unpublishes a card; nothing here republishes one.',
    '',
    ...(r.unpublished.length ? ['UNPUBLISHED:', ...r.unpublished.map((u) => `  ${u.name} (${u.login}) — ${u.reason}`), ''] : []),
    ...(r.newApplicants.length ? ['NEW COFFEE CHAT APPLICATIONS:', ...r.newApplicants.map((a) => `  ${a.name} — ${a.connection}, ${when(a.at)}${a.careful ? ' (read before replying)' : ''}`), ''] : []),
    ...(r.accountsWithoutCard.length ? ['OKTA ACCOUNTS WITH NO CARD:', ...r.accountsWithoutCard.map((s) => `  ${s}`), '  Make a card, or mark the account as not needing one, on the Staff page.', ''] : []),
    ...(r.newLinks.length ? ['NEWLY LINKED:', ...r.newLinks.map((u) => `  ${u.name} -> ${u.login} (${u.via})`), ''] : []),
    ...(r.needsAttention.length ? ['NEEDS ATTENTION:', ...r.needsAttention.map((u) => `  ${u.name} (${u.login}) — ${u.note}`), '  Settled and still listed? The Staff page has a button that ends it.', ''] : []),
  ].join('\n');

  /**
   * The subject names the most arresting thing in the email, and the order
   * follows what is worth opening it for. Applications come before the
   * directory tidying because a person is waiting on a reply. It never counts
   * cardsWithoutAccount, which is no longer in the email at all.
   */
  const headline = r.unpublished.length
    ? `${r.unpublished.length} unpublished`
    : r.newApplicants.length
      ? `${r.newApplicants.length} new Coffee Chat application${r.newApplicants.length === 1 ? '' : 's'}`
      : r.accountsWithoutCard.length
        ? `${r.accountsWithoutCard.length} account${r.accountsWithoutCard.length === 1 ? '' : 's'} with no card`
        : r.newLinks.length
          ? `${r.newLinks.length} newly linked`
          : `${r.needsAttention.length} needing attention`;
  const prefix = kind === 'weekly' ? 'Staff page, this week' : 'Staff page';
  return { subject: `${prefix} — ${headline}`, html, text };
}
