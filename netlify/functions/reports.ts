import { requireCapability, denial } from './_lib/verify-okta';
import { hasCapability } from '../../src/lib/capabilities';
import { turso } from './_lib/staff-directory';
import type { MonthlyReport } from './_lib/report';

/**
 * The stored monthly reports, for reading.
 *
 * Reads only. Reports are written by the scheduled function or by the generate
 * script; nothing a browser can call creates or changes one, because a report
 * that can be rewritten from the page it is read on is not a record.
 *
 * Giving figures are taken out for anyone without the capability to see them.
 * The rest of the report — visits, forms, speed — is the same for everyone who
 * can open the page, so two people discussing "September" are discussing the
 * same September.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function handler(event: {
  headers: Record<string, string | undefined>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'analytics');
  if (!auth.ok) return denial(auth);

  const db = turso();
  const month = (event.queryStringParameters?.month ?? '').trim();

  try {
    const months = (await db.execute('SELECT month FROM site_reports ORDER BY month DESC'))
      .rows.map((r) => String(r.month));

    if (!months.length) {
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ months: [], report: null }) };
    }

    const wanted = month && months.includes(month) ? month : months[0]!;
    const { rows } = await db.execute({ sql: 'SELECT data FROM site_reports WHERE month = ?', args: [wanted] });

    let report: MonthlyReport | null = null;
    try {
      report = JSON.parse(String(rows[0]?.data ?? 'null'));
    } catch (err) {
      console.error('reports: stored report could not be read', wanted, err);
    }

    if (report && !hasCapability(auth.groups, 'taxData')) {
      delete report.giving;
      // The summary sentences are written at build time and one of them names
      // the month's giving, so it goes with the section rather than leaking
      // the figure in prose.
      report.summary = report.summary.filter((s) => !/was given online/.test(s));
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ months, report }),
    };
  } catch (err) {
    console.error('reports:', err);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not read the reports' }) };
  }
}
