/**
 * The Giving Tuesday 2026 copy, run through the campaign review.
 *
 * This machine cannot reach Turso — the credentials are deliberately out of
 * reach — so the row cannot be seeded from here. What this does instead is
 * hold the copy in one place, put it through the same `reviewCampaign` the
 * dashboard runs, render both bodies with the same `campaignHtml`/
 * `campaignText` the function uses, and emit:
 *
 *   • the three HTML bodies and the three plain-text bodies, as files
 *   • one INSERT that seeds the campaign_emails row
 *
 * It exits non-zero if the review has anything outstanding, so "the copy
 * follows the Do/Don't list" is a thing that was checked rather than a thing
 * somebody meant to check.
 *
 * Run: node scripts/draft-giving-tuesday-2026.ts [out-dir]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CAMPAIGN_VARIANTS, blankCampaign, reviewCampaign, variantSpec,
  type CampaignEmail,
} from '../netlify/functions/_lib/campaign-email.ts';
import { campaignHtml, campaignText } from '../netlify/functions/_lib/newsletter-html.ts';

const SLUG = 'giving-tuesday-2026';

/**
 * The chosen subject and preview per version.
 *
 * The alternates are in docs/giving-tuesday-2026-copy.md rather than here: the
 * tool stores one of each, and a second one sitting in the source is a line
 * nobody can see from the page they are editing.
 */
export const CAMPAIGN: CampaignEmail = {
  ...blankCampaign(SLUG, 'Giving Tuesday 2026'),
  sendDate: '2026-12-01',
  // Exactly as the brief gives it. No extra parameters.
  link: `https://josephcentergj.com/donate?campaign=${SLUG}`,
  buttonLabel: 'Give Today →',
  closingNote:
    'It is a name. If somebody comes to mind who should know we are here, point them to [josephcentergj.com](https://josephcentergj.com).',
  variants: {
    // ── A: everyone who is not tagged as a donor ──
    'community-friend': {
      subject: 'Today is our first Giving Tuesday',
      previewText: 'An open invitation to help keep the bridge standing.',
      body: [
        'Today is Giving Tuesday, and it is the first one The Joseph Center has ever taken part in.',
        'For a decade this has been the bridge from crisis to stability on the Western Slope of Colorado — five programs across 16 counties, about 5,600 guests a year who come for a hot lunch, somewhere warm to sit, or somewhere safe to sleep.',
        'Whatever is given today goes to general operating expenses — meals, supplies, staff, and the unglamorous work of keeping the doors unlocked. The Joseph Center is 100% community and foundation funded: the bridge stands because this community keeps it standing.',
        'If you would like to be part of that today, any amount helps.',
        'Thank you for being here.',
      ].join('\n\n'),
    },

    // ── B: donor, repeat-donor, vip, vip-repeat, vip-engaged ──
    donor: {
      subject: 'Thank you, today and every day',
      previewText: 'A quiet invitation on our first Giving Tuesday.',
      body: [
        'You have already given to The Joseph Center, and today seemed like the right morning to say so plainly: thank you.',
        'Today is Giving Tuesday — our first — and nothing about it changes what your giving has already made possible for guests across the Western Slope of Colorado.',
        'If you would like to give again today, the door is open and any amount helps. If not, you have already done the thing we would otherwise be asking for, and we are grateful.',
      ].join('\n\n'),
    },

    // ── B without the ask: recurring-donor ──
    'recurring-donor': {
      subject: 'Thank you — and one small favor',
      previewText: 'Your monthly gift already covers today. There is one other thing.',
      body: [
        // Deliberately not "there is no ask in this one": announcing the
        // absence of an ask is a negative lede, and this version does ask for
        // something. The pivot is the third line.
        'Today is Giving Tuesday, our first — and you are already giving every month.',
        'Your monthly partnership is what lets us plan rather than hope: meals cooked, doors unlocked, and a yes available when somebody walks in on a Tuesday with nowhere else to go. It is the quiet, steady kind of support that makes a program something a person can rely on.',
        'So the one thing we would ask of you today is not money.',
      ].join('\n\n'),
    },
  },
};

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`;

function main() {
  const outDir = process.argv[2] ?? join('..', 'docs', 'giving-tuesday-2026');
  mkdirSync(outDir, { recursive: true });

  // ── the review, across every version plus the campaign-wide fields ──
  let outstanding = 0;
  for (const variantId of [undefined, ...CAMPAIGN_VARIANTS.map((v) => v.id)]) {
    const { issues } = reviewCampaign({ campaign: CAMPAIGN, variantId });
    for (const i of issues) {
      outstanding++;
      console.error(`${i.severity === 'must' ? 'FIX  ' : 'CHECK'} ${i.where}: ${i.problem}\n      ${i.fix}`);
    }
  }

  // ── render ──
  for (const spec of CAMPAIGN_VARIANTS) {
    const copy = CAMPAIGN.variants[spec.id]!;
    const input = {
      body: copy.body,
      buttonLabel: CAMPAIGN.buttonLabel,
      buttonUrl: CAMPAIGN.link,
      showButton: spec.showButton,
      closingNote: CAMPAIGN.closingNote,
      signature: spec.signature,
    };
    writeFileSync(join(outDir, `${spec.id}.html`), campaignHtml(input));
    writeFileSync(join(outDir, `${spec.id}.txt`), campaignText(input));
    const words = copy.body.trim().split(/\s+/).filter(Boolean).length;
    console.log(
      `${spec.label.padEnd(22)} ${String(words).padStart(3)} words  ` +
      `subject ${String(copy.subject.length).padStart(2)} chars  ` +
      `preview ${String(copy.previewText.length).padStart(3)} chars  ` +
      `${spec.showButton ? 'button' : 'no button'}`,
    );
  }

  // ── the seed ──
  const variants = JSON.stringify(CAMPAIGN.variants);
  const workbench = JSON.stringify({ closingNote: CAMPAIGN.closingNote, overrides: [] });
  writeFileSync(
    join(outDir, 'seed.sql'),
    `-- Seeds the Giving Tuesday 2026 campaign email. Re-runnable: it overwrites
-- the copy for this slug and leaves any other campaign alone. Apply migration
-- 022_campaign_emails.sql first.
INSERT INTO campaign_emails (slug, name, send_date, link, button_label, variants, workbench, updated_by, updated_at)
VALUES (${sql(SLUG)}, ${sql(CAMPAIGN.name)}, ${sql(CAMPAIGN.sendDate)}, ${sql(CAMPAIGN.link)},
        ${sql(CAMPAIGN.buttonLabel)}, ${sql(variants)}, ${sql(workbench)}, 'seed', unixepoch())
ON CONFLICT(slug) DO UPDATE SET
  name=excluded.name, send_date=excluded.send_date, link=excluded.link,
  button_label=excluded.button_label, variants=excluded.variants,
  workbench=excluded.workbench, updated_by=excluded.updated_by, updated_at=unixepoch();
`,
  );

  console.log(`\nWritten to ${outDir}: three .html, three .txt, seed.sql`);
  if (outstanding) {
    console.error(`\n${outstanding} review item${outstanding === 1 ? '' : 's'} outstanding — the copy is not ready.`);
    process.exit(1);
  }
  console.log('Review: nothing outstanding on any version.');
}

main();
