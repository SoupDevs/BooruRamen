export const normalizeTag = value => String(value || '').toLowerCase().trim();
export const sourceKey = value => String(value || '').trim().replace(/\/+$/, '');

export function scoreTag(tag, query) {
  const t = normalizeTag(tag), q = normalizeTag(query);
  if (!t || !q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/[_\s\-/]+/).some(part => part.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length ? 4 : null;
}

export function rankTags(tags, query, limit = 10, exclude = []) {
  const skip = new Set(exclude.map(normalizeTag)), seen = new Set(), best = [];
  const compare = (a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]);
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (skip.has(tag) || seen.has(tag)) continue;
    const score = scoreTag(tag, query);
    if (score === null) continue;
    seen.add(tag);
    best.push([score, tag]); best.sort(compare);
    if (best.length > limit) best.pop();
  }
  return best.map(entry => entry[1]);
}
