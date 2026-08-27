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
  | 'staffAdmin'  // edit anyone's public staff details, create cards
  | 'submissions' // the form inbox — which forms is decided per form, below
  | 'billing';    // invoices, admin only

export const ADMIN_GROUP = 'jc-dashboard-admins';

/**
 * Who may read each form's submissions.
 *
 * Per form rather than one blanket "submissions" permission, because these are
 * not equally sensitive: an event RSVP is a name and a party size, while a
 * personal-letter request is a home address and a coffee chat application asks
 * about legal matters and difficult subjects. Someone who needs the RSVP list
 * has no business reading either of the others.
 *
 * Referrals are deliberately absent: that form is an embedded CaseMgr iframe,
 * so those submissions never reach this system and there is nothing here to
 * show or to protect. The referral_submissions table predates that decision and
 * has never had a row written to it.
 *
 * These are starting assignments based on who does the work today — worth
 * confirming with Mona, and cheap to change, since this table is the only place
 * it is written down.
 */
export type FormId =
  | 'volunteers' | 'events' | 'letters' | 'coffee-chat' | 'seasonal' | 'subscribers';

export const FORM_ACCESS: Record<FormId, string[]> = {
  volunteers: [ADMIN_GROUP, 'Operational Director', 'Front Desk', 'Executive Assistant'],
  events: [ADMIN_GROUP, 'Operational Director', 'Front Desk', 'Social Media Manager'],
  // Mona's queue. Home addresses, so it stays tight.
  letters: [ADMIN_GROUP, 'Executive Director', 'Executive Assistant'],
  // Asks about legal matters and sensitive topics — the people who book and
  // record the episodes, and nobody else.
  'coffee-chat': [ADMIN_GROUP, 'Social Media Manager', 'Executive Assistant'],
  seasonal: [ADMIN_GROUP, 'Operational Director', 'Front Desk', 'Executive Assistant'],
  subscribers: [ADMIN_GROUP, 'Social Media Manager'],
};

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
  // Derived, never hand-maintained: anyone who can read at least one form can
  // reach the page, and the page then shows only the forms they may read. A
  // separately written union here would drift the first time a form is added.
  submissions: [...new Set(Object.values(FORM_ACCESS).flat())],
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

/** Whether these groups may read one particular form's submissions. */
export function canSeeForm(groups: string[] | undefined, form: FormId): boolean {
  const allowed = FORM_ACCESS[form];
  if (!allowed || !groups?.length) return false;
  const mine = new Set(groups.map(norm));
  return allowed.some((g) => mine.has(norm(g)));
}

/** Every form these groups may read, in the order declared above. */
export function formsFor(groups: string[] | undefined): FormId[] {
  return (Object.keys(FORM_ACCESS) as FormId[]).filter((f) => canSeeForm(groups, f));
}

/** Every capability the given groups unlock — handy for debugging and /whoami. */
export function capabilitiesFor(groups: string[] | undefined): Capability[] {
  return (Object.keys(RULES) as Capability[]).filter((c) => hasCapability(groups, c));
}
