/**
 * Saying how one number compares with another, honestly.
 *
 * A percentage is only meaningful when both figures are big enough to carry
 * one. "Up 50%" for three visits against two is true and useless, and it is
 * the kind of true-and-useless that gets repeated in a board meeting. Below
 * twenty, this says the counts instead and lets the reader judge.
 *
 * The other two rules matter as much:
 *   - No earlier figure at all — a month before tracking began, a source that
 *     was not connected — means no comparison. Never "up 100%" from nothing.
 *   - The same number is "the same as", not "0%", which reads like a failure.
 */

export interface Comparison {
  /** The sentence, ready to show. Empty when there is nothing honest to say. */
  text: string;
  /** For colouring: up is not always good, so the caller decides what it means. */
  direction: 'up' | 'down' | 'same' | 'unknown';
}

export function compare(
  current: number,
  previous: number | null | undefined,
  options: { noun?: string; period?: string } = {}
): Comparison {
  const noun = options.noun ?? 'visits';
  const period = options.period ?? 'the same days last month';

  if (previous === null || previous === undefined) {
    return { text: '', direction: 'unknown' };
  }
  // "The same as the same days last month" is what reads out of a naive
  // template; the comparison phrase only wants its tail here.
  const shortPeriod = period.replace(/^the same days /, '');
  if (current === previous) {
    return { text: `The same as ${shortPeriod}`, direction: 'same' };
  }

  const up = current > previous;
  const direction = up ? 'up' : 'down';

  // Both big enough for a percentage to mean something.
  if (current >= 20 && previous >= 20) {
    const pct = Math.round((Math.abs(current - previous) / previous) * 100);
    return { text: `${up ? 'Up' : 'Down'} ${pct}% on ${period}`, direction };
  }

  const one = (n: number) => `${n} ${n === 1 ? noun.replace(/s$/, '') : noun}`;
  return { text: `${one(current)}, compared with ${previous} by this point ${shortPeriod}`, direction };
}

/** What a card says when its source has never been connected. */
export const NOT_CONNECTED = {
  analytics: 'Visitor figures appear here once analytics is connected.',
  submissions: 'Nothing has come in through the website yet.',
} as const;
