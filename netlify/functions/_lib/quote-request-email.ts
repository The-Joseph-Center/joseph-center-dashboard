export interface QuoteRequestVars {
  staffName: string;
  staffTitle?: string | null;
  requesterEmail: string;
  currentQuote?: string | null;
  proposedQuote: string;
  staffId: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function quoteRequestEmail(v: QuoteRequestVars) {
  const cleared = !v.proposedQuote.trim();
  const action = cleared ? 'asked to remove their quote' : 'submitted a quote';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#262626;max-width:600px;">
  <h2 style="font-size:17px;margin:0 0 4px;">Staff quote — review needed</h2>
  <p style="margin:0 0 20px;color:#5C5C5C;font-size:14px;">
    ${esc(v.staffName)} ${action}. Nothing has changed on the website.
  </p>
  <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;">
    <tr><td style="padding:6px 0;color:#5C5C5C;width:140px;">Staff member</td><td style="padding:6px 0;"><strong>${esc(v.staffName)}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#5C5C5C;">Title</td><td style="padding:6px 0;">${esc(v.staffTitle || '—')}</td></tr>
    <tr><td style="padding:6px 0;color:#5C5C5C;">Requested by</td><td style="padding:6px 0;">${esc(v.requesterEmail)}</td></tr>
    <tr><td style="padding:6px 0;color:#5C5C5C;">Document ID</td><td style="padding:6px 0;font-family:monospace;font-size:12px;">${esc(v.staffId)}</td></tr>
  </table>
  <p style="margin:20px 0 6px;font-size:13px;color:#5C5C5C;">Currently on the site</p>
  <blockquote style="margin:0;padding:10px 14px;background:#F7F5EE;border-left:3px solid #d8d2c2;font-size:14px;">
    ${v.currentQuote ? esc(v.currentQuote) : '<em style="color:#5C5C5C;">— none —</em>'}
  </blockquote>
  <p style="margin:18px 0 6px;font-size:13px;color:#5C5C5C;">Requested</p>
  <blockquote style="margin:0;padding:10px 14px;background:#F1F6F1;border-left:3px solid #1D5F55;font-size:14px;">
    ${cleared ? '<em style="color:#5C5C5C;">— remove the quote —</em>' : esc(v.proposedQuote)}
  </blockquote>
  <p style="margin:22px 0 0;font-size:12px;color:#5C5C5C;">
    Apply it in Sanity Studio if you're happy with it.
  </p>
</div>`.trim();

  const text = [
    'STAFF QUOTE — REVIEW NEEDED',
    `${v.staffName} ${action}. Nothing has changed on the website.`,
    '',
    `Staff member : ${v.staffName}`,
    `Title        : ${v.staffTitle || '—'}`,
    `Requested by : ${v.requesterEmail}`,
    `Document ID  : ${v.staffId}`,
    '',
    `Currently    : ${v.currentQuote || '— none —'}`,
    `Requested    : ${cleared ? '— remove the quote —' : v.proposedQuote}`,
    '',
    "Apply it in Sanity Studio if you're happy with it.",
  ].join('\n');

  return { subject: `Staff quote — ${v.staffName}`, html, text };
}
