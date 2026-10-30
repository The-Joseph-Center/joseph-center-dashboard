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

/**
 * AWeber is rate limiting us.
 *
 * Worth its own type because it is the one failure here that is not a failure:
 * nothing is wrong, the answer is to wait. Told apart from a real error it
 * becomes a pause; lumped in with them it ends a send three quarters of the way
 * through, which is what it did to October.
 *
 * The limit is **120 requests per minute per account** and cannot be raised.
 * Over it, AWeber answers 403 — not 429 — with "Rate Limit Error" in the body,
 * and then refuses everything for sixty seconds. Both halves of that matter:
 * handling only 429 misses it entirely, and a 403 has to be read before it is
 * believed, because an expired token and a missing scope answer 403 too.
 */
export class AweberThrottled extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs = 60_000) {
    super('AWeber is rate limiting — 120 requests a minute, then a sixty-second lockout.');
    this.name = 'AweberThrottled';
    this.retryAfterMs = retryAfterMs;
  }
}

const RATE_LIMITED = /rate limit/i;

/**
 * Every AWeber request this invocation has made.
 *
 * The scarce resource is requests per minute, not seconds of runtime, so it has
 * to be counted — including the reads before the tagging loop, which cost the
 * same as a tag. Reset at the top of each invocation because Netlify reuses a
 * warm container and a counter left over from the last one would stop a pass
 * before it started.
 */
let requestCount = 0;
export const resetRequestCount = () => { requestCount = 0; };
export const requestsMade = () => requestCount;

