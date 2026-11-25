import { requireCapability, denial } from './_lib/verify-okta';
import { turso } from './_lib/staff-directory';
import {
  CAMPAIGN_VARIANTS, blankCampaign, reviewEveryVersion, variantSpec,
  type CampaignEmail, type CampaignVariantCopy, type Override,
} from './_lib/campaign-email';
import { campaignHtml, campaignText } from './_lib/newsletter-html';

/**
 * One-off campaign emails, assembled.
 *
 * The same shape and the same restraint as `admin-newsletter`: it builds the
 * three versions, runs the review, and does not touch AWeber. Creating the
 * broadcast and scheduling it stay with a person, because a campaign email is
 * dated to one morning and there is no undoing a send.
 *
 * Both bodies — HTML and plain text — are rendered here from the one stored
 * `body` string, so the copy button cannot hand out a version that says
 * something different from the one on screen.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clean = (v: unknown, max = 20000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const parse = <T,>(v: unknown, fallback: T): T => {
  try { return typeof v === 'string' ? JSON.parse(v) as T : fallback; } catch { return fallback; }
};

/** How many review items one campaign may have set aside. */
const MAX_OVERRIDES = 100;

/**
 * Dismissed review items, stamped where the browser cannot be trusted to.
 *
 * The same rule as the newsletter's: the reason is the writer's to give, and
 * who gave it and when are taken from the verified sign-in the first time the
 * dismissal is seen and then left alone. A dismissal with no reason is dropped
 * — the page asks for one, and this is the half of that which cannot be
 * skipped by posting to the function directly.
 */
function mergeOverrides(posted: unknown, prior: Override[], by: string): Override[] {
  const before = new Map(prior.filter((o) => o?.id).map((o) => [o.id, o]));
  const now = Math.floor(Date.now() / 1000);
  const out: Override[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(posted) ? posted : []) {
    const o = (raw ?? {}) as Partial<Override>;
    const id = clean(o.id, 24);
    const reason = clean(o.reason, 400);
    if (!id || !reason || seen.has(id)) continue;
    seen.add(id);
    const kept = before.get(id);
    out.push({ id, reason, label: clean(o.label, 300) || kept?.label, by: kept?.by ?? by, at: kept?.at ?? now });
    if (out.length >= MAX_OVERRIDES) break;
  }
  return out;
}

type Row = Record<string, unknown>;

