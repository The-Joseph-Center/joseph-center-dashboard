/**
 * Portable text <-> a plain-text writing format.
 *
 * The site stores post bodies as portable text. That is the right storage and
 * the wrong editing surface for someone who does not have one of the three
 * Sanity seats — which is the entire reason this editor exists.
 *
 * The format is deliberately markdown-shaped rather than actually markdown: it
 * only supports what the schema can hold, so there is nothing to type that
 * cannot be saved. Anything richer stays in Studio.
 *
 * The hard requirement is fidelity. These convert existing posts for editing
 * and convert them back on save, so anything the parser cannot represent is
 * content someone loses. Two defences:
 *
 *   1. Images survive as an opaque placeholder line carrying their asset ref,
 *      so a body with images in the middle of it round-trips exactly.
 *   2. `unsupported()` reports any block this cannot represent, and the editor
 *      refuses to open that post rather than silently flattening it.
 */

export interface Span { _key?: string; _type: 'span'; marks?: string[]; text: string }
export interface MarkDef { _key: string; _type: string; href?: string }
export interface Block {
  _key?: string; _type: string; style?: string; listItem?: string; level?: number;
  children?: Span[]; markDefs?: MarkDef[];
  asset?: { _ref?: string; _type?: string }; alt?: string; caption?: string;
}

const key = () => Math.random().toString(36).slice(2, 14);

const STYLES: Record<string, string> = { h2: '## ', h3: '### ', blockquote: '> ' };
// Longest prefix first, so "### " is not read as "## " plus a stray hash.
// "# " maps to h2 because the post title is the page's only h1 — a body
// heading written with one hash is a second-level heading in intent.
const STYLE_OF: Record<string, string> = { '### ': 'h3', '## ': 'h2', '# ': 'h2', '> ': 'blockquote' };

/**
 * Bullet markers people and models actually type.
 *
 * Only "- " was recognized. Anything else fell through to the paragraph branch
 * and a three-item list silently became one run-on line — "— one — two". The
 * canonical form written back out is always "- ", so a list typed with
 * asterisks is normalized rather than lost.
 */
const BULLET = /^[-*•–—]\s+/;
const NUMBERED = /^\d+[.)]\s+/;

/** Block types and styles this format can carry without loss. */
export function unsupported(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  const bad = new Set<string>();
  for (const b of blocks as Block[]) {
    if (b._type === 'image') continue;
    if (b._type !== 'block') { bad.add(b._type); continue; }
    if (b.style && b.style !== 'normal' && !STYLES[b.style]) bad.add(`style:${b.style}`);
    if (b.listItem && b.listItem !== 'bullet' && b.listItem !== 'number') bad.add(`list:${b.listItem}`);
    for (const child of b.children ?? []) {
      for (const m of child.marks ?? []) {
        const isDef = (b.markDefs ?? []).some((d) => d._key === m);
        if (!isDef && m !== 'strong' && m !== 'em') bad.add(`mark:${m}`);
      }
    }
    for (const d of b.markDefs ?? []) if (d._type !== 'link') bad.add(`annotation:${d._type}`);
  }
  return [...bad];
}

/**
 * Whitespace at the very edge of a block is dropped, in both directions.
 *
 * Some imported content carries a leading newline inside the first span. A
 * line-based format cannot tell that apart from the blank line between
 * paragraphs, and HTML collapses it to nothing anyway, so the rendered page is
 * identical either way. Normalizing it is the honest choice; pretending to
 * preserve it would only mean losing it silently on the first save.
 */
