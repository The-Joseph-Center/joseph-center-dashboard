// Shared email chrome. Produces HTML safe for common email clients (Gmail,
// Apple Mail, Outlook) using inline styles + tables for layout, plus a
// plain-text companion.
//
// MIRROR — this is a copy of
//   frontend/netlify/functions/_email-templates/shared.ts
// and everything below this header is byte-identical to it. The two repos
// cannot share code, and an email sent from the dashboard has to look like the
// ones sent from the site, so the chrome is duplicated rather than diverged.
// Change it in both, the same way `form-cap.ts` is kept in step. To confirm
// they still agree, ignoring only this header:
//
//   diff <(tail -n +19 dashboard/netlify/functions/_lib/email-shared.ts) \
//        <(tail -n +9  frontend/netlify/functions/_email-templates/shared.ts)
//
// Files in _lib/ do NOT become Netlify functions (only files at
// netlify/functions/*.ts root level are), so this is import-only.

export const BRAND = {
  name: 'The Joseph Center',
  address1: '2511 Belford Ave #B, Grand Junction, CO 81501',
  phone: '(970) 245-4672',
  email: 'jc@josephcentergj.com',
  website: 'josephcentergj.com',
  /**
   * Stripe's hosted Customer Portal login page for the Joseph Center account.
   *
   * Safe to publish: it asks for an email address and mails a sign-in link, so
   * it only ever shows a donor their own record. Donors use it to change their
   * card, change the amount, or stop a monthly gift without having to ask
   * anyone. Every one of the 24 active recurring donors has an email on their
   * Stripe customer record, so every one of them can get in.
   */
  // Our own address, redirected to Stripe's portal login by netlify.toml. One
  // place to change if Stripe ever rotates that URL, and short enough for a
  // staff member to read out over the phone.
  portalUrl: 'https://josephcentergj.com/portal',
  // Brand palette per the email spec
  primary: '#1B4D4A',
  accent: '#C49A2B',
  textBody: '#262626',
  textMuted: '#5C5C5C',
  bg: '#F7F5EE',
} as const;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Single quotes around the multi-word faces, because this string is
// interpolated into style="…" attributes. With double quotes the attribute
// terminated at "Segoe, and every declaration after the font-family — including
// color:#ffffff on the receipt button — was silently discarded, which is why
// that button rendered as a default blue link on dark green and was reported as
// almost unreadable. Six style attributes per email were affected.
const SYSTEM_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Hidden preview snippet at the top of every email so inbox listings show
// something more meaningful than the first visible word of body copy.
function previewMeta(previewText: string): string {
  if (!previewText) return '';
  return `<div style="display:none;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(previewText)}</div>`;
}

// The tax line is opt-in, not automatic. It used to sit in the shared footer,
// which meant a volunteer who had never given a penny was told their gift might
// be tax-deductible. Only the donation templates pass taxLine.
//
// Address and phone are explicit links in the brand color because Gmail
// autolinks both whether or not we do. Left alone it styles them as default
// blue underlined, which is what the screenshots showed; claiming them first
// keeps the footer in the palette.
const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(BRAND.address1)}`;
const telHref = `tel:+1${BRAND.phone.replace(/\D/g, '')}`;
const footerLink = (href: string, label: string) =>
  `<a href="${href}" style="color:${BRAND.primary};text-decoration:none;">${label}</a>`;

function footerHtml(taxLine: boolean): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e7e1d3;margin-top:32px;">
  <tr>
    <td style="padding:24px 32px;font-family:${SYSTEM_FONT_STACK};font-size:13px;color:${BRAND.textMuted};line-height:1.55;">
      <strong style="color:${BRAND.textBody};">${BRAND.name}</strong><br>
      ${footerLink(mapsUrl, BRAND.address1)}<br>
      ${footerLink(telHref, BRAND.phone)} &middot; ${footerLink(`mailto:${BRAND.email}`, BRAND.email)}<br>
      ${footerLink(`https://${BRAND.website}`, BRAND.website)}
      <br><br>
      The Joseph Center is a 501(c)(3) nonprofit organization.${taxLine ? '<br>Your gift may be tax-deductible to the extent permitted by law.' : ''}
      <br><br>
      <span style="color:#9a9a9a;">&copy; ${new Date().getFullYear()} The Joseph Center. All rights reserved.</span>
    </td>
  </tr>
</table>
`.trim();
}

function footerText(taxLine: boolean): string {
  return `
