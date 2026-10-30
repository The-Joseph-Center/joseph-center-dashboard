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
