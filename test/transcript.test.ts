/**
 * Caption files, as they actually arrive.
 *
 * The file picker offers .txt, .srt and .vtt, and until now only the first was
 * recognised as captions at all — a dropped .srt fell through to the "already
 * written transcript" path and went to the model as a wall of cue indices and
 * timecodes. So most of what is pinned here is that all three formats land on
 * the same prose, and that nothing a caption file carries for the machine
 * reaches the page as something a person said.
 *
 * Run: node --test test/transcript.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleTranscript, describeFile, isCaptionExport,
} from '../src/lib/transcript.ts';

/** The editor's export: frames, and a bare hyphen between the timecodes. */
const FRAMES = `00:00:01:12 - 00:00:04:08
I grew up here, mostly.
00:00:12:00 - 00:00:16:10
And then everything fell apart at once.`;

/** SubRip: an index line, a comma before the milliseconds, and an arrow. */
const SRT = `1
00:00:01,120 --> 00:00:04,080
I grew up here, mostly.

2
00:00:12,000 --> 00:00:16,100
And then everything fell apart at once.`;

/** WebVTT: a header, a full stop before the milliseconds, and cue settings. */
const VTT = `WEBVTT

NOTE recorded on a phone

00:00:01.120 --> 00:00:04.080 align:start position:0%
I grew up here, mostly.

00:00:12.000 --> 00:00:16.100
And then everything fell apart at once.`;

const guest = (text: string) => [{ name: 'coffee-with-jane-guest.txt', text }];

test('all three caption formats are recognised as captions', () => {
  for (const [what, text] of [['frames', FRAMES], ['srt', SRT], ['vtt', VTT]] as const) {
    assert.ok(isCaptionExport(text), `${what} should be read as a caption export`);
  }
});

test('all three produce the same transcript', () => {
  const [a, b, c] = [FRAMES, SRT, VTT].map((t) => assembleTranscript(guest(t)));
  assert.equal(a, b, 'srt should match the editor export');
  assert.equal(b, c, 'vtt should match too');
  assert.match(a!, /GUEST: I grew up here, mostly\. And then everything fell apart at once\./);
});

test('a SubRip index never reaches the page as speech', () => {
  // "2" sat on its own line before the second cue, and was appended to the
  // first cue's text — a stray number in the middle of a sentence.
  const out = assembleTranscript(guest(SRT));
  assert.ok(!/mostly\. 2/.test(out), 'the index was folded into the words');
  assert.ok(!/\b2\b/.test(out.replace(/\[[^\]]*\]/g, '')), 'no bare index anywhere in the prose');
});

test("WebVTT's header, notes and cue settings are not spoken either", () => {
  const out = assembleTranscript(guest(VTT));
  assert.ok(!/WEBVTT/.test(out));
  assert.ok(!/recorded on a phone/.test(out));
  assert.ok(!/align:start|position:0%/.test(out));
});

test('a timecode becomes a clock a person can use', () => {
  const out = assembleTranscript(guest(FRAMES));
  assert.match(out, /^\[0:01\]/, 'minutes and seconds, not frames');
});

test('an hour in is read as an hour, not as 60-odd minutes', () => {
  const out = assembleTranscript(guest(`01:02:03,500 --> 01:02:08,000
Much later in the conversation.`));
  assert.match(out, /\[1:02:03\]/);
});

test('cues from different formats sort together, not format by format', () => {
  // Mona's mic exported as .srt and the guest's as the editor .txt — the real
  // case. Sorted as text, every cue from one file preceded every cue from the
  // other and the conversation came out as two monologues.
  const out = assembleTranscript([
    { name: 'coffee-with-jane-mona.srt', text: `1
00:00:02,000 --> 00:00:03,000
So tell me where you grew up.` },
    { name: 'coffee-with-jane-guest.txt', text: `00:00:04:00 - 00:00:06:00
Right here, mostly.
00:00:20:00 - 00:00:22:00
And it was hard.` },
    { name: 'coffee-with-jane-mona.srt', text: `2
00:00:10,000 --> 00:00:12,000
And after that?` },
  ]);
  const speakers = [...out.matchAll(/^\[[^\]]+\] (\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(speakers, ['MONA', 'GUEST', 'MONA', 'GUEST'], 'they should alternate');
});

test('a listener\'s "yeah" is kept beside the answer, not made a turn', () => {
  const out = assembleTranscript([
    { name: 'coffee-with-jane-guest.srt', text: `1
00:00:01,000 --> 00:00:03,000
It took me two years to get back on my feet.` },
    { name: 'coffee-with-jane-mona.srt', text: `1
00:00:02,000 --> 00:00:02,500
Yeah.` },
  ]);
  // Asides keep the speaker as written; only a turn's own speaker is shouted.
  assert.match(out, /\(Mona: Yeah\.\)/);
  assert.ok(!/^\[[^\]]+\] MONA:/m.test(out), 'it is not a turn of its own');
});

test('an already-written transcript is not mistaken for captions', () => {
  // The paste path has to keep working: no cue lines means no cue parsing.
  const prose = 'Jane told me she grew up in Grand Junction and left at nineteen.';
  assert.ok(!isCaptionExport(prose));
});

test('a number in the middle of what someone said survives', () => {
  // INDEX_LINE only skips a bare number when a cue line follows it, so a
  // figure on its own line inside an answer is still speech.
  const out = assembleTranscript(guest(`00:00:01:00 - 00:00:03:00
I was sleeping in my car for
14
months before I came here.`));
  assert.match(out, /sleeping in my car for 14 months/);
});

test('the speaker comes from the end of the filename, bonus marked', () => {
  assert.deepEqual(describeFile('coffee-with-jane-guest.srt'), { speaker: 'Guest', bonus: false });
  assert.deepEqual(describeFile('coffee-with-jane-bonus-mona.vtt'), { speaker: 'Mona', bonus: true });
});

test('the bonus segment is kept separate and comes last', () => {
  const out = assembleTranscript([
    { name: 'coffee-with-jane-bonus-guest.srt', text: `1
00:00:01,000 --> 00:00:03,000
One more thing I wanted to say.` },
    { name: 'coffee-with-jane-guest.srt', text: `1
00:00:01,000 --> 00:00:03,000
The main conversation.` },
  ]);
  assert.ok(out.indexOf('The main conversation') < out.indexOf('— BONUS CONTENT —'));
  assert.ok(out.indexOf('— BONUS CONTENT —') < out.indexOf('One more thing'));
});

test('an empty caption file yields nothing rather than a header', () => {
  // What the panel now reports as "those files loaded, but no captions could
  // be read out of them" — it must be an empty string to be detectable.
  assert.equal(assembleTranscript(guest('')), '');
  assert.equal(assembleTranscript([]), '');
});
