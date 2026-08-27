/**
 * What each Okta group is allowed to do.
 *
 * Imported by BOTH the SPA (to render nav and guard routes) and the Netlify
 * Functions (to enforce it). One table, so the menu and the API can never
 * disagree about who may do what — a nav item that hides a page whose endpoint
 * still answers is not access control.
 *
 * Membership lives in Okta and nowhere else. There are deliberately no
 * per-user overrides: the moment access can be granted outside a group, the
 * directory stops being the answer to "who can do this" and the whole thing
 * becomes unmaintainable.
 *
 * Group names are matched case-insensitively against the token's `groups`
 * claim, which now carries every group the user belongs to.
 */

export type Capability =
  | 'myCard'     // own staff card and quote — every signed-in staff member
  | 'links'      // quick links
  | 'support'    // raise a support request
  | 'analytics'  // site analytics
  | 'content'    // blog, newsletter and post-building tools (in progress)
  | 'staffAdmin' // edit anyone's public staff details, create cards
  | 'billing';   // invoices, admin only

export const ADMIN_GROUP = 'jc-dashboard-admins';

/** '*' means every authenticated staff member. */
const RULES: Record<Capability, string[] | '*'> = {
  myCard: '*',
  links: '*',
  support: '*',
  // Deliberately not everyone. Site performance is the concern of the people
  // who act on it.
  analytics: [ADMIN_GROUP, 'Social Media Manager'],
  content: [ADMIN_GROUP, 'Social Media Manager'],
  // Its own capability rather than folding into billing, so onboarding can be
  // delegated later without also handing over the invoices.
  staffAdmin: [ADMIN_GROUP],
  billing: [ADMIN_GROUP],
};

const norm = (s: string) => s.trim().toLowerCase();

export function hasCapability(groups: string[] | undefined, capability: Capability): boolean {
  const rule = RULES[capability];
  if (rule === '*') return true;
  if (!groups?.length) return false;
  const mine = new Set(groups.map(norm));
  return rule.some((g) => mine.has(norm(g)));
}

export function isAdmin(groups: string[] | undefined): boolean {
  return !!groups?.some((g) => norm(g) === norm(ADMIN_GROUP));
}

/** Every capability the given groups unlock — handy for debugging and /whoami. */
export function capabilitiesFor(groups: string[] | undefined): Capability[] {
  return (Object.keys(RULES) as Capability[]).filter((c) => hasCapability(groups, c));
}
