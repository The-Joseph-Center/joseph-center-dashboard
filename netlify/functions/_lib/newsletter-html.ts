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

import {
  APPLY_URL, SECTION3_INTRO, episodesLabel, quoteTitle, section3Header, watchLabel, type Video,
} from './newsletter.ts';

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
/**
 * Which ink a button wears.
 *
 * White on Primary Green (#60B567) is about 2.5:1 and white on the gold is no
 * better — both fail at any text size. Deep Charcoal on the same two is about
 * 5:1, and white on Deep Green is about 7.4:1. So the dark backgrounds take
 * white and the light ones take charcoal, rather than every button taking
 * white because the first one did.
 */
const CHARCOAL_INK = new Set([PRIMARY_GREEN, GOLD, CREAM].map((c) => c.toLowerCase()));
const inkOn = (bg: string) => (CHARCOAL_INK.has(bg.toLowerCase()) ? CHARCOAL : '#ffffff');

export function button(label: string, href: string, color = PRIMARY_GREEN): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td align="center" bgcolor="${color}" style="border-radius:6px;">
    <a href="${absolute(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;font-weight:700;color:${inkOn(color)};text-decoration:none;border-radius:6px;">${esc(label)}</a>
  </td></tr>
</table>`;
}

/** The small uppercase line above a section, as "THIS MONTH IN NUMBERS" sets it. */
export function eyebrow(text: string): string {
  return `<p style="margin:0 0 6px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${WARM_GRAY};">${esc(text)}</p>`;
}

const BULLET = /^[-*•–—]\s+/;
const NUMBERED = /^\d+[.)]\s+/;

const ulHtml = (items: string[]) =>
  `<ul style="margin:0 0 16px;padding-left:22px;font-family:${FONT};font-size:16px;line-height:1.6;color:${CHARCOAL};">${
    items.map((l) => `<li style="margin:0 0 6px;">${inline(l.replace(BULLET, ''))}</li>`).join('')}</ul>`;

const olHtml = (items: string[]) =>
  `<ol style="margin:0 0 16px;padding-left:22px;font-family:${FONT};font-size:16px;line-height:1.6;color:${CHARCOAL};">${
    items.map((l) => `<li style="margin:0 0 6px;">${inline(l.replace(NUMBERED, ''))}</li>`).join('')}</ol>`;

/** A run of lines that are all one kind of thing. */
type Group = { kind: 'text' | 'ul' | 'ol'; lines: string[] };

function textHtml(lines: string[]): string {
  const first = lines[0] ?? '';
  if (first.startsWith('> ')) {
    const quoted = lines.map((l) => l.replace(/^>\s?/, '')).join(' ');
    return `<blockquote style="margin:0 0 16px;padding:12px 18px;border-left:4px solid ${GOLD};background-color:${CREAM};font-family:${FONT};font-size:16px;line-height:1.6;font-style:italic;color:${CHARCOAL};">${inline(quoted)}</blockquote>`;
  }
  if (lines.length === 1) {
    if (first.startsWith('### ')) return `<h3 style="margin:24px 0 10px;font-family:${FONT};font-size:18px;font-weight:700;color:${DEEP_GREEN};">${inline(first.slice(4))}</h3>`;
    if (first.startsWith('## ')) return `<h2 style="margin:32px 0 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${DEEP_GREEN};">${inline(first.slice(3))}</h2>`;
    if (first.startsWith('# ')) return `<h2 style="margin:32px 0 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${DEEP_GREEN};">${inline(first.slice(2))}</h2>`;
  }
  return `<p style="${P}">${inline(lines.join('\n'))}</p>`;
}

/**
 * The same plain writing format the rest of the dashboard uses, as email HTML.
 *
 * Lines are grouped before anything is rendered, because a paragraph and the
 * list under it arrive as one chunk whenever the writer — or the drafting
 * model — leaves no blank line between them:
 *
 *     **What we provide:**
 *     - Hot lunch at noon
 *     - Laundry services
 *
 * The old version asked whether *every* line in the chunk was a bullet, which
 * that is not, and fell through to a single <p>. HTML then collapsed the
 * newlines and the list went out as one run-on line of dashes, which is what
 * October's Section 2 did.
 */
export function blocksToHtml(text: string): string {
  const out: string[] = [];
  for (const raw of (text ?? '').split(/\n{2,}/)) {
    const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const groups: Group[] = [];
    for (const line of lines) {
      const kind: Group['kind'] = BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : 'text';
      const last = groups[groups.length - 1];
      if (last && last.kind === kind) last.lines.push(line);
      else groups.push({ kind, lines: [line] });
    }

    for (const g of groups) {
      // A lone "1. " line is far more often a sentence than a list of one.
      if (g.kind === 'ul') out.push(ulHtml(g.lines));
      else if (g.kind === 'ol' && g.lines.length > 1) out.push(olHtml(g.lines));
      else out.push(textHtml(g.lines));
    }
  }
  return out.join('\n');
}

export interface HtmlInput {
  /** 'YYYY-MM' — Section 3's header and the episodes label both derive from it. */
  month: string;
  monthName: string;
  guestName: string;
  section1: string;
  section2: string;
  stats: Record<string, string>;
  videos: Video[];
  section4: string;
  closing: string;
  signature: string;
  donateUrl: string;
  /** This month's Coffee Chat episode. No link, no button. */
  coffeeChatUrl?: string;
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

/**
 * Last month's episodes.
 *
 * The label and the line above it are fixed copy, held in newsletter.ts so the
 * plain-text version and this one cannot drift apart — both went missing from
 * October because each was built separately. Shorts are labelled as shorts:
 * YouTube's own durations already told us which is which.
 */
function videosHtml(videos: Video[], month: string): string {
  const live = videos.filter((v) => v.title?.trim() && v.url?.trim());
  if (!live.length) return '';
  return [
    `<p style="${P}">${esc(SECTION3_INTRO)}</p>`,
    `<p style="margin:0 0 10px;font-family:${FONT};font-size:16px;line-height:1.6;color:${CHARCOAL};"><strong>${esc(episodesLabel(month))}</strong></p>`,
    ...live.map((v) =>
      `<p style="margin:0 0 10px;font-family:${FONT};font-size:16px;line-height:1.5;color:${CHARCOAL};">▸ <a href="${absolute(v.url)}" style="color:${DEEP_GREEN};text-decoration:underline;">${esc(watchLabel(v))} ${esc(quoteTitle(v.title))}</a></p>`),
    `<p style="${P}">Want to be a guest on Coffee Chat with Mona?</p>`,
    button('Apply here →', APPLY_URL),
  ].join('\n');
}

export function newsletterHtml(d: HtmlInput): string {
  const body = [
    // The eyebrow is derived rather than written: it is the guest's name every
    // month, and one that has to be typed is one that keeps last month's.
    d.guestName ? eyebrow(`Coffee Chat with ${d.guestName}`) : '',
    blocksToHtml(d.section1),
    d.coffeeChatUrl
      ? button(`Watch ${d.guestName ? `${d.guestName}'s` : 'the'} full story on Coffee Chat with Mona →`, d.coffeeChatUrl, DEEP_GREEN)
      : '',
    blocksToHtml(d.section2),
    `<h2 style="margin:32px 0 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${DEEP_GREEN};">${esc(section3Header(d.month, d.monthName))}</h2>`,
    statsHtml(d.stats),
    videosHtml(d.videos, d.month),
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

/**
 * The same email, one section at a time.
 *
 * For the clipboard. A whole-message paste is no use when AWeber's editor
 * already holds a layout and only one block needs replacing, and the section
 * boundaries are where a person works anyway. Section 3 is assembled here
 * exactly as `newsletterHtml` assembles it, rather than being rebuilt by hand
 * somewhere else — that is how October lost the intro line and the episodes
 * label from the copy that went out.
 */
export function sectionsHtml(d: HtmlInput): Record<string, string> {
  const section1 = [
    d.guestName ? eyebrow(`Coffee Chat with ${d.guestName}`) : '',
    blocksToHtml(d.section1),
    d.coffeeChatUrl
      ? button(`Watch ${d.guestName ? `${d.guestName}'s` : 'the'} full story on Coffee Chat with Mona →`, d.coffeeChatUrl, DEEP_GREEN)
      : '',
  ].filter(Boolean).join('\n');

  const section3 = [
    `<h2 style="margin:32px 0 12px;font-family:${FONT};font-size:22px;font-weight:700;color:${DEEP_GREEN};">${esc(section3Header(d.month, d.monthName))}</h2>`,
    statsHtml(d.stats),
    videosHtml(d.videos, d.month),
  ].filter(Boolean).join('\n');

  return {
    section1,
    section2: blocksToHtml(d.section2),
    section3,
    section4: promoteButtons(blocksToHtml(d.section4), d.donateUrl),
    closing: blocksToHtml(d.closing),
  };
}
