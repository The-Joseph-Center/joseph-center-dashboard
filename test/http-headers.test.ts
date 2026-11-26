import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { JSON_HEADERS } from '../netlify/functions/_lib/http.ts';

const DIR = join(import.meta.dirname, '..', 'netlify', 'functions');
const functions = readdirSync(DIR).filter((f) => f.endsWith('.ts'));
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

test('the shared JSON headers forbid storing the response', () => {
  assert.equal(JSON_HEADERS['Content-Type'], 'application/json');
  assert.equal(JSON_HEADERS['Cache-Control'], 'no-store');
});

test('no function declares its own JSON headers', () => {
  // Every one of these sits behind Okta. A local
  // `{ 'Content-Type': 'application/json' }` is an authenticated body a
  // browser may cache heuristically and a shared cache may keep.
  const offenders = functions.filter((f) => /const JSON_HEADERS\s*=/.test(read(f)));
  assert.deepEqual(offenders, [], 'import JSON_HEADERS from ./_lib/http instead');
});

test('every function using JSON headers imports the shared ones', () => {
  const missing = functions.filter((f) => {
    const src = read(f);
    return src.includes('JSON_HEADERS') && !/from '\.\/_lib\/http'/.test(src);
  });
  assert.deepEqual(missing, []);
});

test('the auth denial is not cacheable either', () => {
  // A cached 401 is a sign-in that cannot be retried without clearing the
  // cache.
  const src = readFileSync(join(DIR, '_lib', 'verify-okta.ts'), 'utf8');
  const denial = src.slice(src.indexOf('export function denial'));
  assert.match(denial.slice(0, 400), /'Cache-Control': 'no-store'/);
});

test('a function that wants caching says so for itself', () => {
  // analytics-proxy caches deliberately and must keep its own headers rather
  // than being folded into the shared no-store ones.
  const src = read('analytics-proxy.ts');
  assert.ok(!src.includes("from './_lib/http'"), 'analytics-proxy opts out');
  assert.match(src, /'Cache-Control': 'private, max-age=300'/);
});
