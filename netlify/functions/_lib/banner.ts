/**
 * The site banner, as plain functions.
 *
 * Separated from the handler so the parts with rules in them can be tested
 * without Okta, Sanity or a request: the portable-text conversion both ways,
 * and the question of which banners compete for the one slot there is.
 */

/**
 * Could these two ever be on screen at the same moment?
 *
 * An absent start or end is open-ended in that direction, so a banner with no
 * dates at all overlaps everything — which is right: it is the one that shows
 * until somebody turns it off.
 */
export function windowsOverlap(
  a: { startsAt?: string; endsAt?: string },
  b: { startsAt?: string; endsAt?: string },
): boolean {
  const at = (v: string | undefined, fallback: number) => {
    const t = v ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? fallback : t;
  };
  const aStart = at(a.startsAt, -Infinity), aEnd = at(a.endsAt, Infinity);
  const bStart = at(b.startsAt, -Infinity), bEnd = at(b.endsAt, Infinity);
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Which banner the website would be showing at a given moment.
 *
 * There is one slot and banners can be scheduled, so two can be live at once —
 * a closure inside a month-long campaign is the ordinary case. The site resolves
 * that by showing the one that **ends soonest**, with an open-ended banner last:
 * a near end date means a closure or a deadline, and a campaign running for
 * weeks can wait its turn. Two that are equally open-ended fall back to the most
 * recently edited.
 *
 * This exists so the dashboard can say the same thing the site will do. The
 * rule lived only in a GROQ `order()` clause in SiteBanner.vue, which meant the
 * dashboard had to guess — and it guessed "first in the list", so with two live
 * banners it named the wrong one. The two repos cannot share code, so the test
 * beside this pins the behaviour and the GROQ clause is written to match.
 */
export interface Scheduled {
  _id: string;
  active?: boolean;
  startsAt?: string;
  endsAt?: string;
  _updatedAt?: string;
}

const startMs = (b: Scheduled) =>
  b.startsAt ? new Date(b.startsAt).getTime() : Number.NEGATIVE_INFINITY;
const endMs = (b: Scheduled) =>
  b.endsAt ? new Date(b.endsAt).getTime() : Number.POSITIVE_INFINITY;

/** On, started, and not yet finished. */
export const isShowingAt = (b: Scheduled, at: number): boolean =>
  b.active !== false && startMs(b) <= at && endMs(b) >= at;

export function bannerShowingAt<T extends Scheduled>(list: T[], at: number): T | null {
  const showing = list.filter((b) => isShowingAt(b, at));
  if (!showing.length) return null;
  return [...showing].sort((a, b) => {
    const ea = endMs(a), eb = endMs(b);
    // Both open-ended compare equal here — Infinity minus Infinity is NaN, so
    // the inequality has to be checked rather than subtracted blind.
    if (ea !== eb) return ea - eb;
    return (b._updatedAt ?? '').localeCompare(a._updatedAt ?? '');
  })[0]!;
}

/** Random enough for a _key; Sanity only requires uniqueness within the array. */
const key = () => Math.random().toString(36).slice(2, 14);

interface Span { _key: string; _type: 'span'; marks: string[]; text: string }

/**
 * Plain text (+ an optional trailing link) as a portable-text block.
 *
 * Matches the shape the existing banner document already uses — one block, spans
 * with a link annotation in markDefs — so the site renders a banner written here
 * identically to one written in Studio.
 */
export function toPortableText(text: string, linkLabel: string, linkHref: string) {
  const children: Span[] = [];
  const markDefs: { _key: string; _type: 'link'; href: string }[] = [];

  if (text) children.push({ _key: key(), _type: 'span', marks: [], text });

  if (linkHref && linkLabel) {
    const linkKey = key();
    markDefs.push({ _key: linkKey, _type: 'link', href: linkHref });
    // A space between the sentence and the link, so they do not run together.
    if (text) children.push({ _key: key(), _type: 'span', marks: [], text: ' ' });
    children.push({ _key: key(), _type: 'span', marks: ['strong', linkKey], text: linkLabel });
  }

  return [{ _key: key(), _type: 'block', style: 'normal', markDefs, children }];
}

/** The reverse, for editing something written in Studio. */
export function fromPortableText(blocks: unknown): { text: string; linkLabel: string; linkHref: string } {
  const out = { text: '', linkLabel: '', linkHref: '' };
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks as { children?: Span[]; markDefs?: { _key: string; href?: string }[] }[]) {
    const defs = new Map((block.markDefs ?? []).map((d) => [d._key, d.href ?? '']));
    for (const child of block.children ?? []) {
      const linkMark = (child.marks ?? []).find((m) => defs.has(m));
      if (linkMark) {
        out.linkLabel = child.text;
        out.linkHref = defs.get(linkMark) ?? '';
      } else {
        out.text += child.text;
      }
    }
  }
  out.text = out.text.trim();
  return out;
}
