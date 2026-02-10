/**
 * FFmpeg Web Worker for client-side video processing
 * Handles initialization, video processing with effects, and progress reporting.
 */

import { buildFilterString } from '../effects-shared.js';

let ffmpeg = null;
let isInitialized = false;
/**
 * Race a promise against a timeout
 * @param {Promise} promise - Promise to race
 * @param {number} ms - Timeout in milliseconds
 * @param {string} label - Label for timeout error
 * @returns {Promise}
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    )
  ]);
}

/**
 * Initialize FFmpeg.wasm with multi-threaded core (fallback to single-threaded)
 * @param {boolean} singleThreadOnly - Skip multi-threaded attempt
 */
async function initFFmpeg(singleThreadOnly = false) {
  try {
    // Dynamic imports from CDN
    const { FFmpeg } = await import('https://esm.sh/@ffmpeg/ffmpeg@0.12.15');
    const { toBlobURL } = await import('https://esm.sh/@ffmpeg/util@0.12.2');

    // Self-hosted class worker (same-origin, so blob URLs are accessible)
    const classWorkerURL = new URL('./ffmpeg-class-worker.js', import.meta.url).href;

    ffmpeg = new FFmpeg();

    // Try multi-threaded core first (skip on mobile)
    if (!singleThreadOnly) {
      try {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm';
        await withTimeout(ffmpeg.load({
          classWorkerURL,
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
        }), 30000, 'Multi-threaded FFmpeg load');
        isInitialized = true;
        self.postMessage({ type: 'init-complete', mode: 'multi-threaded' });
        return;
      } catch (mtError) {
        console.warn('Multi-threaded core failed, falling back to single-threaded:', mtError);
        ffmpeg = new FFmpeg();
      }
    }

    // Single-threaded core
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    await withTimeout(ffmpeg.load({
      classWorkerURL,
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    }), 60000, 'Single-threaded FFmpeg load');
    isInitialized = true;
    self.postMessage({ type: 'init-complete', mode: 'single-threaded' });
  } catch (error) {
    self.postMessage({ type: 'init-error', error: error.message });
  }
}

/**
 * Process video with effect
 * @param {Uint8Array} videoData - Input video data
 * @param {Object} effect - Effect parameters
 * @param {string} outputName - Output filename
 */
async function processVideo(videoData, effect, outputName, inputExt) {
  try {
    if (!isInitialized) {
      throw new Error('FFmpeg not initialized');
    }

    // Use correct input extension so FFmpeg identifies the container format
    const inputFilename = 'input' + (inputExt || '.mp4');

    // Write input file (create new Uint8Array to prevent buffer neutering)
    await ffmpeg.writeFile(inputFilename, new Uint8Array(videoData));

    // Build filter string
    const filterString = buildFilterString(effect);

    // Execute FFmpeg with ultrafast preset
    await ffmpeg.exec([
      '-i', inputFilename,
      '-vf', filterString,
      '-preset', 'ultrafast',
      '-c:a', 'copy',
      'output.mp4'
    ]);

    // Read output file
    const outputData = await ffmpeg.readFile('output.mp4');

    // Clean up virtual filesystem
    await ffmpeg.deleteFile(inputFilename);
    await ffmpeg.deleteFile('output.mp4');

    // Transfer result back (zero-copy with transferable)
    self.postMessage(
      { type: 'complete', result: outputData, outputName },
      [outputData.buffer]
    );
  } catch (error) {
    self.postMessage({ type: 'error', error: error.message, outputName });
  }
}

/**
 * Terminate FFmpeg and clean up resources
 */
async function terminateFFmpeg() {
  if (ffmpeg && isInitialized) {
    await ffmpeg.terminate();
    ffmpeg = null;
    isInitialized = false;
  }
}

// Message handler
self.onmessage = async (e) => {
  const { type } = e.data;

  switch (type) {
    case 'init':
      await initFFmpeg(e.data.singleThreadOnly || false);
      break;

    case 'process':
      const { videoData, effect, outputName, inputExt } = e.data;
      await processVideo(videoData, effect, outputName, inputExt);
      break;

    case 'terminate':
      await terminateFFmpeg();
      break;

    default:
      console.warn('Unknown message type:', type);
  }
};
