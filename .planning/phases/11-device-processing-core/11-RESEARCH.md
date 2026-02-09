# Phase 11: Device Processing Core - Research

**Researched:** 2026-02-09
**Domain:** Browser-based video processing with FFmpeg.wasm, Web Workers, and client-side ZIP generation
**Confidence:** HIGH

## Summary

Phase 11 implements client-side video processing using FFmpeg.wasm 0.12.x in Web Workers with multi-threaded support, progress tracking, and ZIP file generation. The research confirms FFmpeg.wasm 0.12.x is the current stable version with a mature API, cross-origin isolation (COOP/COEP) is already configured in Phase 10, and client-zip is the optimal choice for streaming ZIP generation over JSZip.

Key findings:
- FFmpeg.wasm 0.12.x uses a fundamentally different API than 0.11.x (breaking changes)
- Multi-threaded processing requires SharedArrayBuffer, which requires cross-origin isolation (already configured)
- client-zip (6.4 kB) is 40x faster than JSZip and designed for streaming
- Dedicated workers are preferable over shared workers for parallel video processing
- Critical memory management: `ffmpeg.writeFile()` uses transferable ArrayBuffers that become neutered after the call
- Worker pool pattern with 2-3 concurrent workers is standard for FFmpeg.wasm

**Primary recommendation:** Use FFmpeg.wasm 0.12.15 with @ffmpeg.wasm/core-mt for multi-threaded processing (falling back to @ffmpeg.wasm/core-st for single-threaded), implement a dedicated worker pool with 2-3 workers for parallel variation processing, and use client-zip for streaming ZIP generation.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @ffmpeg/ffmpeg | 0.12.15 | FFmpeg WebAssembly wrapper | Official FFmpeg.wasm package, mature API, Web Worker support |
| @ffmpeg/util | 0.12.2 | Utility functions for FFmpeg.wasm | Required companion package for fetchFile and toBlobURL utilities |
| @ffmpeg.wasm/core-mt | 0.12.x | Multi-threaded FFmpeg core | ~2x performance vs single-thread, requires SharedArrayBuffer |
| @ffmpeg.wasm/core-st | 0.12.x | Single-threaded FFmpeg core | Fallback when SharedArrayBuffer unavailable |
| client-zip | 2.x | Streaming ZIP generation | 40x faster than JSZip, 6.4 kB minified, designed for streaming |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| workerpool | Latest | Worker pool management (optional) | If implementing custom worker management proves complex |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| client-zip | JSZip 3.10+ | JSZip more feature-rich (compression, reading archives) but 10x larger, 40% slower, weaker streaming support |
| Dedicated workers | Shared workers | Shared workers allow cross-tab communication but add complexity, dedicated workers provide better isolation |
| Custom worker pool | workerpool library | workerpool adds 9 kB but handles edge cases (crashes, timeouts, queuing) |

**Installation:**
```bash
npm install @ffmpeg/ffmpeg @ffmpeg/util client-zip
```

Note: Core packages (@ffmpeg.wasm/core-mt, @ffmpeg.wasm/core-st) are loaded from CDN at runtime, not installed via npm.

## Architecture Patterns

### Recommended Project Structure
```
lib/
├── device-processing/
│   ├── ffmpeg-worker.js     # Web Worker script for FFmpeg operations
│   ├── worker-pool.js       # Pool manager for parallel processing
│   ├── progress-tracker.js  # Aggregates progress from multiple workers
│   └── zip-generator.js     # client-zip wrapper for bundling outputs
views/
├── device-progress.js        # Device processing progress UI
└── upload.js                 # (Phase 13: mode toggle integration)
```

### Pattern 1: FFmpeg.wasm 0.12.x API Usage
**What:** Load FFmpeg, write files, execute commands, read outputs
**When to use:** Every FFmpeg operation
**Example:**
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/getting-started/usage/
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();

// Load core from CDN using blob URLs to bypass CORS
const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
await ffmpeg.load({
  coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
});

// CRITICAL: writeFile() neuters the original ArrayBuffer (transferable)
// Always pass new Uint8Array(buffer) if buffer needs reuse
const videoData = await fetch(url).then(r => r.arrayBuffer());
await ffmpeg.writeFile('input.mp4', new Uint8Array(videoData));

