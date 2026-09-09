/**
 * Reading a list of people out of whatever file someone actually uploads.
 *
 * Mona works in Excel, so .xlsx is the expected case rather than the exception
 * — a CSV-only importer would fail on the first real attempt. Both are handled
 * here, in the browser, with no dependency: an .xlsx is a ZIP of XML, and
 * DecompressionStream can inflate its entries.
 *
 * If anything about the workbook is unusual enough to defeat this, the caller
 * gets a plain message telling her to save as CSV — which is a fair fallback,
 * but only as a fallback.
 */

export interface ParsedSheet { headers: string[]; rows: string[][] }

/** RFC-4180 enough: addresses carry commas, and notes carry quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// ── Minimal ZIP reader ─────────────────────────────────────────────────────
// Enough of the format to pull named entries out of an .xlsx: walk the local
// file headers, and inflate anything stored with deflate.
async function unzip(buf: ArrayBuffer): Promise<Map<string, string>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const out = new Map<string, string>();
  let i = 0;
  while (i + 30 <= bytes.length) {
    if (view.getUint32(i, true) !== 0x04034b50) break;      // local file header
    const method = view.getUint16(i + 8, true);
    let size = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extraLen;

    // A streamed zip writes 0 here and puts the real sizes in a trailing
    // descriptor. Fall back to scanning for the next header.
    if (!size) {
      let j = start;
      while (j + 4 <= bytes.length && view.getUint32(j, true) !== 0x08074b50) j++;
      size = j - start;
    }
    const chunk = bytes.subarray(start, start + size);

    if (name.endsWith('.xml')) {
      if (method === 0) out.set(name, new TextDecoder().decode(chunk));
      else if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([chunk]).stream().pipeThrough(ds);
        out.set(name, await new Response(stream).text());
      }
    }
    i = start + size + (view.getUint32(start + size, true) === 0x08074b50 ? 16 : 0);
  }
  return out;
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
   .replace(/&amp;/g, '&');

/** Column letters to a zero-based index: A→0, B→1, AA→26. */
function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const sheetName = [...files.keys()].find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k))
    ?? [...files.keys()].find((k) => k.startsWith('xl/worksheets/'));
  const sheet = sheetName ? files.get(sheetName) : undefined;
  if (!sheet) throw new Error('no worksheet');

  // Shared strings: most text cells are a pointer into this table.
  const sharedXml = files.get('xl/sharedStrings.xml') ?? '';
  const shared = [...sharedXml.matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    unescapeXml([...(m[1] ?? '').matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1] ?? '').join(''))
  );

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    const cells: string[] = [];
    for (const cell of (rowMatch[1] ?? '').matchAll(/<c([^>]*)>(.*?)<\/c>/gs)) {
      const attrs = cell[1] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? '';
      const inner = cell[2] ?? '';
      let value = '';
      if (type === 's') {
        const idx = Number(/<v>(\d+)<\/v>/.exec(inner)?.[1] ?? -1);
        value = shared[idx] ?? '';
      } else if (type === 'inlineStr') {
        value = unescapeXml([...inner.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1] ?? '').join(''));
      } else {
        value = unescapeXml(/<v>(.*?)<\/v>/s.exec(inner)?.[1] ?? '');
      }
      // Honour the cell's own column so a blank cell does not shift the rest.
      const at = ref ? colIndex(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    if (cells.some((c) => c.trim())) rows.push(cells);
  }
  return rows;
}

export async function readSheet(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  let grid: string[][];

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    grid = parseCsv(await file.text());
  } else if (name.endsWith('.xlsx')) {
    try {
      grid = await parseXlsx(await file.arrayBuffer());
    } catch {
      throw new Error('That Excel file could not be read. Opening it in Excel and choosing File → Save As → CSV will always work.');
    }
  } else if (name.endsWith('.xls')) {
    // The pre-2007 binary format is a different thing entirely.
    throw new Error('That looks like an older .xls file. Open it in Excel and choose File → Save As → .xlsx or CSV.');
  } else {
    throw new Error('Upload a .csv or .xlsx file.');
  }

  if (!grid.length) throw new Error('That file appears to be empty.');
  const [headers, ...rows] = grid;
  return { headers: (headers ?? []).map((h) => h.trim()), rows };
}

// ── Column matching ────────────────────────────────────────────────────────
// Real files say "First", "First Name", "fname", "Address 1", "Zip Code".
const FIELDS: Record<string, RegExp> = {
  firstName: /^(first|f)[\s_]*(name)?$|^fname$|^given/i,
  lastName:  /^(last|l)[\s_]*(name)?$|^lname$|^surname|^family/i,
  street:    /^(street|address|addr)([\s_]*(1|line[\s_]*1))?$|^mailing/i,
  city:      /^city|^town/i,
  state:     /^state$|^st$|^province/i,
  zip:       /^zip|^postal|^post[\s_]*code/i,
  email:     /^e[\s_-]?mail/i,
};

/** Best-guess mapping from the file's headers to the fields we need. */
export function matchColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [field, re] of Object.entries(FIELDS)) {
    const i = headers.findIndex((h) => re.test(h.trim()));
    if (i !== -1) map[field] = i;
  }
  // "Name" alone, with no first/last: split on the first space.
  if (map.firstName === undefined && map.lastName === undefined) {
    const i = headers.findIndex((h) => /^(full[\s_]*)?name$/i.test(h.trim()));
    if (i !== -1) map.fullName = i;
  }
  return map;
}

export interface Person {
  firstName: string; lastName: string; street: string;
  city: string; state: string; zip: string; email: string;
}

export function toPeople(rows: string[][], map: Record<string, number>): Person[] {
  const at = (r: string[], k: string) => (map[k] === undefined ? '' : (r[map[k]] ?? '').trim());
  return rows.map((r) => {
    let firstName = at(r, 'firstName');
    let lastName = at(r, 'lastName');
    if (map.fullName !== undefined) {
      const whole = at(r, 'fullName');
      if (whole.includes(',')) {
        // "Highline, Mona" — the comma form Excel exports produce, where the
        // surname comes first. Splitting on spaces here gets it backwards.
        const [last, ...rest] = whole.split(',');
        lastName = (last ?? '').trim();
        firstName = rest.join(',').trim();
      } else {
        const parts = whole.split(/\s+/).filter(Boolean);
        firstName = parts.slice(0, -1).join(' ') || parts[0] || '';
        lastName = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
      }
    }
    return {
      firstName, lastName,
      street: at(r, 'street'), city: at(r, 'city'),
      state: at(r, 'state') || 'CO', zip: at(r, 'zip'), email: at(r, 'email'),
    };
  }).filter((p) => p.firstName || p.lastName || p.street);
}
