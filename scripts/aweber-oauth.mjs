/**
 * Reauthorizes AWeber with the scopes the newsletter tooling needs.
 *
 * The token the site already has was issued for the signup form and carries
 * neither subscriber.read nor email.read. Scopes are not something configured
 * on the app — AWeber grants whatever the authorization URL asks for and the
 * person approves — so widening them means going through consent again.
 *
 * Run once, locally:  node scripts/aweber-oauth.mjs
 *
 * By default this uses the redirect URL already registered on the app, so
 * nothing in the AWeber app settings has to change. That URL currently returns
 * a 404 page, which does not matter: the authorization code is in the address
 * bar either way, and this asks you to paste it.
 *
 * If you would rather not copy a code, change the app's OAuth Redirect URL to
 * http://localhost:8911 and run with --local; it will catch the redirect
 * itself. Change it back afterwards, since it is a single-value field and the
 * site's own integration uses it.
 */
import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';

const LOCAL = process.argv.includes('--local');
const LOCAL_PORT = 8911;

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const clientId = env.AWEBER_CLIENT_ID;
const clientSecret = env.AWEBER_CLIENT_SECRET;
const redirect = LOCAL
  ? `http://localhost:${LOCAL_PORT}`
  : (env.AWEBER_REDIRECT_URI || 'https://josephcentergj.com/aweber-callback');

if (!clientId || !clientSecret) {
  console.error('AWEBER_CLIENT_ID and AWEBER_CLIENT_SECRET must be in .env first.');
  console.error('They are in the frontend .env — copy them across.');
  process.exit(1);
}

// Requested here, not configured on the app. This is the whole point of the run.
const SCOPES = ['account.read', 'list.read', 'subscriber.read', 'subscriber.write', 'email.read', 'email.write'];

const url = new URL('https://auth.aweber.com/oauth2/authorize');
url.searchParams.set('client_id', clientId);
url.searchParams.set('redirect_uri', redirect);
url.searchParams.set('response_type', 'code');
url.searchParams.set('scope', SCOPES.join(' '));

async function exchange(code) {
  const res = await fetch('https://auth.aweber.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    // Must match the authorize request exactly, or AWeber rejects it.
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    console.error('\nNo refresh token came back.');
    console.error(data.error_description || data.error || JSON.stringify(data));
    process.exit(1);
  }
  console.log('\nScopes granted:', data.scope ?? '(not reported)');
  console.log('\nReplace AWEBER_REFRESH_TOKEN in .env and in Netlify with this, then clear your scrollback:\n');
  console.log(`AWEBER_REFRESH_TOKEN=${data.refresh_token}\n`);
  console.log('The old token keeps working for the signup form until you replace it.');
  console.log('Then check it:  npx tsx scripts/check-aweber.mjs\n');
}

console.log('\nRequesting these scopes:\n  ' + SCOPES.join('\n  '));
console.log(`\nRedirecting to: ${redirect}${LOCAL ? '' : '  (a 404 page — that is fine)'}`);
console.log('\nOpen this, signed in to the AWeber account that owns the list:\n');
console.log(url.toString() + '\n');

if (LOCAL) {
  console.log('Waiting for the redirect…\n');
  const server = createServer(async (req, res) => {
    const code = new URL(req.url, redirect).searchParams.get('code');
    if (!code) { res.writeHead(400).end('No code in the redirect.'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' })
       .end('<p style="font:16px system-ui;padding:2rem">Done. Close this tab and look at the terminal.</p>');
    await exchange(code);
    server.close();
    process.exit(0);
  });
  server.listen(LOCAL_PORT);
} else {
  console.log('You will land on a 404 page. Copy the `code=` value out of the address bar.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\nPaste the code (or the whole URL): ')).trim();
  rl.close();
  // Accept either the bare code or the full redirect URL pasted straight in.
  const code = answer.includes('code=') ? new URL(answer).searchParams.get('code') : answer;
  if (!code) { console.error('No code found in that.'); process.exit(1); }
  await exchange(code);
}
