/**
 * Email HTML for the newsletter.
 *
 * AWeber's drag-and-drop builder has an HTML mode, so this produces a block
 * that can be pasted straight in. Email HTML is not web HTML: styles are inline
 * because Gmail strips <style> blocks, buttons are table cells because Outlook
 * ignores padding on anchors, and layout is a table because flexbox and grid do
 * not exist in half the clients this will land in.
 *
 * Colors are The Joseph Center's, from section 3 of the brand reference.
 */

const DEEP_GREEN = '#1D5F55';
const PRIMARY_GREEN = '#60B567';
const GOLD = '#CAA230';
const CHARCOAL = '#2C3531';
const WARM_GRAY = '#6B6B5D';
const CREAM = '#F5F1E8';

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A bare domain needs a scheme or mail clients treat it as a relative path. */
const absolute = (url: string) =>
  /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`;

function inline(text: string): string {
  return esc(text)
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, label: string, href: string) =>
      `<a href="${absolute(href)}" style="color:${DEEP_GREEN};text-decoration:underline;">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

const P = `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.6;color:${CHARCOAL};`;

/**
 * A call to action.
 *
 * Built as a table with bgcolor on the cell — an anchor with padding collapses
 * in Outlook, which is exactly where a donate button must not collapse.
 */
export function button(label: string, href: string, color = PRIMARY_GREEN): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td align="center" bgcolor="${color}" style="border-radius:6px;">
    <a href="${absolute(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(label)}</a>
  </td></tr>
</table>`;
}

/** The same plain writing format the rest of the dashboard uses, as email HTML. */
export function blocksToHtml(text: string): string {
  const out: string[] = [];
  for (const raw of (text ?? '').split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;

    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    const bullets = lines.every((l) => /^[-*•–—]\s+/.test(l));
    const numbers = lines.every((l) => /^\d+[.)]\s+/.test(l));

    if (lines.length && bullets) {
      out.push(`<ul style="margin:0 0 16px;padding-left:22px;font-family:${FONT};font-size:16px;line-height:1.6;color:${CHARCOAL};">${
        lines.map((l) => `<li style="margin:0 0 6px;">${inline(l.replace(/^[-*•–—]\s+/, ''))}</li>`).join('')}</ul>`);
    } else if (lines.length > 1 && numbers) {
      out.push(`<ol style="margin:0 0 16px;padding-left:22px;font-family:${FONT};font-size:16px;line-height:1.6;color:${CHARCOAL};">${
        lines.map((l) => `<li style="margin:0 0 6px;">${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`);
    } else if (chunk.startsWith('### ')) {
      out.push(`<h3 style="margin:24px 0 10px;font-family:${FONT};font-size:18px;font-weight:700;color:${DEEP_GREEN};">${inline(chunk.slice(4))}</h3>`);
    } else if (chunk.startsWith('## ')) {
      out.push(`<h2 style="margin:32px 0 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${DEEP_GREEN};">${inline(chunk.slice(3))}</h2>`);
    } else if (chunk.startsWith('# ')) {
      out.push(`<h2 style="margin:32px 0 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${DEEP_GREEN};">${inline(chunk.slice(2))}</h2>`);
    } else if (chunk.startsWith('> ')) {
      out.push(`<blockquote style="margin:0 0 16px;padding:12px 18px;border-left:4px solid ${GOLD};background-color:${CREAM};font-family:${FONT};font-size:16px;line-height:1.6;font-style:italic;color:${CHARCOAL};">${inline(chunk.slice(2))}</blockquote>`);
    } else {
      out.push(`<p style="${P}">${inline(chunk)}</p>`);
    }
  }
  return out.join('\n');
}

export interface HtmlInput {
  monthName: string;
  section1: string;
  section2: string;
  section3Header: string;
  stats: Record<string, string>;
  videos: { title: string; url: string }[];
  section4: string;
  closing: string;
  signature: string;
  donateUrl: string;
  coffeeChatFormUrl: string;
}

/** The stats, as a bordered block rather than a bullet list — they are the proof. */
function statsHtml(stats: Record<string, string>): string {
  const rows = Object.entries(stats).filter(([, v]) => String(v ?? '').trim());
  if (!rows.length) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background-color:${CREAM};border-radius:6px;">
  <tr><td style="padding:18px 20px;">
    <p style="margin:0 0 12px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${WARM_GRAY};">This Month in Numbers</p>
    ${rows.map(([k, v]) => `<p style="margin:0 0 8px;font-family:${FONT};font-size:16px;line-height:1.5;color:${CHARCOAL};"><strong style="color:${DEEP_GREEN};">${esc(String(v))}</strong> &nbsp;${esc(k)}</p>`).join('\n    ')}
  </td></tr>
</table>`;
}

function videosHtml(videos: { title: string; url: string }[], formUrl: string): string {
  const live = videos.filter((v) => v.title?.trim() && v.url?.trim());
  if (!live.length) return '';
  return `${live.map((v) =>
    `<p style="margin:0 0 10px;font-family:${FONT};font-size:16px;line-height:1.5;color:${CHARCOAL};">▸ <a href="${absolute(v.url)}" style="color:${DEEP_GREEN};text-decoration:underline;">Watch: &ldquo;${esc(v.title)}&rdquo;</a></p>`
  ).join('\n')}
<p style="${P}">Want to be a guest? <a href="${absolute(formUrl)}" style="color:${DEEP_GREEN};text-decoration:underline;">Apply here</a>.</p>`;
}

export function newsletterHtml(d: HtmlInput): string {
  const body = [
    blocksToHtml(d.section1),
    blocksToHtml(d.section2),
    `<h2 style="margin:32px 0 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${DEEP_GREEN};">${esc(d.section3Header)}</h2>`,
    statsHtml(d.stats),
    videosHtml(d.videos, d.coffeeChatFormUrl),
    blocksToHtml(d.section4),
    blocksToHtml(d.closing),
    `<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e2ded2;font-family:${FONT};font-size:16px;line-height:1.6;color:${CHARCOAL};">&mdash; ${esc(d.signature)}</p>`,
  ].filter(Boolean).join('\n\n');

  // 600px is the width every email client agrees on, and the outer table is
  // what centers it in the ones that ignore margin:auto.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#FAFAF7;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;">
      <tr><td style="padding:32px 28px;">
${body.split('\n').map((l) => (l ? '        ' + l : l)).join('\n')}
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

/**
 * Turn the CTA lines in a Section 4 template into real buttons.
 *
 * The templates carry them as ordinary markdown links so the plain-text copy
 * stays readable; in HTML the two donate CTAs should look like buttons, because
 * a donate ask that renders as a sentence gets read past.
 */
export function promoteButtons(html: string, donateUrl: string): string {
  return html
    .replace(
      new RegExp(`<p style="[^"]*"><a href="[^"]*${donateUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^"]*"[^>]*>Become a Monthly Stability Partner[^<]*</a></p>`, 'g'),
      button('Become a Monthly Stability Partner', donateUrl)
    )
    .replace(
      new RegExp(`<p style="[^"]*"><a href="[^"]*${donateUrl.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^"]*"[^>]*>Give One Time[^<]*</a></p>`, 'g'),
      button('Give One Time', donateUrl, GOLD)
    );
}
