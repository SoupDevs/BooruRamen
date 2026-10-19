/**
 * Diversity.js
 * Greedy MMR-style re-ranking so the feed does not serve runs of the same
 * artist, character or near-identical image, even when each one scores well
 * on its own. Relevance still dominates: a candidate only loses its place when
 * something almost as good and less repetitive is available.
 */

export const DIVERSITY_WINDOW = 5;
export const DIVERSITY_LAMBDA = 0.35;

const splitTags = value => (value || '').split(/\s+/).filter(Boolean);

function identity(post) {
  if (!post) return null;
  if (!post._identity) {
    Object.defineProperty(post, '_identity', {
      enumerable: false, configurable: true,
      value: {
        artist: new Set(splitTags(post.tag_string_artist)),
        character: new Set(splitTags(post.tag_string_character)),
        copyright: new Set(splitTags(post.tag_string_copyright)),
        hash: /^[a-f0-9]{16}$/i.test(post.imageAnalysis?.perceptualHash || '') ? post.imageAnalysis.perceptualHash : null,
      },
    });
  }
  return post._identity;
}

const shares = (a, b) => { for (const value of a) if (b.has(value)) return true; return false; };

function hammingHex(a, b) {
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { distance += x & 1; x >>= 1; }
  }
  return distance;
}

/** 0..1 redundancy between two posts. */
export function redundancy(a, b) {
  const x = identity(a), y = identity(b);
  if (!x || !y) return 0;
  if (x.hash && y.hash && hammingHex(x.hash, y.hash) <= 10) return 1;
  let similarity = 0;
  if (shares(x.artist, y.artist)) similarity += 0.6;
  if (shares(x.character, y.character)) similarity += 0.4;
  if (shares(x.copyright, y.copyright)) similarity += 0.2;
  return Math.min(1, similarity);
}

/**
 * Reorder scored candidates. `context` holds the posts the user sees right
 * before the first candidate, so the window carries across the boundary.
 * @param {Array<{post, score}>} scored
 * @param {Array<Object>} context
 * @returns {Array<{post, score}>}
 */
export function diversify(scored, context = [], { window = DIVERSITY_WINDOW, lambda = DIVERSITY_LAMBDA } = {}) {
  const remaining = [...scored].sort((a, b) => b.score - a.score);
  const recent = context.slice(-window);
  const result = [];
  while (remaining.length) {
    let bestIndex = 0, bestValue = -Infinity;
    // Only the head of the list can win; scanning it keeps this linear-ish.
    const scan = Math.min(remaining.length, 25);
    for (let i = 0; i < scan; i++) {
      const candidate = remaining[i];
      let penalty = 0;
      for (const shown of recent) penalty = Math.max(penalty, redundancy(candidate.post, shown));
      const value = candidate.score - lambda * penalty;
      if (value > bestValue) { bestValue = value; bestIndex = i; }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    result.push(chosen);
    recent.push(chosen.post);
    if (recent.length > window) recent.shift();
  }
  return result;
}
