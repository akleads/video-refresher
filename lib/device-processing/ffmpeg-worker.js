/**
 * FFmpeg Web Worker for client-side video processing
 * Handles initialization, video processing with effects, and progress reporting.
 */

import { buildFilterString } from '../effects-shared.js';

let ffmpeg = null;
let isInitialized = false;
let lastProgressPercent = 0;

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

    ffmpeg = new FFmpeg();

    // Try multi-threaded core first (skip on mobile)
    if (!singleThreadOnly) {
      try {
        const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm';
        await withTimeout(ffmpeg.load({
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
 * Parse FFmpeg log output for progress time
 * @param {string} message - FFmpeg log message
 * @returns {number|null} - Seconds elapsed or null if not found
 */
function parseProgressTime(message) {
  const timeMatch = message.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const seconds = parseFloat(timeMatch[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}

/**
 * Process video with effect
 * @param {Uint8Array} videoData - Input video data
 * @param {Object} effect - Effect parameters
 * @param {string} outputName - Output filename
 * @param {number} totalDuration - Total video duration in seconds
 */
async function processVideo(videoData, effect, outputName, totalDuration) {
  try {
    if (!isInitialized) {
      throw new Error('FFmpeg not initialized');
    }

    // Reset progress tracking
    lastProgressPercent = 0;

    // Register progress handler
    ffmpeg.on('log', ({ message }) => {
      const currentTime = parseProgressTime(message);
      if (currentTime !== null && totalDuration > 0) {
        const progress = Math.min(currentTime / totalDuration, 1.0);
        const progressPercent = Math.floor(progress * 100);

        // Throttle to 2% increments
        if (progressPercent >= lastProgressPercent + 2 || progressPercent === 100) {
          lastProgressPercent = progressPercent;
          self.postMessage({ type: 'progress', progress });
        }
      }
    });

    // Write input file (create new Uint8Array to prevent buffer neutering)
    await ffmpeg.writeFile('input.mp4', new Uint8Array(videoData));

    // Build filter string
    const filterString = buildFilterString(effect);

    // Execute FFmpeg with ultrafast preset
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-vf', filterString,
      '-preset', 'ultrafast',
      '-c:a', 'copy',
      'output.mp4'
    ]);

    // Read output file
    const outputData = await ffmpeg.readFile('output.mp4');

    // Clean up virtual filesystem
    await ffmpeg.deleteFile('input.mp4');
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
      const { videoData, effect, outputName, totalDuration } = e.data;
      await processVideo(videoData, effect, outputName, totalDuration);
      break;

    case 'terminate':
      await terminateFFmpeg();
      break;

    default:
      console.warn('Unknown message type:', type);
  }
};
