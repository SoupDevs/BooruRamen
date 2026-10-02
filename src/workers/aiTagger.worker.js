import { TAGGER_MODEL, parseTagLabels, rgbaToBgr, selectAiTags } from '../services/wdTagger.js';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

let session, labels, ort, controller;
let preparePromise;

async function prepare(id) {
  if (session) return true;
  const cache = await caches.open(TAGGER_MODEL.cache);
  controller = new AbortController();
  let loaded = 0;
  let lastProgress = 0;
  for (const file of ['selected_tags.csv', 'model.onnx']) {
    const url = TAGGER_MODEL.baseUrl + file;
    const cached = await cache.match(url);
    if (cached) { loaded += file === 'model.onnx' ? 467460978 : 308468; continue; }
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Model download failed (HTTP ${response.status}).`);
    const progress = new TransformStream({
      transform(chunk, stream) {
        loaded += chunk.byteLength;
        if (performance.now() - lastProgress > 150) {
          lastProgress = performance.now();
          self.postMessage({ id, progress: Math.min(1, loaded / TAGGER_MODEL.bytes), loaded, phase: 'downloading' });
        }
        stream.enqueue(chunk);
      }
    });
    // Stream to disk. Do not accumulate a 468 MB download on the UI thread.
    await cache.put(url, new Response(response.body.pipeThrough(progress), { headers: response.headers }));
  }
  self.postMessage({ id, progress: 1, loaded, phase: 'initializing' });
  const bytes = await (await cache.match(TAGGER_MODEL.baseUrl + 'model.onnx')).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha !== TAGGER_MODEL.sha256) {
    await cache.delete(TAGGER_MODEL.baseUrl + 'model.onnx');
    throw new Error('The downloaded model failed its integrity check. Please retry.');
  }
  labels = parseTagLabels(await (await cache.match(TAGGER_MODEL.baseUrl + 'selected_tags.csv')).text());
  ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1; // Leave CPU capacity for the feed and its media.
  ort.env.wasm.proxy = false; // Already off the UI thread.
  ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return true;
}

async function tagImage(blob) {
  if (!session) throw new Error('The local tag model is not ready.');
  const bitmap = await createImageBitmap(blob);
  try {
    const size = 448;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    const scale = size / Math.max(bitmap.width, bitmap.height);
    const w = bitmap.width * scale, h = bitmap.height * scale;
    context.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    const data = rgbaToBgr(context.getImageData(0, 0, size, size).data);
    const input = new ort.Tensor('float32', data, [1, size, size, 3]);
    const output = await session.run({ [session.inputNames[0]]: input });
    try { return selectAiTags(labels, output[session.outputNames[0]].data); }
    finally { input.dispose(); Object.values(output).forEach(tensor => tensor.dispose()); }
  } finally { bitmap.close(); }
}

self.onmessage = async ({ data: { id, type, blob } }) => {
  if (type === 'cancel') { controller?.abort(); return; }
  try {
    let result;
    if (type === 'prepare') {
      if (!preparePromise) preparePromise = prepare(id).catch(error => { preparePromise = null; throw error; });
      result = await preparePromise;
    } else if (type === 'tag') result = await tagImage(blob);
    else throw new Error('Unknown image tagger request.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
