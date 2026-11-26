import { requireCapability, denial } from './_lib/verify-okta';
import { turso } from './_lib/staff-directory';
import {
  aweberConfig, missingScopes, listDrafts, createDraft, REQUIRED_SCOPES,
} from './_lib/aweber';
import {
  CAMPAIGN_VARIANTS, blankCampaign, blockingFor,
  type CampaignEmail, type CampaignVariantCopy, type Override,
} from './_lib/campaign-email';
import { campaignHtml, campaignText } from './_lib/newsletter-html';
import { JSON_HEADERS } from './_lib/http';

/**
 * Builds the campaign email's three drafts in AWeber.
 *
 * The same two-step shape as `newsletter-aweber`, and deliberately stopping
 * one step earlier. That one can apply the monthly tag, which is the send;
 * this one cannot send anything at all. A campaign email goes out as a
 * broadcast to a segment at a chosen minute, and choosing the segment and the
 * minute is the whole job — there is nothing a button here could do except get
 * it wrong on somebody's behalf.
 *
 *   GET          reports whether AWeber is reachable, which scopes are
 *                granted, what the review says, and which drafts already
 *                exist. Reads only.
 *
 *   POST drafts  creates one draft per version from the SAVED row, so the
 *                drafts are the copy that was reviewed rather than an edit
 *                made in the seconds since.
 *
 * ── Why this does not dedupe by subject ──
 *
 * The newsletter does, and can: each tier's subject is generated from the
 * month, so the three differ by construction. A campaign email's subjects are
 * written by hand and may legitimately match — Giving Tuesday's donor and
 * recurring-donor versions are both "Thank you, today and every day", because
 * they are the same message to the same kind of reader and the difference is
 * the ask, not the envelope. Subject matching would have created two drafts
 * and skipped the third as already done.
 *
 * So the broadcast ids are recorded in the campaign's workbench as they are
 * made, and a re-run skips what it has a record of. That is idempotent whatever
 * the subjects say, and it survives two campaigns a month sharing wording.
 */

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const parse = <T,>(v: unknown, fallback: T): T => {
  try { return typeof v === 'string' ? JSON.parse(v) as T : fallback; } catch { return fallback; }
};

/** What was built, per version, so a second run does not build it again. */
interface BuiltDraft { id: number; subject: string; at: number }

interface Loaded {
  campaign: CampaignEmail;
  overrides: Override[];
  built: Record<string, BuiltDraft>;
  workbench: Record<string, unknown>;
}

async function load(slug: string): Promise<Loaded | null> {
  const db = turso();
  const row = (await db.execute({ sql: 'SELECT * FROM campaign_emails WHERE slug = ?', args: [slug] }))
    .rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return null;

  const workbench = parse<Record<string, unknown>>(row.workbench, {});
  const blank = blankCampaign(slug);
  const stored = parse<Record<string, CampaignVariantCopy>>(row.variants, {});
  return {
    campaign: {
      slug,
      name: String(row.name ?? ''),
      sendDate: String(row.send_date ?? ''),
      link: String(row.link ?? ''),
      buttonLabel: String(row.button_label ?? ''),
      closingNote: String(workbench.closingNote ?? blank.closingNote),
      variants: Object.fromEntries(CAMPAIGN_VARIANTS.map((v) => [v.id, {
        subject: String(stored[v.id]?.subject ?? ''),
        previewText: String(stored[v.id]?.previewText ?? ''),
        body: String(stored[v.id]?.body ?? ''),
      }])),
      status: String(row.status ?? 'draft'),
      sentAt: row.sent_at == null ? null : Number(row.sent_at),
      updatedBy: row.updated_by == null ? null : String(row.updated_by),
      updatedAt: Number(row.updated_at ?? 0),
    },
    overrides: Array.isArray(workbench.overrides) ? workbench.overrides as Override[] : [],
    built: (workbench.aweberDrafts ?? {}) as Record<string, BuiltDraft>,
    workbench,
  };
}

