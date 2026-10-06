/**
 * Which Sanity dataset the dashboard reads and writes.
 *
 * One answer, in one place, because it used to be answered separately in every
 * function — and the defaults disagreed. Most fell back to `staging` while
 * `admin-health` and `sanity-proxy` fell back to `production`, so with the
 * variable unset the dashboard reported on one dataset and wrote to the other.
 *
 * What that looked like from the outside: switching a form on in the dashboard
 * did nothing to the live site, because the switch landed in staging and the
 * site reads production. Nothing errored, and the dashboard showed the change
 * it had just made.
 *
 * The default is `production` because the site is live. Staging is now the
 * deliberate choice, named explicitly, rather than the thing you get by
 * forgetting to set a variable.
 */
export const SANITY_DATASET = process.env.VITE_SANITY_DATASET || 'production';

/** True when the dashboard is pointed somewhere the public site does not read. */
export const EDITING_LIVE_DATA = SANITY_DATASET === 'production';
