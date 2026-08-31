/** Confirms the new token can do what the newsletter needs. Writes nothing. */
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n'))
  if (l.includes('=') && !l.trim().startsWith('#')) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1);

const { aweberConfig, missingScopes, allSubscribers } = await import('../netlify/functions/_lib/aweber.ts');
const cfg = aweberConfig();
if (!cfg) { console.error('AWEBER_* variables are missing from this .env — copy them from the frontend.'); process.exit(1); }

const missing = await missingScopes(cfg);
console.log('scopes still missing:', missing.length ? missing.join(', ') : 'none');
if (missing.length) process.exit(1);

const subs = await allSubscribers(cfg);
const active = subs.filter((s) => s.status === 'subscribed');
console.log(`subscribers: ${subs.length} total, ${active.length} active`);
const tagged = new Map();
for (const s of subs) for (const t of s.tags) tagged.set(t, (tagged.get(t) ?? 0) + 1);
console.log('tags in use:');
[...tagged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([t, n]) => console.log(`  ${String(n).padStart(4)}  ${t}`));
