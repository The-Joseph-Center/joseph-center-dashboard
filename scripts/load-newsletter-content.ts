/**
 * Fills the backfilled newsletter rows with their copy.
 *
 * The bodies could not come from AWeber — its API returns a message's subject
 * and its stats but never its content — so each month was transcribed from
 * screenshots into `docs/newsletter-backfill/<month>/content.md`. That file is
 * the editable record: correct it there and run this again.
 *
 * Only the sections are written. The tag, the send date and the AWeber figures
 * were set by backfill-newsletters.ts and are left alone, as is a month whose
 * sections already have something in them — this never overwrites real work.
 *
 * Run from dashboard/:
 *   npx tsx scripts/load-newsletter-content.ts              # preview
 *   APPLY=yes npx tsx scripts/load-newsletter-content.ts    # write
 *   APPLY=yes npx tsx scripts/load-newsletter-content.ts 2026-06   # one month
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

const APPLY = process.env.APPLY === 'yes';
const only = process.argv[2];

const MONTHS: Record<string, string> = {
  '2026-02': 'february', '2026-03': 'march', '2026-04': 'april',
  '2026-05': 'may', '2026-06': 'june', '2026-07': 'july', '2026-08': 'august',
};

const DOCS = path.resolve('..', 'docs', 'newsletter-backfill');

interface Parsed {
  guest: string; program: string; previewText: string;
  section1: string; section2: string;
  stats: Record<string, string>;
  videos: { title: string; url: string }[];
  partners: { name: string; url: string }[];
}

/** The content file: a small front matter block, then one section per heading. */
export function parseContent(text: string): Parsed {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta: Record<string, string> = {};
  for (const line of (fm?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  const body = text.slice(fm?.[0].length ?? 0);
  const sections: Record<string, string> = {};
  let current = '';
  for (const line of body.split('\n')) {
    const h = /^## (.+)$/.exec(line);
    if (h) { current = h[1]!.trim().toLowerCase(); sections[current] = ''; continue; }
    if (current) sections[current] += `${line}\n`;
  }

  const bullets = (name: string) =>
    (sections[name] ?? '').split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim());

  // "Meals served: 457" — the label is what the tool shows beside the number.
  const stats: Record<string, string> = {};
  for (const line of bullets('stats')) {
    const i = line.lastIndexOf(':');
    if (i > 0) stats[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  return {
    guest: meta.guest ?? '',
    program: meta.program ?? '',
    previewText: meta.previewText ?? '',
    section1: (sections['section 1'] ?? '').trim(),
    section2: (sections['section 2'] ?? '').trim(),
    stats,
    // Titles only: the screenshots show link text, not the URLs behind it. The
    // tool's "pull last month's videos" button fills these from the channel.
    videos: bullets('videos').map((title) => ({ title, url: '' })),
    partners: bullets('partners').map((name) => ({ name, url: '' })),
  };
}

function connect() {
  const env = Object.fromEntries(
    fs.readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
  return createClient({
    url: env.TURSO_DATABASE_URL ?? process.env.TURSO_DATABASE_URL!,
    authToken: env.TURSO_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN!,
  });
}

async function run() {
  const db = connect();
  for (const [month, folder] of Object.entries(MONTHS)) {
    if (only && only !== month) continue;

    const file = path.join(DOCS, folder, 'content.md');
    if (!fs.existsSync(file)) { console.log(`${month}  no content.md — skipped`); continue; }

    const row = (await db.execute({ sql: 'SELECT section1, section2 FROM newsletters WHERE month = ?', args: [month] })).rows[0];
    if (!row) { console.log(`${month}  no row — run backfill-newsletters.ts first`); continue; }
    if (String(row.section1 ?? '').trim() || String(row.section2 ?? '').trim()) {
      console.log(`${month}  already has copy — left alone`);
      continue;
    }

    const c = parseContent(fs.readFileSync(file, 'utf8'));
    const missing = [
      !c.section1 && 'section 1', !c.section2 && 'section 2',
      !Object.keys(c.stats).length && 'stats', !c.videos.length && 'videos',
      !c.partners.length && 'partners', !c.guest && 'guest', !c.previewText && 'preview text',
    ].filter(Boolean);

    console.log(
      `${month}  ${c.guest || 'no guest'} · ${c.program || 'no program'} · ` +
      `${c.section1.length + c.section2.length} chars, ${Object.keys(c.stats).length} stats, ` +
      `${c.videos.length} videos, ${c.partners.length} partners` +
      (missing.length ? `\n          missing: ${missing.join(', ')}` : '')
    );
    if (!APPLY) continue;

    await db.execute({
      sql: `UPDATE newsletters
               SET guest_name = ?, guest_frame = ?, program = ?, section1 = ?, section2 = ?,
                   stats = ?, videos = ?, partners = ?, preview_text = ?,
                   updated_by = ?, updated_at = unixepoch()
             WHERE month = ?`,
      args: [
        c.guest,
        // Vangie is a board member, so July is the calling frame; the rest are guests.
        month === '2026-07' ? 'calling' : 'guest',
        c.program, c.section1, c.section2,
        JSON.stringify(c.stats), JSON.stringify(c.videos), JSON.stringify(c.partners),
        c.previewText, 'backfill from newsletter screenshots', month,
      ],
    });
  }

  console.log(APPLY ? '\nDone.' : '\nPreview only — run again with APPLY=yes to write.');
}

// Imported by the parser test without connecting to anything.
if (process.argv[1]?.endsWith('load-newsletter-content.ts')) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
