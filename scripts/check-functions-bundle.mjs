/**
 * Fails the build if any Netlify Function cannot be bundled.
 *
 * `vue-tsc -b && vite build` compiles the SPA only. The functions are bundled
 * by Netlify, on Netlify, after the build command has already succeeded — so a
 * broken import in a function passes every local check and fails the deploy.
 *
 * That is exactly how `admin-access.ts` shipped importing `RULES` from
 * capabilities.ts while RULES was not exported: the SPA never imported it, so
 * nothing local ever resolved that import. This runs the same bundle step
 * Netlify runs, locally, before the deploy can be reached.
 *
 * esbuild is already present as a Vite dependency, and bundling 28 functions
 * takes well under a second.
 */
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'netlify/functions';
const entries = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
  .map((f) => join(DIR, f));

if (!entries.length) {
  console.log('check-functions-bundle: no functions to check.');
  process.exit(0);
}

try {
  await build({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,            // nothing is emitted; this is a check, not a build
    // Required even with write:false when there is more than one entry point.
    // Nothing is created at this path.
    outdir: 'node_modules/.cache/fn-bundle-check',
    logLevel: 'silent',
    external: ['@netlify/*'],
  });
  console.log(`check-functions-bundle: ${entries.length} function(s) bundle cleanly.`);
} catch (err) {
  console.error('\ncheck-functions-bundle: a Netlify Function does not bundle.\n');
  for (const e of err.errors ?? []) {
    const loc = e.location ? `${e.location.file}:${e.location.line}:${e.location.column}` : '';
    console.error(`  ${e.text}`);
    if (loc) console.error(`    ${loc}`);
  }
  console.error('\nThis would have failed the Netlify deploy after a green local build.\n');
  process.exit(1);
}
