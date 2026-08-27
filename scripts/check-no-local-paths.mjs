/**
 * Fails the build if a source file imports an absolute path from a developer's
 * machine.
 *
 * This exists because a stray `sed` during testing rewrote a shared import to
 * /Volumes/... and it shipped. Nothing caught it: the path resolves on the
 * machine it was written on, so typecheck, build and the Function bundle all
 * passed locally and only Netlify — the first environment where that directory
 * does not exist — failed. Anything that is only correct on one computer needs
 * a check that does not run on that computer's assumptions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'netlify', 'scripts'];
const SUSPECT = /(['"`])(\/Users\/|\/Volumes\/|[A-Za-z]:\\\\)/;

const offenders = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx|js|mjs|vue)$/.test(entry)) continue;
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      if (SUSPECT.test(line)) offenders.push(`${full}:${i + 1}  ${line.trim()}`);
    });
  }
}
for (const r of ROOTS) { try { walk(r); } catch { /* optional directory */ } }

if (offenders.length) {
  console.error('\nAbsolute local paths found — these only resolve on one machine:\n');
  offenders.forEach((o) => console.error('  ' + o));
  console.error('\nUse the @/ alias or a relative path instead.\n');
  process.exit(1);
}