// Execute FFmpeg command
await ffmpeg.exec(['-i', 'input.mp4', '-vf', 'rotate=0.005', 'output.mp4']);

// Read result
const data = await ffmpeg.readFile('output.mp4');
const blob = new Blob([data.buffer], { type: 'video/mp4' });
```

### Pattern 2: Multi-Threaded Core Loading with Fallback
**What:** Attempt to load multi-threaded core, fall back to single-threaded if unavailable
**When to use:** Initial FFmpeg setup in worker
**Example:**
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/overview/
// Multi-threaded core requires SharedArrayBuffer (cross-origin isolated)
async function loadFFmpeg(ffmpeg) {
  const baseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

  try {
    // Try multi-threaded first
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    return 'multi-threaded';
  } catch (error) {
    // Fall back to single-threaded
    const stURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${stURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${stURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    return 'single-threaded';
  }
}
```

### Pattern 3: Progress Tracking via Log Parsing
**What:** Parse FFmpeg log output to extract progress information
**When to use:** Providing user feedback during processing
**Example:**
```javascript
// Source: https://www.japj.net/2025/04/21/ffmpeg-wasm-encoding-progress/
// FFmpeg outputs: frame= 54 fps=0.0 q=-0.0 size= 256kB time=00:00:02.16 bitrate= 968.9kbits/s speed=4.32x

ffmpeg.on('log', ({ message }) => {
  // Look for lines with time= and speed=
  if (message.includes('time=') && message.includes('speed=')) {
    const timeMatch = message.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
    if (timeMatch) {
      const [_, hours, minutes, seconds] = timeMatch;
      const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
      const progress = Math.min(currentTime / totalDuration, 1.0);
      // Report progress
      postMessage({ type: 'progress', progress });
    }
  }
});

// Alternative: Use experimental progress event (less reliable)
ffmpeg.on('progress', ({ progress, time }) => {
  // progress is between 0 and 1 (when it works)
  postMessage({ type: 'progress', progress });
});
```

### Pattern 4: Dedicated Worker Pool for Parallel Processing
**What:** Manage multiple Web Workers processing variations concurrently
**When to use:** Processing multiple variations in parallel
**Example:**
```javascript
// Source: https://medium.com/@artemkhrenov/web-workers-parallel-processing-in-the-browser-e4c89e6cad77
class WorkerPool {
  constructor(workerCount = 3) {
    this.workers = [];
    this.queue = [];
    this.activeJobs = new Map();

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker('./ffmpeg-worker.js', { type: 'module' });
      worker.onmessage = (e) => this.handleMessage(i, e);
      worker.onerror = (e) => this.handleError(i, e);
      this.workers.push({ worker, busy: false });
    }
  }

  async processVariation(videoData, effect) {
    return new Promise((resolve, reject) => {
      const job = { videoData, effect, resolve, reject, retries: 0 };
      this.queue.push(job);
      this.processNext();
    });
  }

  processNext() {
    const available = this.workers.find(w => !w.busy);
    if (!available || this.queue.length === 0) return;

    const job = this.queue.shift();
    const idx = this.workers.indexOf(available);
    available.busy = true;
    this.activeJobs.set(idx, job);

    // Transfer ownership of ArrayBuffer to worker (zero-copy)
    available.worker.postMessage({
      type: 'process',
      videoData: job.videoData,
      effect: job.effect
    }, [job.videoData.buffer]);
  }

  handleMessage(workerIdx, event) {
    const job = this.activeJobs.get(workerIdx);
    if (event.data.type === 'complete') {
      job.resolve(event.data.result);
      this.activeJobs.delete(workerIdx);
      this.workers[workerIdx].busy = false;
      this.processNext();
    } else if (event.data.type === 'progress') {
      // Aggregate progress
    }
  }

  handleError(workerIdx, error) {
    const job = this.activeJobs.get(workerIdx);
    if (job.retries < 1) {
      job.retries++;
      this.queue.unshift(job); // Retry once
    } else {
      job.reject(error); // Skip after one retry
    }
    this.activeJobs.delete(workerIdx);
    this.workers[workerIdx].busy = false;
    this.processNext();
  }

  terminate() {
    this.workers.forEach(w => w.worker.terminate());
  }
}
```

