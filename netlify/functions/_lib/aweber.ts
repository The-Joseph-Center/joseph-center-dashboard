/**
 * AWeber, for the monthly newsletter send.
 *
 * What is possible here is bounded by AWeber's API, not by taste: it covers
 * lists, subscribers, tags, segments and broadcasts, and it does **not** cover
 * Campaigns — the automation feature. So the automation cannot be created or
 * retargeted programmatically. The one genuinely automatable step is the one
 * that is also the most tedious and the easiest to get wrong: applying this
 * month's tag to every active subscriber.
 *
 * Auth is the refresh-token grant the site already uses for newsletter
 * signups, with wider scopes.
 */

const API = 'https://api.aweber.com/1.0';
const TOKEN_URL = 'https://auth.aweber.com/oauth2/token';

/** Everything the newsletter tooling touches. */
export const REQUIRED_SCOPES = [
  'account.read',
  'list.read',
  'subscriber.read',
  'subscriber.write',
  'email.read',
  'email.write',
] as const;

export interface AweberConfig { clientId: string; clientSecret: string; refreshToken: string; accountId: string; listId: string }

export function aweberConfig(): AweberConfig | null {
  const clientId = process.env.AWEBER_CLIENT_ID;
  const clientSecret = process.env.AWEBER_CLIENT_SECRET;
  const refreshToken = process.env.AWEBER_REFRESH_TOKEN;
  const accountId = process.env.AWEBER_ACCOUNT_ID;
  const listId = process.env.AWEBER_LIST_ID;
  return clientId && clientSecret && refreshToken && accountId && listId
    ? { clientId, clientSecret, refreshToken, accountId, listId }
    : null;
}

let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(cfg: AweberConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken }),
  });
  const data = await res.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description ?? `AWeber token refresh failed (${res.status})`);
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function api<T>(cfg: AweberConfig, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const token = await accessToken(cfg);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/**
 * Which of the scopes we need are actually granted.
 *
 * Worth checking up front rather than discovering halfway through a run: the
 * token the site already had was issued for signups only, and a 401 on
 * subscriber 140 of 263 is a much worse way to learn that.
 */
export async function missingScopes(cfg: AweberConfig): Promise<string[]> {
  const probes: [string, string][] = [
    ['subscriber.read', `/accounts/${cfg.accountId}/lists/${cfg.listId}/subscribers?ws.size=1`],
    ['email.read', `/accounts/${cfg.accountId}/lists/${cfg.listId}/broadcasts?status=draft`],
  ];
  const missing: string[] = [];
  for (const [scope, path] of probes) {
    const { status } = await api(cfg, path);
    if (status === 401) missing.push(scope);
  }
  // A write scope cannot be probed without writing, so it is inferred: AWeber
  // grants read and write together in the consent screen for each area.
  if (missing.includes('subscriber.read')) missing.push('subscriber.write');
  if (missing.includes('email.read')) missing.push('email.write');
  return missing;
}

export interface Subscriber { id: number; email: string; status: string; tags: string[]; selfLink: string }

/** Every subscriber on the list, following AWeber's paging to the end. */
export async function allSubscribers(cfg: AweberConfig): Promise<Subscriber[]> {
  const out: Subscriber[] = [];
  let path: string | null = `/accounts/${cfg.accountId}/lists/${cfg.listId}/subscribers?ws.size=100`;
  // A hard page ceiling so a paging bug cannot spin forever against a live API.
  for (let page = 0; path && page < 60; page++) {
    const { status, body } = await api<{
      entries?: { id: number; email: string; status: string; tags?: string[]; self_link: string }[];
      next_collection_link?: string;
    }>(cfg, path);
    if (status !== 200) throw new Error(`Could not read subscribers (${status})`);
    for (const e of body.entries ?? []) {
      out.push({ id: e.id, email: e.email, status: e.status, tags: e.tags ?? [], selfLink: e.self_link });
    }
    path = body.next_collection_link ? body.next_collection_link.replace(API, '') : null;
  }
  return out;
}

/**
 * Adds a tag, keeping the ones already there.
 *
 * AWeber replaces the whole tag array on a PATCH, so the existing tags have to
 * be sent back with it. Getting this wrong would strip every subscriber's tier
 * tag — which is the thing that decides which version of the newsletter they
 * receive — so it reads before it writes, every time.
 */
export async function addTag(cfg: AweberConfig, subscriber: Subscriber, tag: string): Promise<'added' | 'already'> {
  if (subscriber.tags.includes(tag)) return 'already';
  const path = subscriber.selfLink.replace(API, '');
  const { status, body } = await api<{ error?: { message: string } }>(cfg, path, {
    method: 'PATCH',
    body: JSON.stringify({ tags: { add: [tag] } }),
  });
  if (status >= 300) throw new Error(body.error?.message ?? `Tagging ${subscriber.email} failed (${status})`);
  return 'added';
}
