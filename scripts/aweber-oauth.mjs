/**
 * Re-authorizes AWeber with the scopes the newsletter tooling needs.
 *
 * The token the site has was issued for newsletter signups only — it can add a
 * subscriber and nothing else. Reading the list or applying a tag needs wider
 * scopes, and AWeber only widens them by going through consent again.
 *
 * Run once, locally:  node scripts/aweber-oauth.mjs
 *
 * Before running, add http://localhost:8911 as a redirect URI on the app at
 * labs.aweber.com → My Apps.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = 8911;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPES = ['account.read', 'list.read', 'subscriber.read', 'subscriber.write', 'email.read', 'email.write'];

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const clientId = env.AWEBER_CLIENT_ID;
const clientSecret = env.AWEBER_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('AWEBER_CLIENT_ID and AWEBER_CLIENT_SECRET must be in .env first.');
  process.exit(1);
}

const url = new URL('https://auth.aweber.com/oauth2/authorize');
url.searchParams.set('client_id', clientId);
url.searchParams.set('redirect_uri', REDIRECT);
url.searchParams.set('response_type', 'code');
url.searchParams.set('scope', SCOPES.join(' '));

console.log('\nScopes being requested:\n  ' + SCOPES.join('\n  '));
console.log('\nOpen this, signed in to the AWeber account that owns the list:\n');
console.log(url.toString());
console.log('\nWaiting for the redirect…\n');

const server = createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.writeHead(400).end('No code in the redirect.'); return; }

  const tokenRes = await fetch('https://auth.aweber.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
  });
  const data = await tokenRes.json();

  if (!tokenRes.ok || !data.refresh_token) {
    res.writeHead(500).end('Something went wrong — check the terminal.');
    console.error('\nNo refresh token came back.');
    console.error(data.error_description || data.error || JSON.stringify(data));
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/html' })
     .end('<p style="font:16px system-ui;padding:2rem">Done. Close this tab and look at the terminal.</p>');

  console.log('Replace AWEBER_REFRESH_TOKEN in .env and in Netlify with this, then clear your scrollback:\n');
  console.log(`AWEBER_REFRESH_TOKEN=${data.refresh_token}\n`);
  console.log('The old token keeps working for the signup form until you replace it.\n');
  server.close();
  process.exit(0);
});
server.listen(PORT);
