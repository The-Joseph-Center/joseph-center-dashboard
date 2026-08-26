# The Joseph Center — build, state and setup

Written 2026-08-26. Covers all three repositories, with the dashboard in detail.
Facts here were read from the live systems, not from memory — where something is
unverified it says so.

---

## 1. The three repositories

| Repo | GitHub | Purpose | Deploys from |
|---|---|---|---|
| `frontend/` | `The-Joseph-Center/joseph-center-frontend` | Public site, Vue 3 + Vite + Tailwind 4 | `production` |
| `studio/` | `The-Joseph-Center/joseph-center-studio` | Sanity v5 Studio | `production` |
| `dashboard/` | `The-Joseph-Center/joseph-center-dashboard` | Internal staff dashboard, Vue 3 + Vite | `production` |

Each has **`production`** and **`sandbox`**. `sandbox` is the working branch —
it does not trigger Netlify build credits. `production` is what deploys. They are
kept identical; merges are fast-forward.

There is **no root repository**. `/Volumes/WD_BLACK/Codebase/joseph-center/` is
just a container. `build-record/` at that level holds the numbered build specs
that drove the frontend.

### Context: the site is a rebuild
`josephcentergj.com` still serves the **old Gatsby site**. The Vue rebuild is
live only on `joseph-center-gj.netlify.app` pending DNS cutover.

---

## 2. Sanity datasets — read this before writing anything

The project (`x8wdo9c6`) has two datasets, and they are **not** two stages of one
site:

- **`staging`** — the new Vue site's content. Authoritative. Everything reads
  from here, including the deployed site.
- **`production`** — the **legacy Gatsby site's** content, ~191 docs on the old
  schema (`home`, `foodbank`, `dayshelter`, `vlog`, `mux.videoAsset`…). This is
  what the currently live site renders from.

A naive `sanity dataset copy staging production` would take the live site down
immediately. `sanity dataset copy` also *creates* its target and will not
overwrite, so a real cutover means: export `production` as a backup → delete it →
copy → flip `VITE_SANITY_DATASET` → redeploy.

**The dataset is publicly readable.** The frontend queries it from the browser
with no token. Nothing private may be stored on a Sanity document.

Patch scripts in `studio/` gate on `CONFIRM_PRODUCTION=yes`. Keep that pattern.

**Turso migrations live in `frontend/db/migrations/`** (the dashboard has its own
`dashboard/db/migrations/001_staff_identity.sql`, same database).
**`frontend/db/migrations/005_donations.sql` opens with
`DROP TABLE IF EXISTS donations` — never re-run it**, it would destroy live
donation records. 001–004 are all `CREATE TABLE IF NOT EXISTS` and safe.

Six of those eleven tables had never been created, which silently broke five
public forms: the `INSERT` ran *before* the Resend call inside the same `try`, so
a missing table meant the visitor saw "Submission failed" **and no email was
sent**. Fixed, and the inserts are now wrapped so a write failure can never cost
the notification again.

---

## 3. Dashboard — architecture

Vue 3 + Vite SPA, Netlify Functions for anything privileged. `netlify dev`
serves both.

```
src/
  lib/okta.ts           Okta client, claim helpers
  lib/capabilities.ts   capability -> Okta group table  (SHARED WITH FUNCTIONS)
  lib/api.ts            apiFetch — attaches the token to every Function call
  stores/useAuthStore   claims, groups, can(), isAdmin
  router/index.ts       route guards, /login/callback, capability meta
  components/MyStaffCard.vue   the staff card (overview + nowhere else)
  components/QuotePicker.vue   quote suggestions
netlify/functions/
  _lib/verify-okta.ts       JWT verification + capability enforcement
  _lib/staff-card.ts        Okta login -> Sanity staff doc
  _lib/staff-directory.ts   Okta/Sanity fetch + the matching rules
  _lib/quote-request-email.ts
  get-my-staff-card.ts      the caller's own card
  request-quote-change.ts   emails a quote for review (does NOT write)
  quotes-proxy.ts           quote suggestions, authenticated
  receive-support-request.ts
  reconcile-staff.ts        SCHEDULED, daily 07:15 UTC
  analytics-proxy.ts        Simple Analytics
  sanity-proxy.ts           read-only GROQ
  stripe-get-billing-summary.ts / stripe-create-portal-session.ts
```

Routes: `/`, `/analytics`, `/support`, `/billing`, `/login`, `/login/callback`,
`/forbidden`, `/whoami` (dev only), catch-all.

---

## 4. Authentication — Okta OIDC

Staff sign in with their existing Okta account. **Who can sign in is Okta app
assignment**, not code: the `Staff` group (32 members) is assigned to the app, so
offboarding in Okta removes dashboard access with no change here.

