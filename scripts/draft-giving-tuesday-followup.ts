/**
 * The Giving Tuesday 2026 follow-up — the report back, sent Dec 2 or 3.
 *
 * One version to the whole list, not three. The tier tags record who had given
 * BEFORE Giving Tuesday, which is not who gave ON it, so splitting by tier
 * would sort people by the wrong fact. And the thing being reported is the same
 * for everybody. Mona signs it, as she would a thank-you.
 *
 * Shaped like the recurring-donor version of the ask: no button, Mona's
 * signature, and the closing slot carrying something that is not a request.
 * That means it is reviewed under the same rules and rendered by the same
 * `campaignHtml`, so it cannot drift from the newsletter shell.
 *
 * ── It cannot be finished before Dec 1 ──
 *
 * The number of people who gave is the whole point of the email and does not
 * exist yet, so it is `[[COUNT]]` until the day is over. The script reports any
 * placeholder still in the copy, loudly, and will not let you forget one.
 *
 * Run: node scripts/draft-giving-tuesday-followup.ts [out-dir]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  blankCampaign, reviewCampaign, variantSpec, type CampaignEmail,
} from '../netlify/functions/_lib/campaign-email.ts';
import { campaignHtml, campaignText } from '../netlify/functions/_lib/newsletter-html.ts';

const SLUG = 'giving-tuesday-2026-thanks';

/** The one tier whose shape this borrows: no button, Mona signing. */
const SHAPE = 'recurring-donor';

const BODY = [
  'Our first Giving Tuesday has come and gone, and [[COUNT]] of you gave.',
  'We did not know what to expect from it. What came in goes where we said it would — general operating expenses: meals, supplies, staff, and keeping the doors unlocked on an ordinary Thursday in January when nobody is watching.',
  'If you gave, thank you. If you pointed somebody our way, that counted too. And if you did neither, you are still part of why this works — a bridge stands on a community, not on one Tuesday.',
].join('\n\n');

export const CAMPAIGN: CampaignEmail = {
  ...blankCampaign(SLUG, 'Giving Tuesday 2026 — thank you'),
  sendDate: '2026-12-02',
  // Not an ask, so the closing slot carries the standing promise instead: the
  // figures are published quarterly whether or not anybody asks for them.
  closingNote:
    'Every quarter we publish what came in and where it went, at [josephcentergj.com/transparency](https://josephcentergj.com/transparency).',
  variants: {
    ...blankCampaign(SLUG).variants,
    [SHAPE]: {
      subject: 'What our first Giving Tuesday did',
      previewText: 'A short report back, and thank you.',
      body: BODY,
    },
  },
};

function main() {
  const outDir = process.argv[2] ?? join('..', 'docs', 'giving-tuesday-2026');
  mkdirSync(outDir, { recursive: true });

  const spec = variantSpec(SHAPE)!;
  let outstanding = 0;
  for (const variantId of [undefined, SHAPE]) {
    const { issues } = reviewCampaign({ campaign: CAMPAIGN, variantId });
    for (const i of issues) {
      outstanding++;
      console.error(`${i.severity === 'must' ? 'FIX  ' : 'CHECK'} ${i.where}: ${i.problem}\n      ${i.fix}`);
    }
  }

  const input = {
    body: BODY,
    buttonLabel: CAMPAIGN.buttonLabel,
    buttonUrl: CAMPAIGN.link,
    showButton: spec.showButton,
    closingNote: CAMPAIGN.closingNote,
    signature: spec.signature,
  };
  writeFileSync(join(outDir, 'followup-thanks.html'), campaignHtml(input));
  writeFileSync(join(outDir, 'followup-thanks.txt'), campaignText(input));

  const copy = CAMPAIGN.variants[SHAPE]!;
  const words = BODY.trim().split(/\s+/).filter(Boolean).length;
  console.log(
    `Follow-up (one version)  ${String(words).padStart(3)} words  ` +
    `subject ${copy.subject.length} chars  preview ${copy.previewText.length} chars  ` +
    `no button  signed ${spec.signature}`,
  );
  console.log(`\nWritten to ${outDir}: followup-thanks.html, followup-thanks.txt`);

  // The placeholders are the point of the gate: this email is a report, and a
  // report with a blank in it is not sendable.
  const left = [...new Set(BODY.match(/\[\[[A-Z_]+\]\]/g) ?? [])];
  if (left.length) {
    console.log(`\n  NOT SENDABLE YET — fill in ${left.join(', ')} once Dec 1 is over,`);
    console.log('  then re-run this script. Everything else is reviewed and ready.');
  }

  if (outstanding) {
    console.error(`\n${outstanding} review item${outstanding === 1 ? '' : 's'} outstanding.`);
    process.exit(1);
  }
  console.log('\nReview: nothing outstanding.');
}

main();
