/**
 * Reauthorizes AWeber with the scopes the newsletter tooling needs.
 *
 * The token the site already has was issued for the signup form and carries
 * neither subscriber.read nor email.read. Scopes are not something configured
 * on the app — AWeber grants whatever the authorization URL asks for and the
 * person approves — so widening them means going through consent again.
 *
 * Use a SEPARATE AWeber app for the dashboard.
 *
 * The app the website uses has one redirect URL and one authorization, and the
 * live site's newsletter signup form depends on the token issued from it.
 * AWeber does not document whether a fresh authorization invalidates the
 * previous refresh token, and finding out the hard way means signups stop
 * working on the live site. A second app costs nothing and removes the
 * question: separate credentials, separate tokens, separate revocation, and its
 * redirect URL can point at localhost without touching anything shared.
 *
 * Setup, once:
 *   1. labs.aweber.com → My Apps → Create a New App
 *   2. OAuth Redirect URL: http://localhost:8911
 *   3. Leave the webhook events unchecked — they are notifications, not scopes,
 *      and nothing here needs them.
 *   4. Put that app's client id and secret in this project's .env
 *   5. node scripts/aweber-oauth.mjs --local
 *
 * If the dashboard is ever pointed at the website's app instead, run without
 * --local: it will use the registered redirect and ask for the code to be
 * pasted out of the address bar.
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