function toCampaign(row: Row): CampaignEmail {
  const blank = blankCampaign(String(row.slug ?? ''));
  const stored = parse<Record<string, CampaignVariantCopy>>(row.variants, {});
  return {
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    sendDate: String(row.send_date ?? ''),
    link: String(row.link ?? ''),
    buttonLabel: String(row.button_label ?? ''),
    // Held in the workbench rather than a column of its own: it is one settled
    // sentence, and a column would mean a migration the first time a campaign
    // wants two.
    closingNote: String(parse<{ closingNote?: string }>(row.workbench, {}).closingNote ?? blank.closingNote),
    // Every tier always present, so the page never has to guard a missing one.
    variants: Object.fromEntries(CAMPAIGN_VARIANTS.map((v) => [
      v.id,
      {
        subject: String(stored[v.id]?.subject ?? ''),
        previewText: String(stored[v.id]?.previewText ?? ''),
        body: String(stored[v.id]?.body ?? ''),
      },
    ])),
    status: String(row.status ?? 'draft'),
    sentAt: row.sent_at == null ? null : Number(row.sent_at),
    updatedBy: row.updated_by == null ? null : String(row.updated_by),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

/** Rendered both ways, from the one body, for every tier. */
function render(campaign: CampaignEmail) {
  return CAMPAIGN_VARIANTS.map((spec) => {
    const copy = campaign.variants[spec.id]!;
    const input = {
      body: copy.body,
      buttonLabel: campaign.buttonLabel,
      buttonUrl: campaign.link,
      showButton: spec.showButton,
      closingNote: campaign.closingNote,
      signature: spec.signature,
    };
    return {
      id: spec.id,
      label: spec.label,
      audience: spec.audience,
      signature: spec.signature,
      aweberTag: spec.aweberTag,
      excludes: spec.excludes,
      showButton: spec.showButton,
      subject: copy.subject,
      previewText: copy.previewText,
      html: campaignHtml(input),
      text: campaignText(input),
    };
  });
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'newsletter');
  if (!auth.ok) return denial(auth);

  try {
    const db = turso();

    if (event.httpMethod === 'GET') {
      const slug = clean(event.queryStringParameters?.slug, 80);

      // No slug: the index, for the picker.
      if (!slug) {
        const rows = (await db.execute(
          'SELECT slug, name, send_date, status, sent_at, updated_at, updated_by FROM campaign_emails ORDER BY send_date DESC, slug DESC',
        )).rows as unknown as Row[];
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            campaigns: rows.map((r) => ({
              slug: String(r.slug), name: String(r.name ?? ''), sendDate: String(r.send_date ?? ''),
              status: String(r.status ?? 'draft'),
              sentAt: r.sent_at == null ? null : Number(r.sent_at),
              updatedAt: Number(r.updated_at ?? 0),
              updatedBy: r.updated_by == null ? null : String(r.updated_by),
            })),
            variants: CAMPAIGN_VARIANTS,
          }),
        };
      }

      if (!SLUG.test(slug)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A campaign is identified by a lowercase slug, like "giving-tuesday-2026".' }) };
      }

      const row = (await db.execute({ sql: 'SELECT * FROM campaign_emails WHERE slug = ?', args: [slug] }))
        .rows[0] as unknown as Row | undefined;
      // An unsaved campaign opens as a blank one rather than a 404: the page
      // is where a campaign is created, and there is nothing to save until
      // something has been typed into it.
      const campaign = row ? toCampaign(row) : blankCampaign(slug);
      const workbench = row ? parse<Record<string, unknown>>(row.workbench, {}) : {};
      const overrides = Array.isArray(workbench.overrides) ? workbench.overrides as Override[] : [];
      const { issues, dismissed, stale } = reviewEveryVersion(campaign, overrides);

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          campaign, workbench, issues, dismissed, staleOverrides: stale,
          exists: !!row,
          versions: render(campaign),
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
    const slug = clean(body.slug, 80);
    if (!SLUG.test(slug)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A campaign needs a lowercase slug, like "giving-tuesday-2026".' }) };
    }

    const prior = (await db.execute({ sql: 'SELECT workbench, status FROM campaign_emails WHERE slug = ?', args: [slug] }))
      .rows[0] as unknown as { workbench?: string; status?: string } | undefined;
    const priorOverrides = parse<{ overrides?: Override[] }>(prior?.workbench, {}).overrides ?? [];

    if (clean(body.action, 20) === 'sent') {
      await db.execute({
        sql: `UPDATE campaign_emails SET status='sent', sent_at=unixepoch(), updated_by=?, updated_at=unixepoch() WHERE slug=?`,
        args: [auth.email ?? 'unknown', slug],
      });
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ status: 'sent' }) };
    }

    const sendDate = clean(body.sendDate, 10);
    if (sendDate && !/^\d{4}-\d{2}-\d{2}$/.test(sendDate)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The send date goes in as YYYY-MM-DD.' }) };
    }

    const variants = Object.fromEntries(CAMPAIGN_VARIANTS.map((v) => {
      const posted = ((body.variants ?? {}) as Record<string, Partial<CampaignVariantCopy>>)[v.id] ?? {};
      return [v.id, {
        subject: clean(posted.subject, 300),
        previewText: clean(posted.previewText, 300),
        body: clean(posted.body, 20000),
      }];
    }));

    const workbench = {
      ...((body.workbench ?? {}) as Record<string, unknown>),
      closingNote: clean(body.closingNote, 600),
      overrides: mergeOverrides(((body.workbench ?? {}) as Record<string, unknown>).overrides, priorOverrides, auth.email ?? 'unknown'),
    };

    await db.execute({
      sql: `INSERT INTO campaign_emails
              (slug, name, send_date, link, button_label, variants, workbench, updated_by, updated_at)
            VALUES (?,?,?,?,?,?,?,?,unixepoch())
            ON CONFLICT(slug) DO UPDATE SET
              name=excluded.name, send_date=excluded.send_date, link=excluded.link,
              button_label=excluded.button_label, variants=excluded.variants,
              workbench=excluded.workbench, updated_by=excluded.updated_by,
              updated_at=unixepoch()`,
      args: [
        slug,
        clean(body.name, 120),
        sendDate,
        clean(body.link, 500),
        clean(body.buttonLabel, 120),
        JSON.stringify(variants),
        JSON.stringify(workbench).slice(0, 100000),
        auth.email ?? 'unknown',
      ],
    });

    // The saved state is sent straight back, so the page is never showing a
    // review of the version before the last keystroke.
    const campaign = toCampaign({
      slug, name: clean(body.name, 120), send_date: sendDate, link: clean(body.link, 500),
      button_label: clean(body.buttonLabel, 120), variants: JSON.stringify(variants),
      workbench: JSON.stringify(workbench), status: prior?.status ?? 'draft',
      sent_at: null, updated_by: auth.email ?? 'unknown', updated_at: Math.floor(Date.now() / 1000),
    });
    const { issues, dismissed, stale } = reviewEveryVersion(campaign, workbench.overrides);

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ saved: true, campaign, issues, dismissed, staleOverrides: stale, versions: render(campaign) }),
    };
  } catch (err) {
    // A missing table is the likely cause before migration 022 is applied, and
    // "could not load" with nothing else is the error that wastes an afternoon.
    if (/no such table: campaign_emails/i.test(String(err))) {
      console.error('admin-campaign-email: migration 022 has not been applied');
      return {
        statusCode: 503,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'The campaign_emails table does not exist yet — apply db/migrations/022_campaign_emails.sql.' }),
      };
    }
    console.error('admin-campaign-email:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not load the campaign email.' }) };
  }
}
