/**
 * Headers for the dashboard's JSON responses.
 *
 * `no-store` because every function that uses this sits behind Okta, and the
 * body is somebody's staff card, somebody's unsent draft, a donor report. An
 * authenticated response carrying no `Cache-Control` is one a browser may
 * cache heuristically and a shared cache may keep — a staleness bug and a
 * quiet way for one person's data to be handed to the next.
 *
 * The staleness half is why this exists: the Giving Tuesday copy was re-seeded
 * twice while the campaign tool went on rendering the previous wording, and
 * with no cache header on the response there was no way to rule caching out.
 *
 * A function that genuinely wants its response cached sets its own headers.
 * `analytics-proxy` does, and deliberately does not import this.
 */
export const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};