const render = (campaign: CampaignEmail, spec: typeof CAMPAIGN_VARIANTS[number]) => {
  const copy = campaign.variants[spec.id]!;
  const input = {
    body: copy.body,
    buttonLabel: campaign.buttonLabel,
    buttonUrl: campaign.link,
    showButton: spec.showButton,
    closingNote: campaign.closingNote,
    signature: spec.signature,
  };
  return { subject: copy.subject, html: campaignHtml(input), text: campaignText(input) };
};

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'newsletter');
  if (!auth.ok) return denial(auth);

  const cfg = aweberConfig();
  if (!cfg) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'AWeber is not connected — the AWEBER_* variables need setting in Netlify.' }),
    };
  }

  try {
    const slug = clean(
      event.queryStringParameters?.slug || (JSON.parse(event.body || '{}') as { slug?: string }).slug,
      80,
    );
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A campaign slug is required.' }) };
    }

    const loaded = await load(slug);
    if (!loaded) {
      return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: 'That campaign has not been saved yet.' }) };
    }
    const { campaign, overrides, built, workbench } = loaded;
    const blocking = blockingFor(campaign, overrides);

    // ── check: read-only ──
    if (event.httpMethod === 'GET') {
      const missing = await missingScopes(cfg);
      if (missing.length) {
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({
            ready: false, missingScopes: missing, requiredScopes: REQUIRED_SCOPES,
            error: `AWeber has not granted ${missing.join(', ')}. Re-authorize with the wider scopes.`,
          }),
        };
      }

      /**
       * The drafts AWeber admits to.
       *
       * `status=draft` lists only drafts created through the API; one built by
       * hand in AWeber's editor is invisible here. So an id we recorded and
       * AWeber no longer lists means somebody deleted it there, and saying so
       * is more use than quietly rebuilding it.
       */
      const live = await listDrafts(cfg);
      const liveIds = new Set(live.map((d) => d.id));

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          ready: blocking.length === 0,
          blocking,
          status: campaign.status,
          versions: CAMPAIGN_VARIANTS.map((spec) => {
            const record = built[spec.id];
            return {
              id: spec.id,
              label: spec.label,
              subject: campaign.variants[spec.id]!.subject,
              builtId: record?.id ?? null,
              builtAt: record?.at ?? null,
              // Built once and since deleted in AWeber — rebuildable.
              missingInAweber: !!record && !liveIds.has(record.id),
            };
          }),
          apiDraftCount: live.length,
        }),
      };
    }

    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}') as { action?: string; rebuild?: string[] };
    if (clean(body.action, 20) !== 'drafts') {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'The only action is "drafts".' }) };
    }

    /**
     * Refused while anything is outstanding.
     *
     * The disabled button on the page is a courtesy; this is the part that
     * means it. A draft sitting in AWeber is a draft somebody will send.
     */
    if (blocking.length) {
      return {
        statusCode: 409,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: `${blocking.length} thing${blocking.length === 1 ? '' : 's'} still to fix before the drafts can be built.`,
          blocking,
        }),
      };
    }

    const missing = await missingScopes(cfg);
    if (missing.length) {
      return {
        statusCode: 503,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: `AWeber has not granted ${missing.join(', ')}.`, missingScopes: missing }),
      };
    }

    // Named versions only, so a deleted draft can be remade without touching
    // the two that are fine.
    const rebuild = new Set((body.rebuild ?? []).map((s) => clean(s, 40)));
    const live = new Set((await listDrafts(cfg)).map((d) => d.id));

    const made: {
      tier: string; id: string; subject: string;
      broadcastId?: number; skipped?: boolean; error?: string;
    }[] = [];
    const nextBuilt: Record<string, BuiltDraft> = { ...built };

    for (const spec of CAMPAIGN_VARIANTS) {
      const record = built[spec.id];
      const stillThere = !!record && live.has(record.id);
      if (record && stillThere && !rebuild.has(spec.id)) {
        made.push({ tier: spec.label, id: spec.id, subject: record.subject, broadcastId: record.id, skipped: true });
        continue;
      }

      const { subject, html, text } = render(campaign, spec);
      try {
        const created = await createDraft(cfg, { subject, html, text });
        nextBuilt[spec.id] = { id: created.id, subject, at: Math.floor(Date.now() / 1000) };
        made.push({ tier: spec.label, id: spec.id, subject, broadcastId: created.id });
      } catch (err) {
        // One version failing must not lose the record of the ones that
        // worked, or a retry would duplicate them.
        made.push({ tier: spec.label, id: spec.id, subject, error: String(err instanceof Error ? err.message : err) });
      }
    }

    /**
     * The record is written whatever happened.
     *
     * Written after the drafts rather than before, and its own failure is
     * logged rather than raised — the drafts exist by then, and reporting
     * "could not build" over a bookkeeping error invites a second run that
     * duplicates all three. The same ordering as the Coffee Chat invite, for
     * the same reason.
     */
    let recorded = true;
    try {
      const db = turso();
      await db.execute({
        sql: `UPDATE campaign_emails SET workbench = ?, updated_by = ?, updated_at = unixepoch() WHERE slug = ?`,
        args: [JSON.stringify({ ...workbench, aweberDrafts: nextBuilt }).slice(0, 100000), auth.email ?? 'unknown', slug],
      });
    } catch (err) {
      recorded = false;
      console.error('campaign-aweber: drafts built, but could not record them:', err);
    }

    const failed = made.filter((m) => m.error);
    return {
      statusCode: failed.length ? 502 : 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        drafts: made,
        recorded,
        // Carried back so the page can tell someone what still has to be set
        // by hand: AWeber's API does not take a preview line at all.
        previewTexts: Object.fromEntries(
          CAMPAIGN_VARIANTS.map((v) => [v.id, campaign.variants[v.id]!.previewText]),
        ),
        error: failed.length
          ? `${failed.length} of ${made.length} drafts could not be created. The others are in AWeber.`
          : undefined,
      }),
    };
  } catch (err) {
    if (/no such table: campaign_emails/i.test(String(err))) {
      return {
        statusCode: 503,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'The campaign_emails table does not exist yet — apply db/migrations/022_campaign_emails.sql.' }),
      };
    }
    console.error('campaign-aweber:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not reach AWeber.' }) };
  }
}
