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
  | 'formsAdmin'  // open, close and edit the seasonal forms
  | 'letterQueue' // work through Mona's year-end letters
  | 'taxData'     // year-end giving totals for acknowledgments and the 990
  | 'banners'     // the site-wide notice: closures, hours, announcements
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
  | 'contact' | 'volunteers' | 'events' | 'letters'
  | 'coffee-chat' | 'seasonal' | 'subscribers';

/**
 * Web Developer is on every form.
 *
 * Deliberately a separate group from jc-dashboard-admins rather than the same
 * one doing double duty: "can fix the site" and "should read everyone's
 * submissions" are different claims, and folding them together would have made
 * every future admin a reader of the letter and Coffee Chat queues as a side
 * effect of being able to see the invoices. Admins get the two inboxes that are
 * general business — the contact form and volunteers — and everything else is
 * granted to the person who actually does that work.
 */
const DEV = 'Web Developer';

export const FORM_ACCESS: Record<FormId, string[]> = {
  contact: [DEV, ADMIN_GROUP],
  // The Operational Director manages the volunteers.
  volunteers: [DEV, ADMIN_GROUP, 'Operational Director', 'Social Media Manager'],
  events: [DEV, 'Operational Director', 'Social Media Manager', 'Executive Assistant'],
  // Mona's queue.
  letters: [DEV, 'Executive Director', 'Executive Assistant'],
  // Guest applications for the podcast — booked and coordinated by the people
  // who make the episodes.
  'coffee-chat': [DEV, 'Social Media Manager', 'Executive Assistant'],
  seasonal: [DEV, 'Operational Director', 'Executive Assistant', 'Event Coordinator'],
  // The Executive Assistant helps with social.
  subscribers: [DEV, 'Social Media Manager', 'Executive Assistant'],
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
  // Editing a form is a bigger action than reading its submissions — it changes
  // what the public sees — so it is not simply "whoever can read `seasonal`".
  // The Event Coordinator runs Angel Tree and needs to open and close it.
  formsAdmin: [DEV, ADMIN_GROUP, 'Operational Director', 'Event Coordinator'],
  // Exactly the people who may read the letter requests — the queue is the same
  // data with somewhere to record that a letter got written. Derived from that
  // list rather than restated, so the two can never disagree.
  letterQueue: FORM_ACCESS.letters,
  // Financial, so it sits with billing rather than with the form inboxes.
  taxData: [DEV, ADMIN_GROUP, 'Executive Director'],
  // Posting to the front page of the site is not a front-desk task, even for
  // something urgent — this stays with the people accountable for what the
  // organisation says publicly.
  banners: [DEV, ADMIN_GROUP, 'Operational Director', 'Executive Assistant'],
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
