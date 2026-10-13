/**
 * Removes a line from a duty's notes.
 *
 * The duties page shows what is in the table, and the table is seeded from the
 * marketing plan — so a note that turned out to be wrong, or a working remark
 * that was never meant to stay, can only be taken out here. The dashboard
 * edits status and owner; it does not edit the wording.
 *
 * Matches loosely on purpose: the stored text may use a curly apostrophe or an
 * em dash where you typed a straight one, and matching exactly would quietly
 * find nothing and report success.
 *
 * Run from dashboard/:
 *   npx tsx scripts/edit-duty-note.ts "allocate funds afterward"             # preview
 *   APPLY=yes npx tsx scripts/edit-duty-note.ts "allocate funds afterward"   # remove
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const APPLY = process.env.APPLY === 'yes';
const phrase = process.argv[2];

if (!phrase) {
  console.error('Usage: npx tsx scripts/edit-duty-note.ts "<a distinctive phrase from the line>"');
  process.exit(1);
}

/** Curly quotes, dashes and runs of space all made the same, so a near-match counts. */
const flatten = (s: string) =>
  s.toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—‒]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

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
  const needle = flatten(phrase);
  const { rows } = await db.execute('SELECT id, task, notes FROM marketing_duties WHERE notes IS NOT NULL');

  let hits = 0;
  for (const r of rows) {
    const id = String(r.id);
    const notes = String(r.notes ?? '');
    if (!flatten(notes).includes(needle)) continue;

    // A note is often several lines; only the offending one goes.
    const kept = notes.split(/\r?\n/).filter((line) => !flatten(line).includes(needle));
    const next = kept.join('\n').trim();
    hits++;

    console.log(`\n${id} — ${String(r.task ?? '').slice(0, 70)}`);
    console.log(`  before: ${notes.replace(/\n/g, ' ⏎ ')}`);
    console.log(`  after:  ${next ? next.replace(/\n/g, ' ⏎ ') : '(no notes)'}`);

    if (!APPLY) continue;
    await db.execute({
      sql: 'UPDATE marketing_duties SET notes = ? WHERE id = ?',
      args: [next || null, id],
    });
  }

  // Worth saying out loud: the same wording may sit in the task itself, where
  // this does not touch it.
  const inTask = rows.filter((r) => flatten(String(r.task ?? '')).includes(needle));
  if (inTask.length) {
    console.log(`\nAlso found in the task wording of ${inTask.length} dut${inTask.length === 1 ? 'y' : 'ies'} — not changed:`);
    for (const r of inTask) console.log(`  ${r.id} — ${r.task}`);
  }

  console.log(
    hits
      ? `\n${hits} note${hits === 1 ? '' : 's'} ${APPLY ? 'updated.' : 'would change — run again with APPLY=yes.'}`
      : '\nNothing matched that phrase.'
  );
}

run().catch((e) => { console.error(e); process.exit(1); });