```
issuer     https://josephcentergj.okta.com
client_id  0oa26dqiioaVqjnYE1d8
audience   0oa26dqiioaVqjnYE1d8   (org auth server: aud == client_id)
jwks_uri   https://josephcentergj.okta.com/oauth2/v1/keys
scopes     openid profile email groups
redirect   /login/callback  (localhost:5173 + dashboard.josephcentergj.com)
```

### Constraints that shaped this — do not "fix" them
- **The tenant has no API Access Management.** There is therefore no custom
  authorization server, no access token carrying your own audience, and **no
  Token Preview** in the admin console.
- Because of that, **the Functions verify the ID token**, not an access token.
  Okta will only put group claims in an ID token here. Both sides are first
  party. `verify-okta.ts` takes issuer/audience from env, so switching to access
  tokens later is config, not a rewrite.
- The groups claim is configured on the **app**, Sign On → OpenID Connect ID
  Token → Group claim type **Filter**, name `groups`, **Matches regex** `.*`.
  It is stored on an internal endpoint
  (`/api/v1/internal/apps/{id}/settings/oauth/idToken`) and **does not appear on
  the public `/api/v1/apps/{id}` response** — checking there will wrongly suggest
  it is unset.
  The newer name+expression claim editor does **not** support group functions
  (`isMemberOfGroupName`, `getFilteredGroups`, `Groups.startsWith` all return
  "Unsupported global function"). The legacy Filter panel is the correct path.
- Requesting the `groups` **scope** is required; without it the claim is not
  emitted even though the filter is right.

### Capabilities
`src/lib/capabilities.ts` is imported by the SPA *and* the Functions, so the menu
and the API cannot disagree.

| Capability | Groups |
|---|---|
| `myCard`, `links`, `support` | everyone signed in |
| `analytics`, `content` | `jc-dashboard-admins`, `Social Media Manager` |
| `billing` | `jc-dashboard-admins` |

`jc-dashboard-admins` currently: Eric Phifer, Mona Highline, Shawna Wilkins.

Group membership lives in Okta and nowhere else. **No per-user overrides** — the
moment access can be granted outside a group, the directory stops being the
answer to "who can do this".

Note: `Director`, `Operational Director`, `IT Admin`, `System Administrator`
deliberately confer only the baseline. Seniority is not `jc-dashboard-admins`.

Every Function calls `verifyRequest()` or `requireCapability()`. Misconfiguration
fails closed. Verified: a forged JWT with correct issuer, audience and admin
group is rejected because its key is not in Okta's JWKS.

---

## 5. Identity — how a person maps to their staff card

**The public `email` field on a staff document cannot be the key.**
`kisaacs@josephcentergj.com` appears on **two** cards — Mona's and Khira's —
because Mona's public contact routes to her assistant. Matching on it would serve
Khira the Executive Director's card and leave Mona unable to reach her own. Mona's
real login, `mhighline@`, appears on no card.

The mapping lives in Turso, table **`staff_identity`** (18 rows), with a UNIQUE
index on `okta_login` so one account can never own two cards — a bad match fails
the write rather than silently granting edit rights over a colleague's record.

It is **derived, not authored**: `scripts/sync-staff-identity.ts` (on demand) and
`reconcile-staff.ts` (daily) rebuild it. Matching is tiered and refuses to guess:

1. `email` — the card's address identifies exactly one Okta account **and**
   appears on exactly one card (shared addresses rejected)
2. `first-name` — the card's name matches exactly one Okta first name; this is
   what correctly separates Mona from Khira

It is in Turso rather than on the Sanity document because **the Sanity dataset is
public**.

---

## 6. Daily reconciliation

`reconcile-staff.ts`, 07:15 UTC daily. Compares Okta to the staff page.

- **Unpublishes** (sets `hidden: true`) anyone `DEPROVISIONED`, `SUSPENDED`, or
  absent from Okta.
- **Never republishes.** A reactivated account is *reported* for a human to
  decide — "employed again" and "should be on the public site again" are
  different questions.
- `PROVISIONED` and `STAGED` are **not** departures — they are pending
  onboarding. Treating them as departures would unpublish a new hire on day one.
- Folds in the identity sync, so cards link themselves once emails are filled in.
- Excludes Okta's `Service Accounts` group from the "no card" report.
- **Emails only when something happened.** Silence means clean.

Polling, not an event hook: idempotent, self-healing, surfaces drift. Immediacy
is not needed — Okta app assignment already revokes access instantly; this only
governs how fast a photo leaves the website.

---

## 7. Quotes — a review flow, not a save

Staff set their quote from the dashboard. **Nothing is written to Sanity.**
`request-quote-change.ts` emails it for review and it is applied by hand.

