export const VISUAL_FEATURE_COUNT = 97; // 32 descriptors, 64 dHash bits, presence
export const IMAGE_ANALYSIS_VERSION = 1;

// RGBA pixels from a 32x32, aspect-preserving thumbnail. All math runs in a
// worker; descriptors deliberately describe appearance rather than tag identity.
export function extractImageFeatures(pixels, width = 32, height = 32) {
  const features = new Array(32).fill(0);
  const luminance = new Float32Array(width * height);
  let sum = 0, squares = 0, saturation = 0, colorful = 0, edgesX = 0, edgesY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const offset = i * 4;
      const a = pixels[offset + 3] / 255;
      const r = pixels[offset] / 255 * a + 1 - a;
      const g = pixels[offset + 1] / 255 * a + 1 - a;
      const b = pixels[offset + 2] / 255 * a + 1 - a;
      const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luminance[i] = light;
      sum += light;
      squares += light * light;
      const cell = Math.min(3, Math.floor(y * 4 / height)) * 4 + Math.min(3, Math.floor(x * 4 / width));
      features[cell] += light / (width * height / 16);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      saturation += max ? delta / max : 0;
      if (delta > 0.05) {
        let hue = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
        features[16 + Math.min(7, Math.floor(hue / 6 * 8))]++;
        colorful++;
      }
      if (x) edgesX += Math.abs(light - luminance[i - 1]);
      if (y) edgesY += Math.abs(light - luminance[i - width]);
      features[30] += light < 0.2 ? 1 : 0;
      features[31] += light > 0.8 ? 1 : 0;
    }
  }
  for (let i = 16; i < 24; i++) features[i] /= Math.max(1, colorful);
  const n = width * height;
  features[24] = sum / n;
  features[25] = Math.sqrt(Math.max(0, squares / n - features[24] ** 2));
  features[26] = saturation / n;
  features[27] = colorful / n;
  features[28] = edgesX / n;
  features[29] = edgesY / n;
  features[30] /= n;
  features[31] /= n;

  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const row = Math.min(height - 1, Math.floor((y + 0.5) * height / 8)) * width;
      const left = Math.min(width - 1, Math.floor(x * width / 9));
      const right = Math.min(width - 1, Math.floor((x + 1) * width / 9));
      bits += luminance[row + left] > luminance[row + right] ? '1' : '0';
    }
  }
  let perceptualHash = '';
  for (let i = 0; i < 64; i += 4) perceptualHash += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return { version: IMAGE_ANALYSIS_VERSION, composition: features, perceptualHash };
}

export function writeVisualFeatures(features, offset, analysis) {
  if (analysis?.version !== IMAGE_ANALYSIS_VERSION || analysis.composition?.length !== 32) return;
  for (let i = 0; i < 32; i++) features[offset + i] = Math.max(0, Math.min(1, Number(analysis.composition[i]) || 0));
  if (/^[a-f0-9]{16}$/i.test(analysis.perceptualHash || '')) {
    const bits = [...analysis.perceptualHash].map(char => parseInt(char, 16).toString(2).padStart(4, '0')).join('');
    for (let i = 0; i < 64; i++) features[offset + 32 + i] = Number(bits[i]);
  }
  features[offset + 96] = 1;
}

export function learningPost(post) {
  const inferred = (post?.imageAnalysis?.aiTags || [])
    .filter(tag => tag.confidence >= (tag.category === 4 ? 0.85 : 0.5) && [0, 4].includes(tag.category))
    .map(tag => tag.name);
  if (!inferred.length) return post;
  // Inferred tags never alter authoritative search filters, ratings or the UI.
  return { ...post, tag_string: [...new Set([...(post.tag_string || post.tags || '').split(/\s+/).filter(Boolean), ...inferred])].join(' ') };
}
