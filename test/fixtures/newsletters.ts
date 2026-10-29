/**
 * Two newsletters to test against: one carrying every fault found in the
 * September → October comparison, and one that should pass clean.
 *
 * Both are reconstructions, not the stored rows. The drafts live in Turso and
 * this machine cannot read it (the credentials are deliberately out of reach),
 * so these were rebuilt from the faults as reported and from the shape of the
 * approved months in docs/newsletter-backfill. The names are invented for the
 * same reason: a fixture should not put fabricated quotes in a real guest's
 * mouth. What matters is that each fault is present in the form it took.
 */
import type { NewsletterDraft } from '../../netlify/functions/_lib/newsletter.ts';

/** A short transcript, in the shape assembleTranscript produces. */
const TRANSCRIPT = `[00:04] MONA: Dana, thank you for sitting down with me.
[00:11] DANA: Thanks for having me. I was telling Dana Whitfield's sister about it.
[01:20] DANA: My son Mason was four when we came in.
[02:02] MONA: And you found us through the Day Shelter?
[02:09] DANA: Right. You can reach me on 970-555-0134 if anyone needs to talk to me about it.`;

/**
 * October, as it went out.
 *
 * Faults, in the order the brief lists them: the guest's surname in the prose,
 * a minor's first name that was meant to be withheld, "homeless people" in the
 * narration, [X] left in two places, the tool's own "Program spotlight stat"
 * label, a video title wrapped in quotes twice, no episode link so no Section 1
 * button, and no preview text at all.
 */
export const OCTOBER_AS_SENT: NewsletterDraft = {
  month: '2026-10',
  monthName: 'October',
  guestName: 'Dana',
  guestFrame: 'guest',
  program: 'Day Shelter',
  aweberTag: 'oct-2026-newsletter',
  usedTags: ['sep-2026-newsletter'],
  staffSurnames: ['Highline'],
  transcript: TRANSCRIPT,
  withholdNames: ['Mason'],
  coffeeChatUrl: '',
  previewText: '',
  section1: `This month's Coffee Chat spotlight lands on Dana Whitfield, who first came to us two years ago.

Dana Whitfield had been one of the homeless people sleeping in her car outside the laundromat on Belford. Her son Mason was four. She came in for a hot lunch and stayed for the computers, and within a month she had an interview. "I didn't have my own kitchen," she said. "I didn't have my own bed." The Day Shelter was the first door, and this October she walked back through it to tell us what happened next. We'll share more about where she is working once they're finalized.

${'This is what we mean when we say hope has an address. And this October, we\'re inviting you to help us strengthen the bridge from crisis to stability across the Western Slope of Colorado.'}`,
  section2: `## Day Shelter

The Day Shelter is the first stop on the bridge for anyone who needs help.

**What we provide:**
- Computer access for job applications
- Laundry services
- A safe space for children

In October we served [X] meals and welcomed [X] people through our doors.

Every person who walks through the door for a hot lunch is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.

Need help? Contact us.`,
  stats: {
    'Meals served': '1,418',
    'Individuals welcomed': '362',
    'Program spotlight stat': '96',
    'IFS financial stability': '98%',
  },
  videos: [
    { title: '""I didn\'t have my own bed""', url: 'https://youtu.be/aaaaaaaaaaa' },
    { title: 'Coffee Chat with Dana', url: 'https://youtu.be/bbbbbbbbbbb', kind: 'Episode' },
    { title: 'One minute on the Day Shelter', url: 'https://youtube.com/shorts/ccccccccccc', kind: 'Short' },
  ],
  partners: [{ name: 'Peer 180', url: 'https://peer-180.com' }],
};

/** The same month, with every fault corrected. Nothing here should flag. */
export const OCTOBER_CORRECTED: NewsletterDraft = {
  ...OCTOBER_AS_SENT,
  coffeeChatUrl: 'https://youtu.be/bbbbbbbbbbb',
  previewText: 'This is what a first door looks like at The Joseph Center',
  section1: `## She Came In For Lunch And Left With An Interview

Dana had been sleeping in her car outside the laundromat on Belford, with her four-year-old in the back seat. She came in for a hot lunch on a Tuesday.

She stayed for the computers. "I didn't have my own kitchen," she says of that winter. "I didn't have my own bed." Within a month she had an interview, and she had somewhere to shower before it.

The Day Shelter is the first door for most people who find us, and it is rarely the only one they use. Dana sat down with the Family Center too, and left with a plan she had written herself.

Two years on she came back to tell us what happened next, which is not something anybody owes us. She wanted the room to hear that it moves.

This is what we mean when we say hope has an address. And this October, we're inviting you to help us strengthen the bridge from crisis to stability across the Western Slope of Colorado.`,
  section2: `## The First Door On The Bridge: Day Shelter

Most people who find The Joseph Center find it here, on a weekday morning, because they needed somewhere to be.

The Day Shelter is open to anyone who needs help, and it is where nearly every other program starts.

**What we provide:**
- Hot, homemade lunch served at noon, Tuesday–Friday
- Computer access for job applications
- Laundry services
- A safe space for children
- Open Tuesday–Friday, 9am–1pm

In October we served 1,418 lunches and welcomed 362 people through the doors.

Every person who walks through the door for a hot lunch is walking across the bridge. Where they go from there depends on what they need — but they never walk alone.

Need somewhere to start? Call (970) 985-6133 or come by Tuesday–Friday, 9am–1pm — walk-ins are welcome.`,
  stats: {
    'Meals served': '1,418',
    'Individuals welcomed': '362',
    'Families served': '96',
    'People served through IFS': '214',
  },
  videos: [
    { title: '"I didn\'t have my own bed"', url: 'https://youtu.be/aaaaaaaaaaa', kind: 'Episode' },
    { title: 'Coffee Chat with Dana', url: 'https://youtu.be/bbbbbbbbbbb', kind: 'Episode' },
    { title: 'One minute on the Day Shelter', url: 'https://youtube.com/shorts/ccccccccccc', kind: 'Short' },
  ],
  withholdNames: ['Mason'],
};