That is deliberate: ZenQuotes does no content filtering, so nothing sourced from
it should reach a public page unreviewed. Scripture is safe by construction (a
curated pool of forty references in `quotes-proxy.ts`) — random-verse endpoints
return unusable text and were rejected after testing.

The UI says so explicitly: the button reads "Submit for review", the card is
**not** updated locally on success, and the current quote stays visible alongside
the proposed one.

`quotable.io` — the obvious quotes API — is **dead** as of Aug 2026.

---

## 8. Environment variables (dashboard)

```
VITE_OKTA_ISSUER / VITE_OKTA_CLIENT_ID / VITE_OKTA_ADMIN_GROUP
OKTA_ISSUER / OKTA_CLIENT_ID / OKTA_ADMIN_GROUP     server-side verification
OKTA_API_TOKEN                                       read-only admin, directory reads
VITE_SANITY_PROJECT_ID / VITE_SANITY_DATASET
SANITY_WRITE_TOKEN                                   editor token
TURSO_DATABASE_URL / TURSO_AUTH_TOKEN                same DB as the frontend
RESEND_API_KEY                                       josephcentergj.com verified
QUOTE_REVIEW_TO_EMAIL / QUOTE_REVIEW_FROM_EMAIL / SUPPORT_TO_EMAIL
STRIPE_CONFIG          agency Stripe — invoices JC
JC_STRIPE_CONFIG       JC's own Stripe — donations
BILLING_PRICE_ID       price_1SsqHpAh4dVfpsv0PszdnEXR  ($1,200/month)
SIMPLE_ANALYTICS_API_KEY
```

**Two Stripe accounts.** `STRIPE_CONFIG` is the agency billing JC.
`JC_STRIPE_CONFIG` is JC's own, for donations. Do not confuse them.

---

## 9. Gotchas that cost real time

- **`npm run dev` must be `netlify dev`.** Plain Vite does not serve Functions,
  and its SPA fallback answers `/.netlify/functions/*` with **index.html and a
  200**, so the client calls `res.json()` on HTML. `apiFetch` now names this
  failure. `netlify.toml` needs the explicit `[dev]` block or autodetect
  recurses into the same script.
- **pnpm only.** `packageManager` is pinned and `package-lock.json` is ignored.
  Netlify installs with `--frozen-lockfile`; an accidental `npm install`
  desyncs `pnpm-lock.yaml` and the build fails. `frontend` and `studio` still
  carry both lockfiles — same trap, not yet sprung.
- **Simple Analytics hostname** is `josephcentergj.com`, *not* the `sa.` script
  subdomain. The latter 404s "View not found".
- **Okta's `/api/v1/users` omits DEPROVISIONED accounts** unless you pass an
  explicit status filter. Departure is exactly what the reconciliation looks
  for, so the filter is mandatory — without it a deactivated person is invisible
  to the job.
- **Vue `v-else` binds to the nearest preceding conditional.** Inserting a
  `v-if` between `v-else-if` and its `v-else` silently re-points it — this
  rendered every staff card twice.

---

## 10. Current state and what is outstanding

**Frontend** — launch-ready. Stripe-only giving, donor portal link, staff
departments, transparency chart, blog, forms.

**Dashboard** — deployed and working: Okta auth, verified Functions,
capabilities, staff card, quote review, reconciliation.

### Outstanding
- **Transparency figures.** The allocation chart renders **nothing** until real
  categories are entered. Awaiting a Program Services / Management & General /
  Fundraising split from the bookkeeper. The revenue mix currently seeded is
  Jan–Apr 2026 and is labelled as such.
- **Eight staff cards incomplete** — `joseph_1`–`joseph_6` (no name, title,
  department or email) plus Gerald and Tamy (no email). They link automatically
  once emails exist.
- **`intakeMode` is ON** on the `/staff` People Grid. It must be **switched off
  before DNS cutover** — editable staff cards must not be public. One tick in
  Studio, no deploy.
- **Jessica and Khira** are active in Okta but hidden on the site. Reported by
  the reconciliation, never auto-republished. Awaiting a decision.
- **Six of seven `enabledWidgets` have no component** (`submissions`,
  `eventRegistrations`, `subscribers`, `coffeeChat`, `annualReports`).
  `DashboardHome` skips unknown keys, so they fail silently.
- **Dependabot**: 17 advisories on frontend, ~58 on studio. Untriaged.
- **Planned**: blog/newsletter/post tools behind the `content` capability; a
  staff-approval page; `customer.updated` sync so portal edits reach Turso.

### Deliberately not done
- No auto-publish from Okta, ever.
- No per-user permission overrides.
- Quotes are never written directly by staff.
