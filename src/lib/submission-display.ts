/**
 * Turning stored submission values into something a person can read.
 *
 * The public forms store their multi-value answers as JSON, which is right for
 * storage and unreadable in a table: the volunteer inbox was showing
 * `["whereverNeeded"]` and a nested availability object rather than "Wherever
 * I'm needed" and the days someone can actually come in.
 *
 * Three shapes turn up, so three treatments. Anything unrecognised falls
 * through to the raw string rather than being mangled — a value nobody
 * anticipated is better shown as-is than silently reformatted into nonsense.
 */

/** Slugs the volunteer form submits, and the wording it showed the person. */
const VOLUNTEER_AREAS: Record<string, string> = {
  dayShelter: 'Day Shelter',
  kitchen: 'Kitchen',
  familyCenter: 'Family Center',
  events: 'Events',
  intakes: 'Intakes',
  goldenGirlsProject: 'Golden Girls Project',
  whereverNeeded: "Wherever I'm needed",
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const PARTS = ['morning', 'afternoon', 'evening'] as const;

/**
 * The previous site's form offered two fixed shifts per day and stored the
 * chosen one as a single string, where the current form stores three booleans.
 * Both shapes end up in the same inbox, so both are read here.
 */
const SLOTS: Record<string, string> = {
  '9to12': '9am–12pm',
  '12to3': '12pm–3pm',
};
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** camelCase or snake_case key to something readable: whyJC -> "Why JC". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The availability grid, as a sentence.
 *
 * A day with all three parts ticked reads better as "all day" than as a list,
 * and a day with nothing ticked should not appear at all — most of the object
 * is false, and printing the falses is what made it unreadable.
 */
export function formatAvailability(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!DAYS.some((d) => d in v)) return null;
  if (v.anytime === true) return 'Anytime';

  const parts: string[] = [];
  for (const day of DAYS) {
    const slot = v[day];
    if (!slot) continue;
    // The old form: one shift per day, as a string. "none" is a real stored
    // value meaning the day was not offered, not a missing key.
    if (typeof slot === 'string') {
      if (!slot || slot === 'none') continue;
      parts.push(`${title(day)} ${SLOTS[slot] ?? slot}`);
      continue;
    }
    if (typeof slot !== 'object') continue;
    const on = PARTS.filter((p) => (slot as Record<string, unknown>)[p] === true);
    if (!on.length) continue;
    parts.push(on.length === PARTS.length ? `${title(day)} all day` : `${title(day)} ${on.join(' & ')}`);
  }
  return parts.length ? parts.join(' · ') : 'No times selected';
}

/**
 * A list of answers, mapped through the wording the person actually saw.
 *
 * A list of objects — the previous form's work history is three of them — is
 * not a comma-joined line; each entry is its own block, or every one renders as
 * "[object Object]".
 */
function formatList(items: unknown[]): string {
  if (items.some((i) => i && typeof i === 'object' && !Array.isArray(i))) {
    return items
      .map((i) => (i && typeof i === 'object' ? formatObject(i as Record<string, unknown>) : String(i ?? '')))
      .filter(Boolean)
      .join('\n\n');
  }
  return items
    .map((i) => (typeof i === 'string' ? VOLUNTEER_AREAS[i] ?? i : String(i)))
    .filter(Boolean)
    .join(', ');
}

/**
 * A bag of extra answers as label/value lines.
 *
 * Empty strings, nulls and `false` are dropped: an unticked box is not an
 * answer, and a column of "No" against every optional question buries the ones
 * that were answered.
 */
function formatObject(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [k, raw] of Object.entries(obj)) {
    if (raw === null || raw === undefined || raw === '' || raw === false) continue;
    const availability = formatAvailability(raw);
    const value = availability
      ? availability
      : Array.isArray(raw) ? formatList(raw)
      : typeof raw === 'object' ? JSON.stringify(raw)
      : raw === true ? 'Yes'
      : String(raw);
    if (value) lines.push(`${humanizeKey(k)}: ${value}`);
  }
  return lines.join('\n');
}

/** Readable text for one stored value, whatever shape it arrived in. */
export function formatSubmissionValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw !== 'string') {
    if (Array.isArray(raw)) return formatList(raw);
    if (typeof raw === 'object') return formatAvailability(raw) ?? formatObject(raw as Record<string, unknown>);
    return String(raw);
  }

  const trimmed = raw.trim();
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Text that merely looks like JSON stays exactly as it was written.
    return raw;
  }
  if (Array.isArray(parsed)) return formatList(parsed);
  if (parsed && typeof parsed === 'object') {
    return formatAvailability(parsed) ?? formatObject(parsed as Record<string, unknown>);
  }
  return String(parsed);
}
