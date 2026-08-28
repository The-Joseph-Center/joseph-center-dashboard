import { requireCapability, denial } from './_lib/verify-okta';

/**
 * Last month's Coffee Chat videos, from the channel itself.
 *
 * The process document is firm that titles must match YouTube exactly and must
 * never be fabricated or estimated. Typing them by hand is precisely how they
 * stop matching, so they are read from the source instead.
 *
 * Shorts are labelled by duration rather than guessed at — the document notes
 * that shorts are often older footage and must be labelled accurately, and a
 * minute is the line YouTube itself draws.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** ISO 8601 duration (PT1M30S) to seconds. */
function seconds(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireCapability(event.headers, 'newsletter');
  if (!auth.ok) return denial(auth);

  const key = process.env.YOUTUBE_API_KEY;
  const channel = process.env.YOUTUBE_CHANNEL_ID;
  if (!key || !channel) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'YouTube is not connected — YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID need setting in Netlify.' }),
    };
  }

  const month = (event.queryStringParameters?.month ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'A month is required, as YYYY-MM.' }) };
  }

  try {
    // The uploads playlist is the channel's own, and it is the only listing
    // that includes shorts alongside regular uploads.
    const chan = await (await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel}&key=${key}`
    )).json() as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]; error?: { message: string } };
    if (chan.error) throw new Error(chan.error.message);
    const uploads = chan.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error('No uploads playlist for that channel');

    const [y, m] = month.split('-').map(Number);
    const from = Date.UTC(y!, m! - 1, 1);
    const to = Date.UTC(y!, m!, 1);

    // Walk back through uploads until we are past the month. Newest first, so
    // this stops early rather than paging the whole channel.
    const found: { id: string; title: string; publishedAt: string }[] = [];
    let pageToken = '';
    for (let page = 0; page < 6; page++) {
      const res = await (await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ''}`
      )).json() as {
        items?: { snippet: { title: string }; contentDetails: { videoId: string; videoPublishedAt?: string } }[];
        nextPageToken?: string; error?: { message: string };
      };
      if (res.error) throw new Error(res.error.message);
      let olderThanMonth = false;
      for (const item of res.items ?? []) {
        const at = item.contentDetails.videoPublishedAt;
        if (!at) continue;
        const t = Date.parse(at);
        if (t >= to) continue;
        if (t < from) { olderThanMonth = true; continue; }
        found.push({ id: item.contentDetails.videoId, title: item.snippet.title, publishedAt: at });
      }
      if (olderThanMonth || !res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }

    // One extra call for durations, so shorts are labelled rather than guessed.
    let durations: Record<string, number> = {};
    if (found.length) {
      const details = await (await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${found.map((v) => v.id).join(',')}&key=${key}`
      )).json() as { items?: { id: string; contentDetails: { duration: string } }[] };
      durations = Object.fromEntries((details.items ?? []).map((i) => [i.id, seconds(i.contentDetails.duration)]));
    }

    const videos = found
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
      .map((v) => ({
        title: v.title,
        url: `https://youtu.be/${v.id}`,
        publishedAt: v.publishedAt.slice(0, 10),
        kind: durations[v.id] && durations[v.id]! <= 60 ? 'Short' : 'Episode',
      }));

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ month, videos }) };
  } catch (err) {
    console.error('youtube-videos:', err);
    return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Could not reach YouTube. Add them by hand, or try again.' }) };
  }
}