function spansToText(block: Block): string {
  const defs = new Map((block.markDefs ?? []).map((d) => [d._key, d]));
  let out = '';
  for (const child of block.children ?? []) {
    let t = child.text ?? '';
    const marks = child.marks ?? [];
    const link = marks.map((m) => defs.get(m)).find(Boolean);
    if (marks.includes('strong')) t = `**${t}**`;
    if (marks.includes('em')) t = `*${t}*`;
    if (link?.href) t = `[${t}](${link.href})`;
    out += t;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function toText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const lines: string[] = [];
  // Consecutive list items are one list to a reader, so they are joined by a
  // single newline. Separating them by blank lines like paragraphs made an
  // edited post look like it had lost its bullets.
  let counter = 0;
  for (const [i, b] of (blocks as Block[]).entries()) {
    const prev = (blocks as Block[])[i - 1];
    const continuesList = !!b.listItem && prev?.listItem === b.listItem;
    if (!b.listItem) counter = 0;

    if (b._type === 'image') {
      // Opaque on purpose: the editor shows it as a placeholder and writes the
      // same asset back, so an image mid-article is not something the writer
      // has to re-upload just because they fixed a typo above it.
      const ref = b.asset?._ref ?? '';
      lines.push(`![image](${ref}${b.alt ? ` "${b.alt}"` : ''}${b.caption ? ` |${b.caption}` : ''})`);
      continue;
    }
    const text = spansToText(b);
    let line: string;
    if (b.listItem === 'bullet') line = `- ${text}`;
    else if (b.listItem === 'number') line = `${++counter}. ${text}`;
    else line = `${STYLES[b.style ?? 'normal'] ?? ''}${text}`;

    if (continuesList) lines[lines.length - 1] += `\n${line}`;
    else lines.push(line);
  }
  return lines.join('\n\n');
}

const INLINE = /(\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|\*[^*]+\*)/;

function textToSpans(text: string): { children: Span[]; markDefs: MarkDef[] } {
  const children: Span[] = [];
  const markDefs: MarkDef[] = [];
  for (const part of text.split(INLINE).filter((p) => p !== '' && p !== undefined)) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^\[([^\]]*)\]\(([^)]*)\)$/))) {
      const k = key();
      markDefs.push({ _key: k, _type: 'link', href: m[2]! });
      children.push({ _key: key(), _type: 'span', marks: [k], text: m[1]! });
    } else if ((m = part.match(/^\*\*([^*]+)\*\*$/))) {
      children.push({ _key: key(), _type: 'span', marks: ['strong'], text: m[1]! });
    } else if ((m = part.match(/^\*([^*]+)\*$/))) {
      children.push({ _key: key(), _type: 'span', marks: ['em'], text: m[1]! });
    } else {
      children.push({ _key: key(), _type: 'span', marks: [], text: part });
    }
  }
  if (!children.length) children.push({ _key: key(), _type: 'span', marks: [], text: '' });
  return { children, markDefs };
}

export function fromText(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\n{2,}/)) {
    const line = raw.trim();
    if (!line) continue;

    const img = line.match(/^!\[image\]\(([^\s")|]*)(?:\s+"([^"]*)")?(?:\s*\|([^)]*))?\)$/);
    if (img) {
      blocks.push({
        _key: key(), _type: 'image',
        asset: { _ref: img[1]!, _type: 'reference' },
        ...(img[2] ? { alt: img[2] } : {}),
        ...(img[3] ? { caption: img[3].trim() } : {}),
      });
      continue;
    }

    // A run of list items separated by single newlines is one paragraph of
    // input but several blocks of output.
    const listLines = line.split('\n').map((l) => l.trim()).filter(Boolean);
    const allBullets = listLines.every((l) => BULLET.test(l));
    const allNumbers = listLines.every((l) => NUMBERED.test(l));
    if (listLines.length && (allBullets || allNumbers)) {
      for (const item of listLines) {
        const body = item.replace(BULLET, '').replace(NUMBERED, '');
        blocks.push({
          _key: key(), _type: 'block', style: 'normal',
          listItem: allBullets ? 'bullet' : 'number', level: 1,
          ...textToSpans(body),
        });
      }
      continue;
    }

    const prefix = Object.keys(STYLE_OF).find((p) => line.startsWith(p));
    const style = prefix ? STYLE_OF[prefix]! : 'normal';
    blocks.push({
      _key: key(), _type: 'block', style,
      ...textToSpans(prefix ? line.slice(prefix.length) : line),
    });
  }
  return blocks;
}
