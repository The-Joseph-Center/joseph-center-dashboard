import { renderShell, wrapText, h1, p, muted, button, escapeHtml, BRAND } from './email-shared.ts';
// NOTE: the '.ts' is load-bearing. _lib siblings are imported extensionlessly
// elsewhere in this folder, which is why those modules cannot be imported by
// `node --test` — Node's native TS support resolves real paths only. Spelling
// it out keeps this template testable, and esbuild resolves it either way.

/**
 * The invitation that asks someone to apply as a Coffee Chat guest.
 *
 * This is the front of a pipeline that already exists: the invitation brings
 * them to /media/apply, the application lands in the Submissions inbox, and
 * CoffeeChatScheduler proposes filming slots from the days and times they
 * chose. So the email's whole job is to get the application filled in — it
 * deliberately does not propose a time, because the times come from them.
 *
 * It is a personal note, not an announcement. The signature is the staff
 * member who sent it and replies go to their own address, so a guest who has a
 * question answers the human who invited them rather than a shared inbox.
 */

export interface CoffeeChatInviteVars {
  /**
   * Used verbatim in the greeting — "Hi {name},".
   *
   * Not parsed into a first name on purpose. "Dr. Alvarez" and "Jane" and
   * "Jane Smith" are all things a sender might reasonably want in that line,
   * and guessing which part to keep is how an invitation goes out addressed to
   * "Hi Dr.,". The sender types exactly what should appear, and the preview
   * shows them that it does.
   */
  name: string;
  /** Where the button points — the public guest application. */
  applyUrl: string;
  /** Who it is from, for the closing line. */
  senderName: string;
  senderTitle?: string | null;
}

const INTRO =
  "conversation series about the people and organizations serving our community";

export function coffeeChatInviteEmail(v: CoffeeChatInviteVars) {
  const name = v.name.trim();
  const subject = 'An invitation to be a guest on Coffee Chat';
  const previewText =
    'We would love to have you on the show — the application takes about five minutes.';

  const closingHtml = [
    'Looking forward to hearing from you,<br>',
    `<strong>${escapeHtml(v.senderName)}</strong>`,
    v.senderTitle
      ? `<br><span style="color:${BRAND.textMuted};font-size:14px;">${escapeHtml(v.senderTitle)}</span>`
      : '',
  ].join('');

  const bodyHtml = [
    h1('Would you join us on Coffee Chat?'),
    p(`Hi ${escapeHtml(name)},`),
    p(
      `I would like to invite you to be a guest on <strong>Coffee Chat</strong>, ${escapeHtml(
        BRAND.name,
      )}'s ${INTRO}.`,
    ),
    p(
      'If you are interested, the next step is a short application. It asks what you would like to talk about, and which days and times suit you, so we can find a filming slot that works for everyone.',
    ),
    button('Apply to be a guest', v.applyUrl),
    muted(
      'It takes about five minutes. Once we have it, we will be in touch to confirm a time to film.',
    ),
    p(closingHtml),
  ].join('\n');

  const text = wrapText(
    [
      'WOULD YOU JOIN US ON COFFEE CHAT?',
      '',
      `Hi ${name},`,
      '',
      `I would like to invite you to be a guest on Coffee Chat, ${BRAND.name}'s ${INTRO}.`,
      '',
      'If you are interested, the next step is a short application. It asks what you would',
      'like to talk about, and which days and times suit you, so we can find a filming slot',
      'that works for everyone.',
      '',
      `Apply here: ${v.applyUrl}`,
      '',
      'It takes about five minutes. Once we have it, we will be in touch to confirm a time',
      'to film.',
      '',
      'Looking forward to hearing from you,',
      v.senderName,
      ...(v.senderTitle ? [v.senderTitle] : []),
    ].join('\n'),
  );

  return { subject, html: renderShell({ previewText, bodyHtml }), text };
}