let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(cfg: AweberConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  requestCount++;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request, retried when AWeber asks us to wait.
 *
 * Tagging the list is two hundred and forty PATCHes in a row, which is exactly
 * the traffic shape a rate limiter exists to slow down. A 429 is not a failure,
 * it is an instruction, and treating it as one would leave that subscriber
 * untagged and silently out of the month's send.
 *
 * The waits are capped hard and short on purpose: the caller is working against
 * a ten-second function limit, and a polite thirty-second sleep would spend the
 * whole budget on one subscriber.
 */
async function api<T>(
  cfg: AweberConfig, path: string, init?: RequestInit, attempt = 0,
): Promise<{ status: number; body: T }> {
  const token = await accessToken(cfg);
  requestCount++;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };

  // Not retried here, and deliberately: the wait is sixty seconds and a
  // function has ten. Thrown instead, for the caller to hand back to a client
  // that can afford to wait.
  if (res.status === 429 || (res.status === 403 && RATE_LIMITED.test(body?.error?.message ?? ''))) {
    const after = Number(res.headers.get('retry-after'));
    throw new AweberThrottled(Number.isFinite(after) && after > 0 ? after * 1000 : 60_000);
  }

  // A wobble is worth one short retry on the spot. A rate limit is not a
  // wobble, which is why it is handled above this.
  if (res.status >= 500 && attempt < 2) {
    await sleep(300 * (attempt + 1));
    return api<T>(cfg, path, init, attempt + 1);
  }
  return { status: res.status, body: body as T };
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

export interface TagRun {
  /** Tagged on this pass. */
  added: number;
  /** Carried the tag before this pass began. */
  already: number;
  failed: string[];
  /** Still without the tag when the pass ended, failures included. */
  remaining: number;
  /** Every untagged subscriber was attempted — there is no more to do. */
  done: boolean;
  /** Why it stopped, when it did not finish. */
  stoppedBy?: 'time' | 'quota' | 'throttled';
  /** How long to leave it before the next pass. */
  retryAfterMs?: number;
}

/**
 * This month's tag, onto everyone who does not have it yet — as far as the
 * clock allows.
 *
 * A Netlify function is stopped at ten seconds. Tagging is one PATCH per
 * subscriber, and AWeber answers in about eighty milliseconds, so a list of 243
 * cannot be finished in one run: October's first attempt got through 76 and the
 * browser was handed a bare 504, with no record of where it had stopped.
 *
 * So the run watches the clock and stops itself with time to spare, reporting
 * what is left. The caller comes back for the rest. Resuming is safe because
 * the only subscribers touched are the ones without the tag — nobody is tagged
 * twice, and AWeber's automations therefore fire once per person however many
 * passes it takes.
 *
 * A subscriber that errors is recorded and passed over rather than ending the
 * run: stopping at the first failure would send to the people before it in the
 * list and nobody after, which is the worst of the available outcomes.
 */
export async function tagEveryone(
  subscribers: Subscriber[],
  tag: string,
  apply: (s: Subscriber) => Promise<unknown>,
  opts: {
    budgetMs: number;
    startedAt: number;
    /** Requests this invocation may spend in total, reads included. */
    maxRequests: number;
    now?: () => number;
    spent?: () => number;
  },
): Promise<TagRun> {
  const now = opts.now ?? Date.now;
  const spent = opts.spent ?? requestsMade;
  const todo = subscribers.filter((s) => !s.tags.includes(tag));
  const already = subscribers.length - todo.length;
  const failed: string[] = [];
  let added = 0;
  let stoppedBy: TagRun['stoppedBy'];

  for (const s of todo) {
    // Three ways to stop, and only one of them is finishing. The clock is the
    // function's ten-second limit; the quota is AWeber's hundred and twenty a
    // minute; a throttle is that quota already spent, by this run or by the
    // website taking a signup at the same moment.
    if (now() - opts.startedAt >= opts.budgetMs) { stoppedBy = 'time'; break; }
    if (spent() >= opts.maxRequests) { stoppedBy = 'quota'; break; }
    try {
      await apply(s);
      added++;
    } catch (err) {
      if (err instanceof AweberThrottled) {
        // Everyone after this one would fail the same way, so stop rather than
        // writing the rest of the list into `failed` — which is how a rate
        // limit turns into two hundred apparent delivery failures.
        stoppedBy = 'throttled';
        return {
          added, already, failed, remaining: todo.length - added,
          done: false, stoppedBy, retryAfterMs: err.retryAfterMs,
        };
      }
      failed.push(s.email);
      console.error('aweber: tagging failed for', s.email, err);
    }
  }

  return {
    added, already, failed, remaining: todo.length - added,
    done: !stoppedBy,
    stoppedBy,
    // Stopping on the clock means roughly eighty requests went out in under
    // seven seconds, so the minute's quota is spent either way. Coming straight
    // back would earn a 403 and a lockout.
    retryAfterMs: stoppedBy ? 60_000 : undefined,
  };
}

/**
 * Draft messages, which the API does cover even though Campaigns do not.
 *
 * A draft broadcast is the only way to get a built HTML email into AWeber
 * without a person pasting markup into an editor that has nowhere to paste it.
 * Once the draft exists it can be picked as the message an automation sends,
 * which is the step this hands back to a human.
 */
export interface DraftMessage { id: number; subject: string }

/**
 * The API-created drafts on the list.
 *
 * `status=draft` returns only drafts created through the API — a draft built by
 * hand in AWeber's editor is invisible here. So this answers "did we already
 * create this one?" and not "does a message with this subject exist?".
 */
export async function listDrafts(cfg: AweberConfig): Promise<DraftMessage[]> {
  const { status, body } = await api<{ entries?: { broadcast_id?: number; subject?: string }[]; error?: { message: string } }>(
    cfg, `/accounts/${cfg.accountId}/lists/${cfg.listId}/broadcasts?status=draft&ws.size=100`
  );
  if (status >= 300) throw new Error(body.error?.message ?? `Listing drafts failed (${status})`);
  return (body.entries ?? []).map((e) => ({ id: Number(e.broadcast_id ?? 0), subject: String(e.subject ?? '') }));
}

export async function createDraft(
  cfg: AweberConfig,
  message: { subject: string; html: string; text: string },
): Promise<DraftMessage> {
  // Form-encoded, and deliberately so. Creating a broadcast is the one write
  // in this API that refuses application/json — it answers 415 and creates
  // nothing. Every other call here takes JSON, which is how a run could report
  // three drafts created with nothing on the list to show for it.
  const form = new URLSearchParams({
    subject: message.subject,
    body_html: message.html,
    body_text: message.text,
    // Sent by an automation, not broadcast to the list, so it should not
    // appear in the public archive as a mailing of its own.
    is_archived: 'false',
  });
  const { status, body } = await api<{ broadcast_id?: number; error?: { message: string } }>(
    cfg, `/accounts/${cfg.accountId}/lists/${cfg.listId}/broadcasts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    },
  );
  if (status >= 300) throw new Error(body.error?.message ?? `Creating the draft failed (${status})`);
  return { id: Number(body.broadcast_id ?? 0), subject: message.subject };
}

/** The tier tags the automations route on, from the process document. */
export const TIER_TAGS = [
  'community-friend', 'donor', 'repeat-donor', 'recurring-donor',
  'vip', 'vip-repeat', 'vip-engaged',
] as const;

export interface Audience {
  active: number;
  perTier: Record<string, number>;
  /** Carrying no tier tag at all — nothing excludes them, so they get the community-friend version. */
  untagged: string[];
  /**
   * Carrying more than one tier tag.
   *
   * Every automation excludes all the other tiers, so someone holding two tier
   * tags is excluded from all three and receives nothing at all. It is silent:
   * AWeber reports a successful send and the person simply never appears in it.
   */
  overlapping: { email: string; tags: string[] }[];
}

export function describeAudience(subscribers: Subscriber[]): Audience {
  const active = subscribers.filter((s) => s.status === 'subscribed');
  const tiersOf = (s: Subscriber) => s.tags.filter((t) => (TIER_TAGS as readonly string[]).includes(t));
  const perTier: Record<string, number> = {};
  for (const t of TIER_TAGS) perTier[t] = 0;
  for (const s of active) for (const t of tiersOf(s)) perTier[t] = (perTier[t] ?? 0) + 1;
  return {
    active: active.length,
    perTier,
    untagged: active.filter((s) => tiersOf(s).length === 0).map((s) => s.email),
    overlapping: active.filter((s) => tiersOf(s).length > 1).map((s) => ({ email: s.email, tags: tiersOf(s) })),
  };
}