### Pattern 5: Client-Zip Streaming ZIP Generation
**What:** Stream processed videos into a ZIP file for download
**When to use:** Bundling completed variations for user download
**Example:**
```javascript
// Source: https://github.com/Touffy/client-zip
import { downloadZip } from 'client-zip';

// Organize files by source video (matches server output structure)
const files = [
  { name: 'video1/variation_001.mp4', input: blob1 },
  { name: 'video1/variation_002.mp4', input: blob2 },
  { name: 'video1/variation_003.mp4', input: blob3 },
];

// Generate and download ZIP
const blob = await downloadZip(files).blob();
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'processed-videos.zip';
a.click();

// Clean up blob URL to free memory
URL.revokeObjectURL(url);
```

### Pattern 6: beforeunload Warning During Processing
**What:** Warn user before leaving page during active processing
**When to use:** Prevent accidental data loss
**Example:**
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
let processingActive = false;

function startProcessing() {
  processingActive = true;
  window.addEventListener('beforeunload', handleBeforeUnload);
}

function finishProcessing() {
  processingActive = false;
  window.removeEventListener('beforeunload', handleBeforeUnload);
}

function handleBeforeUnload(event) {
  if (processingActive) {
    event.preventDefault();
    // Modern browsers show generic message, custom messages deprecated
    return ''; // Some browsers require returnValue
  }
}
```

### Anti-Patterns to Avoid
- **Reusing neutered ArrayBuffers:** After `ffmpeg.writeFile(name, data)`, the ArrayBuffer in `data` is neutered. Always pass `new Uint8Array(buffer)` if buffer needs reuse.
- **Loading FFmpeg repeatedly:** Don't call `ffmpeg.load()` for each variation. Load once per worker and reuse the instance with `ffmpeg.exec()`.
- **Skipping memory cleanup:** Always call `URL.revokeObjectURL()` after blob URLs are no longer needed to prevent memory leaks.
- **Blocking main thread:** Never run FFmpeg operations on the main thread. Always use Web Workers.
- **Importing from CDN directly:** FFmpeg.wasm spawns workers and cannot be imported from CDN like jsDelivr/unpkg. Install via npm and bundle, or host locally.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP file generation | Custom ZIP writer with binary manipulation | client-zip | ZIP format has complex CRC32 checksums, compression options, central directory structures. client-zip handles all edge cases in 6.4 kB. |
| Worker pool management | Simple array of workers with flags | workerpool (optional) or dedicated pattern | Crashed workers, timeout handling, queue management, fair scheduling are non-trivial. Pattern above handles basics, workerpool handles edge cases. |
| Progress aggregation | Manual percentage calculations | Log parsing with total duration | FFmpeg's progress event is experimental and unreliable. Log parsing with known duration is battle-tested. |
| FFmpeg command building | String concatenation | Filter string builder from effects-shared.js | FFmpeg filter syntax has quoting, escaping, and ordering requirements. Shared module already handles this. |
| Blob URL lifecycle | Manual tracking | Systematic create/revoke pattern | Memory leaks from unreleased blob URLs are subtle. Disciplined revoke immediately after use prevents issues. |

**Key insight:** Browser video processing has many gotchas (ArrayBuffer neutering, memory limits, worker lifecycle, cross-origin isolation). Use established libraries and patterns rather than discovering edge cases through production issues.

## Common Pitfalls

### Pitfall 1: ArrayBuffer Neutering After writeFile()
**What goes wrong:** After calling `ffmpeg.writeFile(name, data)`, attempting to reuse `data` throws "Cannot perform operation on a neutered ArrayBuffer"
**Why it happens:** FFmpeg.wasm uses `postMessage` with transferable ArrayBuffers for zero-copy performance. This transfers ownership to the worker and neuters the original buffer.
**How to avoid:** Always pass `new Uint8Array(originalBuffer)` to create a fresh view when the buffer needs reuse. See user's memory note: "Always pass `new Uint8Array(buffer)` when the buffer needs to be reused"
**Warning signs:** "Cannot perform operation on a neutered ArrayBuffer" errors, especially when processing multiple variations from the same source video

### Pitfall 2: Multi-Threading Only Works in Firefox (Chromium Issue)
**What goes wrong:** Multi-threaded FFmpeg.wasm works in Firefox but fails in Chrome/Edge despite proper COOP/COEP headers
**Why it happens:** As of 2024-2025, Chromium browsers have ongoing issues with SharedArrayBuffer in Web Workers even when cross-origin isolated. Firefox handles this correctly.
**How to avoid:** Always implement fallback to single-threaded core. Test in multiple browsers. Consider Firefox recommendation for users processing large batches.
**Warning signs:** FFmpeg.wasm loads successfully but processing hangs or crashes only in Chrome/Edge, not Firefox

### Pitfall 3: Memory Exhaustion with Large Files or Many Variations
**What goes wrong:** Processing multiple large videos (>100MB each) or many variations causes "Array buffer allocation failed" or browser crashes
**Why it happens:** WebAssembly has 2GB memory limit (potentially 4GB future). Each FFmpeg worker allocates memory for video buffers. Multiple concurrent workers multiply memory usage.
**How to avoid:** Limit worker pool to 2-3 workers max. Process one source video at a time (all variations, then next video). Show 100MB file size warning. Consider chunking for very large files (>500MB).
**Warning signs:** "Array buffer allocation failed", browser tab crashes, severe slowdown during processing

### Pitfall 4: Unreleased Blob URLs Causing Memory Leaks
**What goes wrong:** Creating many blob URLs without revoking them causes gradually increasing memory usage and eventual slowdown
**Why it happens:** Each `URL.createObjectURL()` creates a mapping in browser memory that persists until explicitly revoked or page unloads. Single-page apps never unload.
**How to avoid:** Call `URL.revokeObjectURL(url)` immediately after the URL is no longer needed (e.g., after download link click or after ZIP generation completes).
**Warning signs:** Memory usage grows over time, especially visible when processing multiple batches without page reload

### Pitfall 5: Progress Event Unreliability
**What goes wrong:** FFmpeg's `progress` event returns negative values, NaN, or doesn't fire consistently across operations
**Why it happens:** The progress event is marked experimental. Different FFmpeg commands output different log formats, breaking progress calculation.
**How to avoid:** Use log parsing for critical progress feedback. Parse "time=" from log output and compare to known total duration. Use progress event as optional enhancement, not primary mechanism.
**Warning signs:** Progress jumps backward, shows >100%, or freezes at 0% despite active processing

### Pitfall 6: CORS Issues with Core Files from CDN
**What goes wrong:** FFmpeg.wasm fails to load with CORS errors even when core files are on CDN
**Why it happens:** Browser security prevents loading Web Workers from cross-origin scripts. jsDelivr has proper CORS headers, but unpkg doesn't always.
**How to avoid:** Use `toBlobURL()` utility to convert CDN URLs to blob URLs, bypassing CORS. Use jsDelivr (has Cross-Origin-Resource-Policy header), not unpkg, for multi-threaded core.
**Warning signs:** "Failed to construct 'Worker'" errors, CORS policy errors in console when loading FFmpeg.wasm

### Pitfall 7: Worker Termination Without Cleanup
**What goes wrong:** Terminating workers or leaving page doesn't free FFmpeg memory, causing cumulative memory usage
**Why it happens:** FFmpeg.wasm allocates WebAssembly memory that isn't automatically garbage collected when worker terminates
**How to avoid:** Call `ffmpeg.terminate()` before terminating workers. Listen for page unload and properly terminate all workers. Don't reuse FFmpeg instances across many operations without calling terminate.
**Warning signs:** Memory doesn't decrease after processing completes, DevTools shows increasing WebAssembly memory

## Code Examples

Verified patterns from official sources:

### Loading FFmpeg.wasm with toBlobURL
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/getting-started/usage/
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();

// Use toBlobURL to bypass CORS restrictions
const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
await ffmpeg.load({
  coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
});
```

