import { verifyRequest, denial } from './_lib/verify-okta';
import { accessToken, googleAuthMode } from './_lib/google-sheets';

/**
 * Free/busy for the calendars involved in booking a Coffee Chat.
 *
 * Uses Google's freeBusy endpoint, not events.list, which is a deliberate
 * privacy choice as much as a technical one: freeBusy answers "is this block
 * taken?" and returns start/end times only — no titles, no attendees, no
 * descriptions. Staff scheduling an interview need to know Mona is not free at
 * eleven; they do not need to see what she is doing instead.
 *
 * Calendars come from GOOGLE_CALENDAR_IDS, comma-separated. Anything the
 * authorised account cannot see is reported back as unreadable rather than
 * silently treated as free — an empty answer from a calendar nobody shared is
 * indistinguishable from a genuinely open morning, and that is exactly the
 * mistake that double-books someone.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const json = (statusCode: number, body: unknown) => ({
  statusCode, headers: JSON_HEADERS, body: JSON.stringify(body),
});

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await verifyRequest(event.headers);
  if (!auth.ok) return denial(auth);

  const ids = (process.env.GOOGLE_CALENDAR_IDS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) {
    return json(200, { configured: false, reason: 'No calendars configured.' });
  }
  if (!googleAuthMode()) {
    return json(200, { configured: false, reason: 'Google authorization is not set up.' });
  }

  const q = event.queryStringParameters ?? {};
  const from = q.from, to = q.to;
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return json(400, { error: 'from and to must be ISO timestamps' });
  }
  if (Date.parse(to) <= Date.parse(from)) {
    return json(400, { error: 'to must be after from' });
  }
  // A month is plenty for proposing a slot, and bounds what one call can pull.
  if (Date.parse(to) - Date.parse(from) > 31 * 24 * 3600 * 1000) {
    return json(400, { error: 'Range must be 31 days or less' });
  }

  try {
    const token = await accessToken();
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        timeZone: 'America/Denver',
        items: ids.map((id) => ({ id })),
      }),
    });
    const data = await res.json() as {
      calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      const message = data.error?.message ?? `freeBusy failed (${res.status})`;
      return json(502, {
        error: /insufficient authentication scopes/i.test(message)
          ? 'The saved Google authorization does not include calendar access. Re-run scripts/google-oauth.mjs to grant it.'
          : message,
      });
    }

    const calendars = Object.entries(data.calendars ?? {}).map(([id, c]) => ({
      id,
      readable: !c.errors?.length,
      reason: c.errors?.[0]?.reason ?? null,
      busy: c.busy ?? [],
    }));

    return json(200, {
      configured: true,
      from, to,
      calendars,
      // Merged across every readable calendar, so the caller can ask one
      // question — "is this slot clear?" — instead of intersecting them.
      busy: mergeBusy(calendars.filter((c) => c.readable).flatMap((c) => c.busy)),
      unreadable: calendars.filter((c) => !c.readable).map((c) => c.id),
    });
  } catch (err) {
    console.error('calendar-availability:', err);
    return json(502, { error: err instanceof Error ? err.message : 'Could not read availability' });
  }
}

/** Overlapping or touching busy blocks collapse into one. */
function mergeBusy(blocks: { start: string; end: string }[]) {
  const sorted = [...blocks].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const out: { start: string; end: string }[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && Date.parse(b.start) <= Date.parse(last.end)) {
      if (Date.parse(b.end) > Date.parse(last.end)) last.end = b.end;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}
