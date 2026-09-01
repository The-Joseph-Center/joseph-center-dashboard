#!/usr/bin/env node
/**
 * One-time Google consent, to get a refresh token for the stats sheet and for
 * reading free/busy from Mona's calendar.
 *
 * Run once, locally:  node scripts/google-oauth.mjs
 *
 * This exists because the organization enforces
 * `iam.disableServiceAccountKeyCreation`, so a service account key cannot be
 * downloaded. An OAuth client is not covered by that policy: a person grants
 * read-only access to sheets they can already open, and the resulting refresh
 * token is what the dashboard stores.
 *
 * The redirect is a loopback server on this machine, so nothing is pasted
 * between windows and no code goes anywhere but here. The refresh token is
 * printed once — put it straight into .env and Netlify, and do not paste it
 * anywhere else.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Both read-only. calendar.freebusy is the narrowest calendar scope there is:
// it answers "is this block taken?" and returns no event titles, attendees or
// descriptions — which is the whole question the scheduler asks, and nothing
// more. Re-running this after adding a scope REPLACES the stored refresh
// token, so the new one has to go into the local environment file and Netlify
// together, or sheet lookups keep working here while failing in production.
const SCOPE = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/calendar.freebusy',
].join(' ');
const PORT = 8910;
const REDIRECT = `http://localhost:${PORT}`;

// Read the client id/secret from .env so they are typed in one place only.
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first.');
  process.exit(1);
}

// PKCE, so the code is useless to anything that did not start this flow.
const verifier = randomBytes(48).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');

const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.searchParams.set('client_id', clientId);
url.searchParams.set('redirect_uri', REDIRECT);
url.searchParams.set('response_type', 'code');
url.searchParams.set('scope', SCOPE);
url.searchParams.set('access_type', 'offline');
url.searchParams.set('prompt', 'consent');       // force a refresh token every time
url.searchParams.set('code_challenge', challenge);
url.searchParams.set('code_challenge_method', 'S256');

console.log('\nOpen this in the browser, signed in as the account that can see the sheet:\n');
console.log(url.toString());
console.log('\nWaiting for the redirect…\n');

const server = createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.writeHead(400).end('No code in the redirect.'); return; }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT, grant_type: 'authorization_code', code_verifier: verifier,
    }),
  });
  const data = await tokenRes.json();

  if (!tokenRes.ok || !data.refresh_token) {
    res.writeHead(500).end('Something went wrong — check the terminal.');
    console.error('\nNo refresh token came back.');
    console.error(data.error_description || data.error || JSON.stringify(data));
    console.error('\nIf it says the app is unverified, set the consent screen User type to Internal.');
    server.close();
    process.exit(1);
  }

  res.writeHead(200, { 'Content-Type': 'text/html' })
     .end('<p style="font:16px system-ui;padding:2rem">Done. Close this tab and look at the terminal.</p>');

  await saveSecret('GOOGLE_OAUTH_REFRESH_TOKEN', data.refresh_token);
  console.log('Then check it works:  npx tsx scripts/check-sheet.mjs\n');
  server.close();
  process.exit(0);
});
server.listen(PORT);

/**
 * Writes a variable into .env without ever printing it.
 *
 * The previous version printed the refresh token to stdout, which is precisely
 * how a credential ends up pasted into a chat window — it happened on this
 * project more than once. Nothing sensitive reaches the terminal now: the value
 * goes into .env directly, and onto the clipboard so it can be pasted into
 * Netlify without opening the file at all.
 */
async function saveSecret(name, value) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const envPath = new URL('../.env', import.meta.url);
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (i === -1) lines.push(`${name}=${value}`);
  else lines[i] = `${name}=${value}`;
  writeFileSync(envPath, lines.join('\n'));

  let clipped = false;
  try {
    const { spawnSync } = await import('node:child_process');
    // macOS only; failure here is not worth mentioning twice.
    clipped = spawnSync('pbcopy', { input: value }).status === 0;
  } catch { /* no clipboard, no problem */ }

  console.log(`\n${name} written to .env${clipped ? ' and copied to the clipboard' : ''}.`);
  console.log('Paste it into Netlify from the clipboard — no need to open the file.');
  console.log('It was not printed here, so nothing in this scrollback needs clearing.\n');
}
