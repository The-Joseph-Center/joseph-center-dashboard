import { requireCapability, denial } from './_lib/verify-okta';
import {
  RULES, FORM_ACCESS, ADMIN_GROUP,
  type Capability, type FormId,
} from '../../src/lib/capabilities';
import { FORMS } from '../../src/lib/submissionForms';

/**
 * The access map: what each capability requires, and who is actually in those
 * groups right now.
 *
 * The rules come from capabilities.ts, which is the only place access is
 * written down. Membership comes live from Okta, because that is the only place
 * membership is written down. Neither is duplicated here — this endpoint joins
 * them, so the page cannot show a permission set that has quietly drifted from
 * the one being enforced.
 *
 * Read-only on purpose. Changing who is in a group is an Okta action, and doing
 * it from here would mean this dashboard holding credentials that can rewrite
 * the directory it depends on for its own authentication.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const json = (statusCode: number, body: unknown) => ({
  statusCode, headers: JSON_HEADERS, body: JSON.stringify(body),
});

interface OktaGroup { id: string; type: string; profile: { name: string; description?: string } }
interface Member { profile?: { firstName?: string; lastName?: string; email?: string; login?: string }; status?: string }

const norm = (s: string) => s.trim().toLowerCase();

/** What each capability is for, in the words a person would use. */
const CAPABILITY_LABELS: Record<Capability, string> = {
  myCard: 'Their own staff card and quote',
  links: 'Quick links',
  support: 'Raise a support request',
  analytics: 'Site analytics',
  content: 'Blog and post-building tools',
  staffAdmin: 'Edit anyone’s staff card; create and remove cards',
  submissions: 'The form inbox (which forms is decided per form)',
  formsAdmin: 'Open, close and edit the seasonal forms',
  letterQueue: 'Work through Mona’s year-end letters',
  taxData: 'Year-end giving totals, donor list and exports',
  banners: 'The site-wide notice banner',
  newsletter: 'Build the monthly newsletter',
  billing: 'Invoices and payment method',
  access: 'This page',
};

export async function handler(event: { httpMethod: string; headers: Record<string, string> }) {
  const auth = await requireCapability(event.headers, 'access');
  if (!auth.ok) return denial(auth);

  const org = process.env.VITE_OKTA_ISSUER;
  const token = process.env.OKTA_API_TOKEN;
  if (!org || !token) {
    return json(500, { error: 'Okta is not configured' });
  }
  const base = new URL(org).origin;
  const headers = { Authorization: `SSWS ${token}`, Accept: 'application/json' };

  try {
    const groupsRes = await fetch(`${base}/api/v1/groups?limit=200`, { headers });
    if (!groupsRes.ok) throw new Error(`Okta groups: ${groupsRes.status}`);
    const oktaGroups = await groupsRes.json() as OktaGroup[];

    // Only the groups the rules actually mention. The directory carries dozens
    // that have nothing to do with this dashboard, and listing them all would
    // bury the handful that grant something.
    const named = new Set<string>();
    for (const rule of Object.values(RULES)) {
      if (rule !== '*') for (const g of rule) named.add(norm(g));
    }
    for (const list of Object.values(FORM_ACCESS)) for (const g of list) named.add(norm(g));

    const relevant = oktaGroups.filter((g) => named.has(norm(g.profile.name)));

    const groups = await Promise.all(relevant.map(async (g) => {
      const res = await fetch(`${base}/api/v1/groups/${g.id}/users?limit=200`, { headers });
      const members = res.ok ? await res.json() as Member[] : [];
      return {
        name: g.profile.name,
        description: g.profile.description ?? null,
        // A deactivated account keeps its group memberships, so counting raw
        // members would credit a group with people who can no longer sign in.
        members: members
          .filter((m) => m.status !== 'DEPROVISIONED' && m.status !== 'SUSPENDED')
          .map((m) => ({
            name: [m.profile?.firstName, m.profile?.lastName].filter(Boolean).join(' ')
              || m.profile?.login || '(unnamed)',
            email: m.profile?.email ?? m.profile?.login ?? '',
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        inactive: members.filter((m) => m.status === 'DEPROVISIONED' || m.status === 'SUSPENDED').length,
      };
    }));

    // A rule naming a group that does not exist in Okta grants nothing, and is
    // almost always a typo or a renamed group. Worth saying out loud.
    const present = new Set(oktaGroups.map((g) => norm(g.profile.name)));
    const missing = [...named].filter((n) => !present.has(n));

    const capabilities = (Object.keys(RULES) as Capability[]).map((c) => ({
      id: c,
      label: CAPABILITY_LABELS[c] ?? c,
      everyone: RULES[c] === '*',
      groups: RULES[c] === '*' ? [] : (RULES[c] as string[]),
    }));

    const forms = (Object.keys(FORM_ACCESS) as FormId[]).map((f) => ({
      id: f,
      label: FORMS.find((d) => d.id === f)?.label ?? f,
      sensitive: !!FORMS.find((d) => d.id === f)?.sensitive,
      groups: FORM_ACCESS[f],
    }));

    return json(200, {
      adminGroup: ADMIN_GROUP,
      capabilities,
      forms,
      groups: groups.sort((a, b) => a.name.localeCompare(b.name)),
      missing,
      // Empty groups grant nothing today but will the moment someone is added,
      // which makes them the quietest way for access to change.
      empty: groups.filter((g) => !g.members.length).map((g) => g.name),
    });
  } catch (err) {
    console.error('admin-access:', err);
    return json(502, { error: err instanceof Error ? err.message : 'Could not read the directory' });
  }
}
