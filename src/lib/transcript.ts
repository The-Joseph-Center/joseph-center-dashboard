/**
 * Coffee Chat transcripts, straight from the caption export.
 *
 * The editor exports one caption file per microphone — `coffee-with-<guest>-<speaker>.txt`,
 * with `-bonus-` in the name for the bonus segment — and each cue is a
 * timecode line followed by a few words. Nothing in a file says who is
 * speaking; the filename does. So the conversation is rebuilt by labelling
 * every cue with its file's speaker, sorting all of them by start time and
 * folding consecutive cues from the same speaker into one turn.
 */

export interface TranscriptFile { name: string; text: string }

interface Cue { ms: number; speaker: string; text: string }

/**
 * One timecode, in any of the three shapes these files arrive in.
 *
 * `hh:mm:ss:ff`   the editor's .txt export — frames, not milliseconds
 * `hh:mm:ss,mmm`  SubRip (.srt)
 * `mm:ss.mmm`     WebVTT (.vtt), which may omit the hour
 */
const TC = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}[.,:;]\d{2,3}`;

/**
 * A cue's time range.
 *
 * The separator is `-->` in SRT and WebVTT and a bare `-` in the editor's
 * export, and WebVTT may put cue settings ("align:start position:50%") after
 * the end time. Only `.txt` was matched before, which meant a dropped .srt or
 * .vtt was not recognised as captions at all — the picker offers both.
 */
const CUE = new RegExp(String.raw`^(${TC})\s*(?:-->|-)\s*${TC}(?:\s+\S.*)?$`);

/** A standalone number: a SubRip cue index, not something anyone said. */
const INDEX_LINE = /^\d{1,5}$/;

/** WebVTT's header and its comment, styling and region blocks. */
const VTT_NOISE = /^(?:WEBVTT\b.*|NOTE\b.*|STYLE|REGION)$/;

/** A timecode as milliseconds, so cues from different formats sort together. */
function toMs(timecode: string): number {
  const m = new RegExp(String.raw`^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,:;](\d{2,3})$`).exec(timecode.trim());
  if (!m) return 0;
  const [, h, mm, ss, frac] = m;
  // Three digits are milliseconds; two are frames, which only ever decide the
  // order of cues inside the same second. 30fps is close enough for that.
  const sub = frac!.length === 3 ? Number(frac) : Math.round((Number(frac) / 30) * 1000);
  return ((Number(h ?? 0) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + sub;
}

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** Speaker and segment from the filename; the last dash-separated word is the speaker. */
export function describeFile(name: string): { speaker: string; bonus: boolean } {
  const stem = name.replace(/\.[^.]+$/, '');
  const parts = stem.split('-').filter(Boolean);
  const bonus = parts.some((p) => p.toLowerCase() === 'bonus');
  return { speaker: titleCase(parts[parts.length - 1] ?? stem), bonus };
}

function parseCues(text: string, speaker: string): Cue[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim());
  const cues: Cue[] = [];
  let current: Cue | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = CUE.exec(line);
    if (m) {
      if (current?.text) cues.push(current);
      current = { ms: toMs(m[1]!), speaker, text: '' };
      continue;
    }
    if (!line || VTT_NOISE.test(line)) continue;
    // A SubRip index sits on its own line before the cue it numbers. Appended
    // as speech it became a stray number in the middle of someone's sentence.
    if (INDEX_LINE.test(line)) {
      const next = lines.slice(i + 1).find(Boolean);
      if (next && CUE.test(next)) continue;
    }
    if (current) current.text = current.text ? `${current.text} ${line}` : line;
  }

  if (current?.text) cues.push(current);
  return cues;
}

/** A listener's "yeah" over the top of someone else's answer, not a turn of its own. */
const BACKCHANNEL = /^(?:(?:yeah|yes|yep|no|okay|ok|right|wow|mhm|uh[- ]?huh|sure|exactly|amen|oh|absolutely|correct|true|got it|i know|i get it|of course|yes ma'?am|no ma'?am|thank you|nice|good|great|wonderful|beautiful|really|hmm)[\s.,!?]*)+$/i;

/** Minutes and seconds, for a reader who needs to know what happened when. */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

function interleave(files: TranscriptFile[]): string {
  const cues = files
    .flatMap((f) => parseCues(f.text, describeFile(f.name).speaker))
    // Compared as milliseconds, not as text: the three formats write a
    // timecode differently, so string order is only right within one of them.
    // Ties keep file order.
    .sort((a, b) => a.ms - b.ms);

  const turns: { speaker: string; ms: number; text: string; asides: string[] }[] = [];
  for (const c of cues) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === c.speaker) { last.text += ` ${c.text}`; continue; }
    // An interjection while someone else is answering is recorded beside their
    // turn rather than splitting it, so the answer stays one continuous thought.
    const aside = BACKCHANNEL.test(c.text.trim());
    if (last && aside) { last.asides.push(`${c.speaker}: ${c.text.trim()}`); continue; }
    if (aside && !last) continue;
    // Fold an earlier turn back together when only an aside came between.
    const prior = turns[turns.length - 2];
    if (last && prior && prior.speaker === c.speaker && !last.text.trim()) { prior.text += ` ${c.text}`; continue; }
    turns.push({ speaker: c.speaker, ms: c.ms, text: c.text, asides: [] });
  }

  return turns
    .map((t) => {
      const said = `[${clock(t.ms)}] ${t.speaker.toUpperCase()}: ${t.text.replace(/\s+/g, ' ').trim()}`;
      return t.asides.length ? `${said}\n(${t.asides.join(' / ')})` : said;
    })
    .join('\n\n');
}

/** True when a file looks like a caption export rather than an already-written transcript. */
export function isCaptionExport(text: string): boolean {
  return text.split(/\r?\n/).slice(0, 20).some((l) => CUE.test(l.trim()));
}

/** The whole conversation, interview first and bonus after, speaker-labelled. */
export function assembleTranscript(files: TranscriptFile[]): string {
  const main = files.filter((f) => !describeFile(f.name).bonus);
  const bonus = files.filter((f) => describeFile(f.name).bonus);
  const parts: string[] = [];
  if (main.length) parts.push(interleave(main));
  if (bonus.length) parts.push(`— BONUS CONTENT —\n\n${interleave(bonus)}`);
  return parts.join('\n\n');
}
