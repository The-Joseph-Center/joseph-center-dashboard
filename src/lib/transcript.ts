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

interface Cue { start: string; speaker: string; text: string }

const CUE = /^(\d{2}:\d{2}:\d{2}[:;.]\d{2})\s*-\s*\d{2}:\d{2}:\d{2}[:;.]\d{2}\s*$/;

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
  const cues: Cue[] = [];
  let current: Cue | null = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = CUE.exec(line);
    if (m) {
      if (current?.text) cues.push(current);
      current = { start: (m[1] ?? '').replace(/[;.]/g, ':'), speaker, text: '' };
    } else if (line && current) {
      current.text = current.text ? `${current.text} ${line}` : line;
    }
  }
  if (current?.text) cues.push(current);
  return cues;
}

function interleave(files: TranscriptFile[]): string {
  const cues = files
    .flatMap((f) => parseCues(f.text, describeFile(f.name).speaker))
    // Fixed-width timecodes sort correctly as strings; ties keep file order.
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const turns: { speaker: string; text: string }[] = [];
  for (const c of cues) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === c.speaker) last.text += ` ${c.text}`;
    else turns.push({ speaker: c.speaker, text: c.text });
  }
  return turns.map((t) => `${t.speaker.toUpperCase()}: ${t.text.replace(/\s+/g, ' ').trim()}`).join('\n\n');
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