${BRAND.name}
${BRAND.address1}
${BRAND.phone} | ${BRAND.email}
${BRAND.website}

The Joseph Center is a 501(c)(3) nonprofit organization.${taxLine ? '\nYour gift may be tax-deductible to the extent permitted by law.' : ''}

© ${new Date().getFullYear()} The Joseph Center. All rights reserved.
`.trim();
}

interface ShellOpts {
  previewText?: string;
  /** Adds the tax-deductibility line to the footer. Donation emails only. */
  taxLine?: boolean;
  // Inner HTML for the body — caller provides paragraph and table markup.
  bodyHtml: string;
  // Banner color override (defaults to primary). e.g. gold for staff alerts.
  bannerColor?: string;
  // Banner label, defaults to brand name.
  bannerLabel?: string;
}

export function renderShell(opts: ShellOpts): string {
  const banner = opts.bannerColor ?? BRAND.primary;
  const label = opts.bannerLabel ?? BRAND.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(label)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:${SYSTEM_FONT_STACK};color:${BRAND.textBody};">
${previewMeta(opts.previewText ?? '')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bg};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:${banner};padding:20px 32px;font-family:${SYSTEM_FONT_STACK};color:#ffffff;font-size:15px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">
            ${escapeHtml(label)}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;font-family:${SYSTEM_FONT_STACK};color:${BRAND.textBody};font-size:16px;line-height:1.65;">
            ${opts.bodyHtml}
          </td>
        </tr>
        <tr>
          <td>${footerHtml(opts.taxLine ?? false)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function wrapText(content: string, taxLine = false): string {
  return `${content.trim()}\n\n--\n\n${footerText(taxLine)}\n`;
}

// ─── Inline-style helpers ────────────────────────────────────────────────

export function h1(text: string): string {
  return `<h1 style="font-family:${SYSTEM_FONT_STACK};font-size:22px;font-weight:700;color:${BRAND.textBody};margin:0 0 16px 0;line-height:1.3;">${escapeHtml(text)}</h1>`;
}

export function p(html: string): string {
  return `<p style="margin:0 0 16px 0;color:${BRAND.textBody};font-size:16px;line-height:1.65;">${html}</p>`;
}

export function muted(html: string): string {
  return `<p style="margin:0 0 16px 0;color:${BRAND.textMuted};font-size:14px;line-height:1.55;font-style:italic;">${html}</p>`;
}

export function button(label: string, href: string): string {
  // The fill is declared three ways on purpose. White on #1B4D4A measures
  // 9.52:1, so the colors were never the problem — the markup was. The cell
  // carried `bgcolor` but no `background-color` in its style, and a client that
  // honours one and not the other, or that inverts them differently in dark
  // mode, left white text on a white button. Reported as almost unreadable.
  //
  // bgcolor covers the oldest clients, the inline background-color covers the
  // rest, and the border means that even if every fill is stripped the label
  // still sits inside a visible outline rather than vanishing. The anchor
  // repeats the fill so the padded area is colored even where the cell is not.
  const fill = BRAND.primary;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr><td bgcolor="${fill}" style="background-color:${fill};border:1px solid ${fill};border-radius:4px;">
    <a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 24px;font-family:${SYSTEM_FONT_STACK};font-size:15px;font-weight:600;color:#ffffff;background-color:${fill};text-decoration:none;border-radius:4px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

export function summaryTable(rows: { label: string; value: string }[]): string {
  const trs = rows
    .map(
      (r) => `<tr>
  <td style="padding:8px 0;font-size:14px;color:${BRAND.textMuted};vertical-align:top;">${escapeHtml(r.label)}</td>
  <td style="padding:8px 0;font-size:14px;color:${BRAND.textBody};text-align:right;font-weight:600;vertical-align:top;">${escapeHtml(r.value)}</td>
</tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;border-top:1px solid #efebe0;border-bottom:1px solid #efebe0;">${trs}</table>`;
}

export function signature(opts: { name: string; title?: string }): string {
  return `<p style="margin:24px 0 0 0;color:${BRAND.textBody};font-size:16px;line-height:1.55;">
    With gratitude,<br>
    <strong>${escapeHtml(opts.name)}</strong>${opts.title ? `<br><span style="color:${BRAND.textMuted};font-size:14px;">${escapeHtml(opts.title)}</span>` : ''}
  </p>`;
}

// ─── String helpers ──────────────────────────────────────────────────────

export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