### Processing Video with Effect
```javascript
// Source: Combining official docs + project's effects-shared.js
import { buildFilterString } from '../lib/effects-shared.js';

// Generate effect (using shared effects module)
const effect = {
  rotation: 0.005,
  brightness: 0.02,
  contrast: 1.01,
  saturation: 0.98
};

// Build FFmpeg filter string
const filterString = buildFilterString(effect);
// Result: "rotate=0.005:fillcolor=black@0,eq=brightness=0.02:contrast=1.01:saturation=0.98"

// Process video
await ffmpeg.writeFile('input.mp4', new Uint8Array(videoBuffer));
await ffmpeg.exec(['-i', 'input.mp4', '-vf', filterString, 'output.mp4']);
const result = await ffmpeg.readFile('output.mp4');
```

### Worker Message Handling with Transferables
```javascript
// Source: https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage
// Main thread: Send video data to worker
worker.postMessage({
  type: 'process',
  videoData: videoUint8Array,
  effect: effectObject
}, [videoUint8Array.buffer]); // Transfer ArrayBuffer ownership

// Worker: Receive and process
self.onmessage = async (event) => {
  const { videoData, effect } = event.data;

  // Process with FFmpeg
  await ffmpeg.writeFile('input.mp4', videoData);
  const filterString = buildFilterString(effect);
  await ffmpeg.exec(['-i', 'input.mp4', '-vf', filterString, 'output.mp4']);
  const result = await ffmpeg.readFile('output.mp4');

  // Send result back (transfer ownership again)
  self.postMessage({
    type: 'complete',
    result: result
  }, [result.buffer]);
};
```

