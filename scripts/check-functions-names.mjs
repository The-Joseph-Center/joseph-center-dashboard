/**
 * Fails the build if a Netlify Function references a name that does not exist.
 *
 * This is the third distinct way a Function has reached production broken while
 * every local check passed:
 *
 *   1. a broken import      — caught by bundling (check-functions-bundle)
 *   2. a native-only module — caught by the same script's libsql rule
 *   3. an undefined name    — caught here
 *
 * `accessToken()` was called in admin-health without being imported. esbuild
 * bundles undefined identifiers happily — they are only a ReferenceError when
 * the line runs — and `vue-tsc` never looks at netlify/, so the function
 * deployed and threw "accessToken is not defined" on the Access page.
 *
 * Only TS2304/TS2552 fail the build. The functions carry other type errors,
 * almost all of them the Stripe SDK's types disagreeing with the API version
 * the code pins — real, but the code works, and retrofitting strict typing onto
 * functions that have run in production for months is a different job from
 * stopping a ReferenceError shipping. Those are printed as a count so they stay
 * visible rather than silently accepted.
 */
import { execFileSync } from 'node:child_process';

const FATAL = /error TS(2304|2552):/;   // "Cannot find name 'x'"

let output = '';
try {
  execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.functions.json'], { encoding: 'utf8' });
} catch (err) {
  output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
}

const lines = output.split('\n').filter((l) => l.includes('error TS'));
const fatal = lines.filter((l) => FATAL.test(l));
const other = lines.length - fatal.length;

if (fatal.length) {
  console.error('\ncheck-functions-names: a Function uses a name that does not exist.\n');
  for (const l of fatal) console.error(`  ${l.trim()}`);
  console.error('\nThis bundles and deploys, then throws at runtime.\n');
  process.exit(1);
}

console.log(
  `check-functions-names: no undefined names` +
  (other ? ` (${other} other type error${other === 1 ? '' : 's'}, mostly Stripe SDK version skew)` : '')
);
