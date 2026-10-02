import { extractImageFeatures } from '../services/imageFeatures.js';
import SparkMD5 from 'spark-md5';

self.onmessage = async ({ data: { id, blob, original } }) => {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(32, 32);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 32, 32);
    const scale = 32 / Math.max(bitmap.width, bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    context.drawImage(bitmap, (32 - w) / 2, (32 - h) / 2, w, h);
    const result = extractImageFeatures(context.getImageData(0, 0, 32, 32).data);
    if (original) {
      const bytes = await blob.arrayBuffer();
      result.md5 = SparkMD5.ArrayBuffer.hash(bytes);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      result.sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  } finally {
    bitmap?.close();
  }
};