### Generating ZIP with Multiple Files
```javascript
// Source: https://github.com/Touffy/client-zip
import { downloadZip } from 'client-zip';

// Organize by source video (matches server output structure)
const files = [];
processedVideos.forEach((video, idx) => {
  video.variations.forEach((blob, varIdx) => {
    files.push({
      name: `${video.originalName}/variation_${String(varIdx + 1).padStart(3, '0')}.mp4`,
      input: blob
    });
  });
});

// Generate ZIP as blob
const zipBlob = await downloadZip(files).blob();

// Trigger download
const link = document.createElement('a');
link.href = URL.createObjectURL(zipBlob);
link.download = `processed-${Date.now()}.zip`;
link.click();

// Clean up
URL.revokeObjectURL(link.href);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FFmpeg.wasm 0.11.x createFFmpeg() | FFmpeg.wasm 0.12.x new FFmpeg() | Late 2023 | Breaking API change, cleaner class-based API, better TypeScript support |
| ffmpeg.run([args]) | ffmpeg.exec([args]) | v0.12.0 | More consistent with native FFmpeg command-line interface |
| ffmpeg.FS.writeFile() | await ffmpeg.writeFile() | v0.12.0 | Async API, better error handling, clearer ownership semantics |
| ffmpeg.setLogger(fn) | ffmpeg.on('log', fn) | v0.12.0 | Event-based API, more flexible, supports multiple listeners |
| JSZip for browser ZIP | client-zip | 2022-2023 | 40x performance improvement, streaming design, 10x smaller |
| Custom message passing | Transferable objects pattern | Established ~2018 | Zero-copy transfer, critical for large video files |
| Custom worker management | Worker pool pattern | Established ~2019 | Standard pattern for parallel processing, handles edge cases |

**Deprecated/outdated:**
- **FFmpeg.wasm 0.11.x and earlier:** No longer maintained, incompatible API, use 0.12.x
- **JSZip for large files:** Still works but client-zip is superior for streaming use cases
- **@ffmpeg/core packages:** Migrated to @ffmpeg.wasm/core-mt and @ffmpeg.wasm/core-st namespaces
- **Custom CORS workarounds:** toBlobURL() utility is now standard, cleaner than fetch + blob tricks

## Open Questions

Things that couldn't be fully resolved:

1. **Multi-threading reliability in Chromium browsers**
   - What we know: Firefox supports multi-threaded FFmpeg.wasm reliably, Chrome/Edge have reported issues as of 2024-2025
   - What's unclear: Whether this is fixed in latest Chrome/Edge, or if it's an ongoing issue
   - Recommendation: Implement fallback to single-threaded core, test in multiple browsers during implementation. Consider user agent detection to default Firefox users to multi-threaded.

2. **Optimal worker pool size**
   - What we know: 2-3 workers is generally recommended for FFmpeg.wasm to avoid memory exhaustion
   - What's unclear: Whether this varies by device RAM, video resolution, or browser
   - Recommendation: Start with 2 workers, add configuration for 3 if testing shows safety on typical hardware. Monitor for "Array buffer allocation failed" errors.

3. **Progress percentage accuracy**
   - What we know: Progress event is experimental and unreliable. Log parsing works but requires knowing total duration upfront.
   - What's unclear: Whether there's a reliable way to estimate duration from video file without processing it first
   - Recommendation: Use log parsing as primary mechanism. Show indeterminate progress if duration unavailable. Mark progress tracking as "approximate" in UI.

4. **client-zip browser compatibility edge cases**
   - What we know: Requires ES2020 (BigInt support), works in all modern browsers
   - What's unclear: Exact cutoff versions for Safari, older mobile browsers
   - Recommendation: Rely on existing capability detection (crossOriginIsolated check). If that passes, client-zip should work. Add error boundary with clear message if ZIP generation fails.

## Sources

### Primary (HIGH confidence)
- FFmpeg.wasm official documentation: https://ffmpegwasm.netlify.app/docs/overview/
- FFmpeg.wasm usage guide: https://ffmpegwasm.netlify.app/docs/getting-started/usage/
- FFmpeg.wasm migration guide: https://ffmpegwasm.netlify.app/docs/migration/
- FFmpeg.wasm API reference: https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/ffmpeg/
- client-zip GitHub repository: https://github.com/Touffy/client-zip
- MDN Web Workers API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- MDN Transferable Objects: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
- MDN SharedArrayBuffer: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- MDN beforeunload event: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
- MDN Cross-Origin-Opener-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy
- MDN Cross-Origin-Embedder-Policy: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy
- MDN URL.createObjectURL: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
- web.dev cross-origin isolation guide: https://web.dev/articles/coop-coep
- Chrome Developers transferable objects: https://developer.chrome.com/blog/transferable-objects-lightning-fast

### Secondary (MEDIUM confidence)
- FFmpeg.wasm progress parsing: https://www.japj.net/2025/04/21/ffmpeg-wasm-encoding-progress/
- FFmpeg.wasm GitHub issues (multi-threading): https://github.com/ffmpegwasm/ffmpeg.wasm/issues/597
- FFmpeg.wasm GitHub issues (large files): https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/516
- FFmpeg.wasm GitHub issues (memory leaks): https://github.com/ffmpegwasm/ffmpeg.wasm/issues/494
- workerpool GitHub: https://github.com/josdejong/workerpool
- Web Workers parallel processing (Medium): https://medium.com/@artemkhrenov/web-workers-parallel-processing-in-the-browser-e4c89e6cad77
- Understanding SharedArrayBuffer (LogRocket): https://blog.logrocket.com/understanding-sharedarraybuffer-and-cross-origin-isolation/
- JSZip limitations: https://stuk.github.io/jszip/documentation/limitations.html
- npm package @ffmpeg/ffmpeg: https://www.npmjs.com/package/@ffmpeg/ffmpeg
- npm package @ffmpeg/util: https://www.npmjs.com/package/@ffmpeg/util
- npm package client-zip: https://www.npmjs.com/package/client-zip

### Tertiary (LOW confidence)
- Various Medium articles on FFmpeg.wasm integration (useful for patterns but not authoritative)
- Stack Overflow discussions (useful for troubleshooting but needs verification)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official packages with clear documentation and established versions
- Architecture: HIGH - Patterns verified from official docs and established Web Worker patterns
- Pitfalls: HIGH - ArrayBuffer neutering documented in user's memory, other issues verified in GitHub issues and official warnings

**Research date:** 2026-02-09
**Valid until:** 2026-04-09 (60 days - stable ecosystem with mature libraries)

**Notes:**
- Phase 10 already configured COOP/COEP headers for cross-origin isolation
- Existing capability detection module (lib/capability-detection.js) ready for use
- Existing shared effects module (lib/effects-shared.js) provides FFmpeg filter generation
- User's historical note about ArrayBuffer neutering is critical and confirmed by FFmpeg.wasm's transferable object usage
- Project uses vanilla JS ES modules, no framework, so worker implementation is straightforward
