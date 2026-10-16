import { buildReport, saveReport } from './_lib/report';

/**
 * Writes the report for the month that just ended.
 *
 * Runs daily from the 3rd and exits immediately once the month is written, so
 * a failed run — Simple Analytics timing out, Stripe rate-limiting — is picked
 * up the next day without anyone noticing or running a script.
 *
 * The 3rd rather than the 1st: analytics keeps settling a month's last days
 * for a day or two, and a report that changes after Mona has read it is worse
 * than one that arrives two days later.
 *
 * Never rewrites a month that already exists. A report is a snapshot, and a
 * snapshot that moves is not one.
 */
export async function handler() {
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;

  try {
    const report = await buildReport(month);
    const written = await saveReport(report, 'monthly-report', false);

    console.log('monthly-report:', JSON.stringify({
      month, written,
      sections: Object.entries({
        visits: !!report.visits, submissions: !!report.submissions,
        speed: !!report.speed, giving: !!report.giving, newsletter: !!report.newsletter,
      }).filter(([, v]) => v).map(([k]) => k),
    }));

    return { statusCode: 200, body: JSON.stringify({ month, written }) };
  } catch (err) {
    console.error('monthly-report:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'report failed' }) };
  }
}
