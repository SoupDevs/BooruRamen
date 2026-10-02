// Pin weights and labels together; never combine a new vocabulary with old weights.
export const TAGGER_MODEL = {
  name: 'WD SwinV2 Tagger v3',
  revision: '627aef95638667ddcaa3ac8ae625e88ea5b02f51',
  baseUrl: 'https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/resolve/627aef95638667ddcaa3ac8ae625e88ea5b02f51/',
  bytes: 467460978 + 308468,
  sha256: 'e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1',
  cache: 'booruramen-wd-swinv2-v3-627aef9',
};

export function parseTagLabels(csv) {
  // RFC4180 quoting matters for tags containing commas or quotation marks.
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if (char === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift() || [];
  const name = headers.indexOf('name'), category = headers.indexOf('category');
  if (name < 0 || category < 0) throw new Error('The tag model vocabulary is invalid.');
  return rows.filter(row => row[name]).map(row => ({ name: row[name], category: Number(row[category]) }));
}

export function rgbaToBgr(pixels) {
  const tensor = new Float32Array(pixels.length / 4 * 3);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
    tensor[j] = pixels[i + 2];
    tensor[j + 1] = pixels[i + 1];
    tensor[j + 2] = pixels[i];
  }
  return tensor; // NHWC, BGR, 0..255, matching the model author's preprocessing
}

export function selectAiTags(labels, probabilities) {
  if (labels.length !== probabilities.length) throw new Error('The tag model and vocabulary do not match.');
  return labels.map((label, i) => ({ ...label, confidence: Number(probabilities[i]) }))
    .filter(tag => [0, 4].includes(tag.category) && tag.confidence >= (tag.category === 4 ? 0.85 : 0.5))
    .sort((a, b) => b.confidence - a.confidence).slice(0, 64);
}
