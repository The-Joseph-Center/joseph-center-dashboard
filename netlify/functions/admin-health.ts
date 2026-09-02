import Stripe from 'stripe';
import { requireCapability, denial } from './_lib/verify-okta';
import { turso } from './_lib/staff-directory';
import { accessToken } from './_lib/google-sheets';

/**
 * Is each integration actually reachable right now?
 *
 * Every check makes a real call. Nothing here reports on the presence of a
 * variable, because a variable being set has twice now not meant the thing
 * worked: Netlify snapshots environment values into functions at deploy time,
 * so rotated credentials kept failing in production while looking correct
 * everywhere else, and a placeholder that was never substituted sat in the
 * analytics tag for months looking exactly like a configured one.
 *
 * Checks are read-only and cheap — a list of one, a token refresh, a HEAD.
 * Nothing here writes, so the page can be reloaded freely.
 *
 * No secret is ever returned. Failures report the status code and the provider's
 * message, which is what identifies the problem; the value that produced it
 * stays where it is.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const json = (statusCode: number, body: unknown) => ({
  statusCode, headers: JSON_HEADERS, body: JSON.stringify(body),
});

type State = 'ok' | 'fail' | 'unconfigured';
interface Check { name: string; state: State; detail: string; ms: number }

async function timed(name: string, fn: () => Promise<string>): Promise<Check> {
  const t = Date.now();
  try {
    return { name, state: 'ok', detail: await fn(), ms: Date.now() - t };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name,
      state: message === 'UNCONFIGURED' ? 'unconfigured' : 'fail',
      detail: message === 'UNCONFIGURED' ? 'Not configured' : message.slice(0, 200),
      ms: Date.now() - t,
    };
  }
}

const need = (v: string | undefined) => { if (!v) throw new Error('UNCONFIGURED'); return v; };

export async function handler(event: { headers: Record<string, string> }) {
  const auth = await requireCapability(event.headers, 'access');
  if (!auth.ok) return denial(auth);

  const checks = await Promise.all([
    timed('Turso (database)', async () => {
      need(process.env.TURSO_DATABASE_URL); need(process.env.TURSO_AUTH_TOKEN);
      // The shared helper, which uses @libsql/client/web. The default export
      // pulls a platform-specific native binary that is not in the deployed
      // bundle, so it bundles cleanly and then fails at runtime with
      // "Cannot find module '@libsql/linux-x64-gnu'".
      const r = await turso().execute('SELECT COUNT(*) AS n FROM contact_messages');
      return `reachable · ${Number((r.rows[0] as Record<string, unknown>).n).toLocaleString()} contact messages`;
    }),

    timed('Stripe (donations)', async () => {
      const { secretKey } = JSON.parse(need(process.env.JC_STRIPE_CONFIG)) as { secretKey: string };
      const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
      const account = await stripe.accounts.retrieve();
      const subs = await stripe.subscriptions.list({ status: 'active', limit: 100 });
      return `${account.settings?.dashboard?.display_name ?? 'account'} · ${subs.data.length} active recurring gifts`;
    }),

    timed('Stripe (agency billing)', async () => {
      const { secretKey } = JSON.parse(need(process.env.STRIPE_CONFIG)) as { secretKey: string };
      await new Stripe(secretKey, { apiVersion: '2024-06-20' }).accounts.retrieve();
      return 'reachable';
    }),

    timed('Okta (directory)', async () => {
      const base = new URL(need(process.env.VITE_OKTA_ISSUER)).origin;
      const res = await fetch(`${base}/api/v1/users?limit=1`, {
        headers: { Authorization: `SSWS ${need(process.env.OKTA_API_TOKEN)}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return 'reachable';
    }),

    timed('Resend (email)', async () => {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${need(process.env.RESEND_API_KEY)}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { data?: { name: string; status: string }[] };
      const verified = (data.data ?? []).filter((d) => d.status === 'verified').map((d) => d.name);
      return verified.length ? `verified: ${verified.join(', ')}` : 'reachable, no verified domain';
    }),

    timed('Sanity (CMS)', async () => {
      const project = need(process.env.VITE_SANITY_PROJECT_ID);
      const dataset = process.env.VITE_SANITY_DATASET || 'production';
      const url = `https://${project}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${encodeURIComponent('count(*[_type=="post"])')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { result: number };
      return `dataset "${dataset}" · ${data.result} posts`;
    }),

    timed('Google (sheets + calendar)', async () => {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: need(process.env.GOOGLE_OAUTH_CLIENT_ID),
          client_secret: need(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
          refresh_token: need(process.env.GOOGLE_OAUTH_REFRESH_TOKEN),
        }),
      });
      const data = await res.json() as { scope?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const scopes = (data.scope ?? '').split(' ').filter(Boolean).map((s) => s.split('/').pop());
      // Naming the granted scopes is the point: the calendar check silently
      // does nothing until freebusy is among them.
      return `granted: ${scopes.join(', ') || 'none'}`;
    }),

    timed('AWeber (newsletter)', async () => {
      const res = await fetch('https://auth.aweber.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: need(process.env.AWEBER_CLIENT_ID),
          client_secret: need(process.env.AWEBER_CLIENT_SECRET),
          refresh_token: need(process.env.AWEBER_REFRESH_TOKEN),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return 'reachable';
    }),
  ]);

  // Calendars, reported per calendar rather than as one pass/fail. A calendar
  // the account cannot read is the failure that matters and the one that hides:
  // freeBusy answers 200 with a per-calendar error, so a naive check would call
  // it healthy and the scheduler would treat a private calendar as wide open.
  let calendars: unknown = null;
  try {
    const ids = (process.env.GOOGLE_CALENDAR_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length) {
      const token = await accessToken();
      const now = Date.now();
      const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: new Date(now).toISOString(),
          timeMax: new Date(now + 7 * 86400000).toISOString(),
          timeZone: 'America/Denver',
          items: ids.map((id) => ({ id })),
        }),
      });
      const data = await res.json() as {
        calendars?: Record<string, { busy?: unknown[]; errors?: { reason: string }[] }>;
        error?: { message?: string };
      };
      calendars = res.ok
        ? Object.entries(data.calendars ?? {}).map(([id, c]) => ({
            id,
            readable: !c.errors?.length,
            reason: c.errors?.[0]?.reason ?? null,
            busyNextWeek: c.busy?.length ?? 0,
          }))
        : { error: data.error?.message ?? `HTTP ${res.status}` };
    } else {
      calendars = { error: 'GOOGLE_CALENDAR_IDS is not set' };
    }
  } catch (err) {
    calendars = { error: err instanceof Error ? err.message.slice(0, 160) : 'Could not read calendars' };
  }

  // The Stripe webhook, which is not a credential check but is the thing most
  // likely to be quietly pointing somewhere wrong.
  let webhooks: unknown = null;
  try {
    const { secretKey } = JSON.parse(need(process.env.JC_STRIPE_CONFIG)) as { secretKey: string };
    const stripe = new Stripe(secretKey, { apiVersion: '2024-06-20' });
    const eps = await stripe.webhookEndpoints.list({ limit: 10 });
    const expectedHost = process.env.SITE_DOMAIN || 'josephcentergj.com';
    webhooks = eps.data.map((e) => ({
      url: e.url,
      status: e.status,
      events: e.enabled_events,
      // A netlify.app URL works, but it is not the address anyone would think
      // to check, and it survives a custom-domain change without complaint.
      onExpectedDomain: e.url.includes(expectedHost),
      expectedHost,
    }));
  } catch { webhooks = null; }

  return json(200, { checkedAt: Math.floor(Date.now() / 1000), checks, calendars, webhooks });
}
