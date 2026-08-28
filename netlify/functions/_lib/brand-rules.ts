/**
 * The mechanical half of the brand check.
 *
 * Section 7 of the brand reference is a literal table of words to avoid and
 * what to use instead. That is a string search, not a judgement, so it runs
 * here: free, instant, and it cannot miss one or invent one. The model is left
 * to the parts that actually need reading comprehension — framing, tone,
 * whether a specific claim needs checking.
 *
 * Severity is about consequence, not confidence:
 *   must     breaks a rule the brand reference states outright
 *   should   drifts from the guidance in a way a reader would notice
 *   consider worth a look, may well be fine
 */

export type Severity = 'must' | 'should' | 'consider';

export interface Finding {
  severity: Severity;
  rule: string;
  quote: string;
  why: string;
  suggestion: string;
}

interface Rule {
  /** Matched case-insensitively against the post. */
  pattern: RegExp;
  severity: Severity;
  rule: string;
  why: string;
  suggestion: string;
  /** Skip when the post is clearly about this program — see `ifsContext`. */
  unlessIfs?: boolean;
}

const RULES: Rule[] = [
  {
    pattern: /\bclients?\b/gi,
    severity: 'must',
    rule: 'Guests, not clients',
    why: 'Everyone The Joseph Center serves is a guest. "Client" is only right in an IFS case-management context, where the phrase is "the people we serve".',
    suggestion: 'guests',
    unlessIfs: true,
  },
  {
    pattern: /\btransitional housing\b/gi,
    severity: 'must',
    rule: 'Temporary housing',
    why: '"Transitional housing" is not the term used for the Golden Girls Project or any housing programme.',
    suggestion: 'temporary housing',
  },
  {
    pattern: /\b(?:the homeless|homeless (?:people|men|women|individuals))\b/gi,
    severity: 'must',
    rule: 'People first',
    why: 'Homelessness is a circumstance, not an identity.',
    suggestion: 'guests experiencing homelessness',
  },
  {
    pattern: /\bhand-?outs?\b/gi,
    severity: 'must',
    rule: 'A hand up, not a handout',
    why: 'The bridge framing is the whole positioning — "handout" contradicts it.',
    suggestion: 'a hand up, or a bridge to independence',
  },
  {
    pattern: /\bbuild(?:ing)? (?:a|the) bridge\b/gi,
    severity: 'must',
    rule: 'Sustain the bridge',
    why: 'The bridge already exists. The ask is to keep it standing, not to start it.',
    suggestion: 'sustain the bridge',
  },
  {
    pattern: /\b(?:less fortunate|those in need|the needy)\b/gi,
    severity: 'must',
    rule: 'Community partnership',
    why: 'Charity framing puts the reader above the people served rather than alongside them.',
    suggestion: 'community partnership language',
  },
  {
    pattern: /\bcharity\b/gi,
    severity: 'should',
    rule: 'Community, not charity',
    why: 'Accurate as a legal status, but as framing it is the opposite of the partnership the brand asks for. Fine in "charitable deduction"; not fine describing the work.',
    suggestion: 'community partnership',
  },
  {
    pattern: /\bMesa County\b/g,
    severity: 'should',
    rule: 'Western Slope, not one county',
    why: 'The organisation serves 16 counties. Naming only Mesa County understates the scope.',
    suggestion: 'the Western Slope of Colorado',
  },
];

/**
 * Does the post look like it is about Integrated Financial Services?
 *
 * IFS is the one context where "the people we serve" is correct and "guests"
 * would be a tone mismatch, so the terminology rule has to know which kind of
 * post it is reading before it can be applied.
 */
const ifsContext = (text: string) =>
  /\b(?:IFS|integrated financial services|case management|financial coaching)\b/i.test(text);

/** Line and column for a match offset, so the editor can point at it. */
function locate(text: string, index: number) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - before.lastIndexOf('\n') };
}

/** A short excerpt around a match, for showing the writer what was found. */
function excerpt(text: string, index: number, length: number) {
  const from = Math.max(0, index - 40);
  const to = Math.min(text.length, index + length + 40);
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ').trim() + (to < text.length ? '…' : '');
}

export function checkTerminology(text: string): (Finding & { line: number })[] {
  const isIfs = ifsContext(text);
  const found: (Finding & { line: number })[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (rule.unlessIfs && isIfs) continue;
    for (const m of text.matchAll(rule.pattern)) {
      if (m.index === undefined) continue;
      // One finding per rule per line — a word repeated in a paragraph is one
      // thing to fix, not five things to read past.
      const { line } = locate(text, m.index);
      const dedupe = `${rule.rule}:${line}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      found.push({
        severity: rule.severity,
        rule: rule.rule,
        quote: excerpt(text, m.index, m[0].length),
        why: rule.why,
        suggestion: rule.suggestion,
        line,
      });
    }
  }
  return found;
}
