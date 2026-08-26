# pws-dashboard-template

This is a **scaffold template** — not a live dashboard. It is cloned and configured by [pws-scaffolder](https://github.com/EricPhifer/pws-scaffolder) to generate client-specific dashboard projects.

## Stack

Vite, Vue 3, TypeScript, Tailwind CSS 4, Vue Router, Pinia, Lucide Vue Next, @vueuse/core, @auth0/auth0-vue, @sanity/client

## Auth

All routes require Auth0 authentication. The router `beforeEach` guard redirects unauthenticated users to Auth0 login. After login, users return to the dashboard home.

## Widget System

`DashboardHome` reads `enabledWidgets` from `src/config/dashboard.ts` and renders only the listed widgets. Each widget is self-contained. The scaffolder enables/disables widgets per client by writing the config — no component code changes needed.

Available widgets: `links`, `siteAnalytics`, `tutorials`, `contentEditors`

## Sanity Proxy

`netlify/functions/sanity-proxy.ts` accepts GROQ queries via POST, runs them against Sanity using `NETLIFY_SANITY_PROJECT_ID` (server-side env var), and returns results. This keeps the project ID out of the client bundle. The `useSanity.ts` composable calls this function.

`NETLIFY_SANITY_PROJECT_ID` is intentionally **not** prefixed with `VITE_` — it is server-side only.

## Placeholder Pattern

Same `##PLACEHOLDER##` pattern as pws-foundation-template. Theme variables, client name, and VSCode colors are replaced by the scaffolder.

## Setup After Scaffolding

1. Create an Auth0 tenant and application — paste domain + client ID into `.env`
2. Create or reuse a Sanity project — paste project ID into `.env` as `NETLIFY_SANITY_PROJECT_ID`
3. Create a Netlify site — connect the GitHub repo
4. Set `NETLIFY_SANITY_PROJECT_ID` in Netlify environment variables (not in the client `.env`)

## Do Not

- Run this template directly — it requires Auth0 and Sanity credentials
- Add client-specific widget config here — it goes in `project-config.json`
- Prefix `NETLIFY_SANITY_PROJECT_ID` with `VITE_` — it must stay server-side