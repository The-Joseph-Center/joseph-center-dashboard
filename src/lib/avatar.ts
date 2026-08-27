/**
 * A stand-in avatar for anyone with no photo yet.
 *
 * Drawn rather than fetched: no network request, no third-party gravatar
 * lookup leaking staff email addresses to another service, and it works on the
 * first paint. Everything is derived from a hash of the person's login, so the
 * same person always gets the same character — it reads as *theirs* rather than
 * as a placeholder, which is the difference between "no photo yet" and a grey
 * silhouette that says nothing.
 *
 * A sprout, because the alternative to a generic user icon should look like it
 * belongs to this organisation and not to a settings screen.
 */

// FNV-1a. Small, stable, and identical across runs — the point is that Penny's
// avatar is the same one tomorrow.
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Chosen to sit legibly on both the dark sidebar and a white card.
const COLORS = ['#6FBF9B', '#F2B441', '#7FB2E5', '#E58B7F', '#B99BE0', '#74CFC4'];
const INK = '#1F2A24';

export function sillyAvatar(seed: string): string {
  const h = hash((seed || 'someone').toLowerCase().trim());
  // Unsigned shifts throughout: `>>` is signed in JS, so any hash at or above
  // 2^31 produced a negative index and silently dropped the feature it chose.
  const color = COLORS[h % COLORS.length];
  const eyes = (h >>> 3) % 3;
  const mouth = (h >>> 6) % 4;
  const twoLeaves = ((h >>> 9) & 1) === 1;
  const blush = ((h >>> 11) & 1) === 1;
  const tilt = (((h >>> 13) % 9) - 4) * 1.5; // a few degrees either way

  const eye = (cx: number) =>
    eyes === 2
      ? `<path d="M${cx - 4} 34 q4 4 8 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
      : `<circle cx="${cx}" cy="34" r="3.4" fill="${INK}"/>` +
        (eyes === 1 ? `<circle cx="${cx + 1.2}" cy="32.8" r="1.1" fill="#fff"/>` : '');

  // style 2 winks with the left eye only, so the two sides differ
  const eyePair = eyes === 2 ? eye(25) + `<circle cx="39" cy="34" r="3.4" fill="${INK}"/>` : eye(25) + eye(39);

  const mouths = [
    `<path d="M26 44 q6 6 12 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    `<path d="M26 43 q6 8 12 0 z" fill="${INK}"/>`,
    `<ellipse cx="32" cy="45" rx="3" ry="3.4" fill="${INK}"/>`,
    `<path d="M26 44 q3 4 6 0 q3 -4 6 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">
<circle cx="32" cy="32" r="32" fill="${color}" opacity="0.22"/>
<g transform="rotate(${tilt} 32 38)">
<path d="M32 20 v-8" stroke="${color}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
<ellipse cx="38" cy="12" rx="6" ry="3.6" fill="${color}" transform="rotate(-22 38 12)"/>
${twoLeaves ? `<ellipse cx="26" cy="15" rx="5" ry="3.2" fill="${color}" transform="rotate(22 26 15)"/>` : ''}
<rect x="12" y="18" width="40" height="38" rx="19" fill="${color}"/>
${blush ? `<circle cx="18.5" cy="40" r="3" fill="#fff" opacity="0.35"/><circle cx="45.5" cy="40" r="3" fill="#fff" opacity="0.35"/>` : ''}
${eyePair}
${mouths[mouth]}
</g>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}
