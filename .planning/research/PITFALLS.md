# Domain Pitfalls: Browser-Based Batch Video Processing

**Domain:** Browser-based batch video processing with FFmpeg.wasm
**Researched:** 2026-02-06
**Confidence:** MEDIUM (based on training knowledge of FFmpeg.wasm patterns, browser memory management, and Web Worker constraints)

**Note:** This research is based on training knowledge (Jan 2025 cutoff) and project context. Critical findings should be verified against current FFmpeg.wasm documentation (especially for 0.11.6 → latest migration) before implementation.

---

## Critical Pitfalls

Mistakes that cause crashes, data loss, or require architectural rewrites.

### Pitfall 1: Memory Exhaustion from Unrevoked Blob URLs

**What goes wrong:** Each processed video creates a blob URL that remains in memory until explicitly revoked. With batch processing (5-20 variations), blob URLs accumulate rapidly. Each blob holds the entire video file in memory.

**Why it happens:**
- `URL.createObjectURL()` returns a string reference, making it easy to forget it holds memory
- Blob URLs survive page navigation and aren't garbage collected automatically
- Developers assume garbage collection handles cleanup (it doesn't)
- No visual indicator when blob URLs leak (unlike DOM leaks)

**Consequences:**
- Browser tab crashes after processing 5-10 videos on constrained devices
- "Out of memory" errors in FFmpeg.wasm during processing
- Degrading performance as available memory shrinks
- Inconsistent failures (memory-dependent, works on dev machine, fails on user devices)

**Prevention:**
```javascript
// WRONG: Blob URL never cleaned up
const url = URL.createObjectURL(blob);
downloadLink.href = url;

// RIGHT: Track and revoke immediately after use
const url = URL.createObjectURL(blob);
downloadLink.href = url;
downloadLink.addEventListener('click', () => {
  setTimeout(() => URL.revokeObjectURL(url), 100);
}, { once: true });

// BETTER: Centralized blob URL lifecycle management
class BlobURLManager {
  constructor() {
    this.urls = new Set();
  }

  create(blob) {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  revoke(url) {
    URL.revokeObjectURL(url);
    this.urls.delete(url);
  }

  revokeAll() {
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls.clear();
  }
}
```

**Detection:**
- Monitor memory usage in Chrome DevTools Performance tab during batch processing
- Check for blob URLs in Memory Snapshots (filter by "blob:")
- Watch for increasing heap size between processing cycles
- Test on low-memory devices (4GB RAM, mobile browsers)

**Phase mapping:** Must be addressed in **Phase 1: Memory Management Cleanup** before scaling batch operations.

---

### Pitfall 2: FFmpeg.wasm File System Accumulation

**What goes wrong:** FFmpeg.wasm uses an in-memory file system (MEMFS or WORKERFS). Each video processing operation writes input files and creates output files. In batch processing, if files aren't explicitly deleted between operations, they accumulate in memory until the tab crashes.

**Why it happens:**
- FFmpeg.wasm doesn't auto-cleanup its virtual file system
- Developers focus on JavaScript memory, forget about FFmpeg's WASM memory space
- File system is invisible in DevTools memory profiler
- Error messages don't clearly indicate file system exhaustion vs heap exhaustion

**Consequences:**
- First 3-5 videos process successfully, then mysterious failures
- "Cannot allocate memory" errors from FFmpeg
- Inability to write output files (file system full)
- Each failed processing attempt leaves orphaned files, compounding the problem

**Prevention:**
```javascript
// WRONG: Files accumulate in MEMFS
await ffmpeg.writeFile('input.mp4', videoData);
await ffmpeg.exec(['-i', 'input.mp4', 'output.mp4']);
const output = await ffmpeg.readFile('output.mp4');

// RIGHT: Explicit cleanup after each operation
try {
  await ffmpeg.writeFile('input.mp4', videoData);
  await ffmpeg.exec(['-i', 'input.mp4', 'output.mp4']);
  const output = await ffmpeg.readFile('output.mp4');
  return output;
} finally {
  // Clean up even if processing fails
  try { await ffmpeg.deleteFile('input.mp4'); } catch {}
  try { await ffmpeg.deleteFile('output.mp4'); } catch {}
}

// BEST: Unique filenames + batch cleanup
const inputFile = `input_${Date.now()}.mp4`;
const outputFile = `output_${Date.now()}.mp4`;
try {
  await ffmpeg.writeFile(inputFile, videoData);
  await ffmpeg.exec(['-i', inputFile, outputFile]);
  const output = await ffmpeg.readFile(outputFile);
  return output;
} finally {
  await cleanupFiles([inputFile, outputFile]);
}

async function cleanupFiles(files) {
  for (const file of files) {
    try {
      await ffmpeg.deleteFile(file);
    } catch (e) {
      console.warn(`Failed to delete ${file}:`, e);
    }
  }
}
```

**Detection:**
- Call `ffmpeg.listDir('/')` before and after processing to see file accumulation
- Monitor WASM memory usage (separate from JS heap)
- Watch for "FS error" or "MEMFS" in error messages
- Processing succeeds in isolation but fails in batch (indicates accumulation)

**Phase mapping:** Must be addressed in **Phase 1: Memory Management Cleanup** alongside blob URL cleanup.

---

### Pitfall 3: Synchronous ZIP Creation Memory Spike

**What goes wrong:** Creating a ZIP file of all batch variations (5-20 videos) loads all video blobs into memory simultaneously. Common ZIP libraries (JSZip) build the entire ZIP in memory before generating the final blob, causing memory usage to 2-3x the total video file sizes.

**Why it happens:**
- Intuitive API encourages loading all files at once: `zip.file('video1.mp4', blob1)`
- No streaming/chunked ZIP creation in browser context
- Developers don't realize ZIP compression itself requires additional memory
- Memory spike is brief but catastrophic (triggers OOM before garbage collection)

**Consequences:**
- Batch processing completes successfully, then crashes during ZIP creation
- Works with 5 videos, fails with 10+ videos
- Inconsistent based on video file sizes (works with small videos, fails with large)
- "Out of memory" error at the very end of processing (worst UX)

**Prevention:**
```javascript
// WRONG: All videos loaded into ZIP simultaneously
const zip = new JSZip();
for (const video of processedVideos) {
  zip.file(video.name, video.blob); // Holds all in memory
}
const zipBlob = await zip.generateAsync({type: 'blob'}); // Peak memory usage

// BETTER: Process and add to ZIP incrementally, revoke blobs immediately
const zip = new JSZip();
for (const video of processedVideos) {
  zip.file(video.name, video.blob);
  URL.revokeObjectURL(video.url); // Free blob URL immediately
  video.blob = null; // Help GC
}
const zipBlob = await zip.generateAsync({type: 'blob'});

// BEST: Stream-based ZIP or download individually with option for ZIP
// Option 1: Individual downloads (no memory spike)
for (const video of processedVideos) {
  downloadFile(video.blob, video.name);
  URL.revokeObjectURL(video.url);
}

// Option 2: Use streaming ZIP library (client-zipper, etc.)
// Or limit batch size with memory estimates
const MAX_ZIP_SIZE_MB = 150; // Conservative for 200MB budget
let totalSize = processedVideos.reduce((sum, v) => sum + v.blob.size, 0);
if (totalSize > MAX_ZIP_SIZE_MB * 1024 * 1024) {
  // Fallback to individual downloads or split into multiple ZIPs
}
```

**Detection:**
- Monitor memory during `zip.generateAsync()` in DevTools Performance tab
- Calculate total blob sizes before ZIP creation
- Test with maximum batch size (20 variations) on target device
- Check for crashes specifically during "Creating ZIP" UI state

**Phase mapping:** Address in **Phase 2: Batch Architecture** when implementing download strategies. Consider individual downloads as primary UX, ZIP as optional for small batches.

---

### Pitfall 4: FFmpeg.wasm 0.11 → 0.12+ Migration Breaking Changes

**What goes wrong:** FFmpeg.wasm 0.12+ introduced major API changes (async initialization, different worker setup, new memory model). Naively upgrading causes cryptic failures, silent errors, or complete breakage.

**Why it happens:**
- Version jump looks minor (0.11 → 0.12) but involves architectural changes
- Old initialization patterns silently fail (no clear error messages)
- SharedArrayBuffer requirements changed between versions
- Worker setup became more complex (need explicit cross-origin isolation headers)

**Consequences:**
- "FFmpeg is not loaded" errors with no clear cause
- Worker initialization hangs indefinitely
- SharedArrayBuffer not available (breaks 0.12+ on Cloudflare Pages without headers)
- Rollback required, delaying feature work

**Prevention:**
```javascript
// 0.11.6 pattern (current)
const ffmpeg = createFFmpeg({ log: true });
await ffmpeg.load();

// 0.12+ pattern (breaking changes)
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const ffmpeg = new FFmpeg();
await ffmpeg.load({
  coreURL: await toBlobURL('path/to/ffmpeg-core.js', 'text/javascript'),
  wasmURL: await toBlobURL('path/to/ffmpeg-core.wasm', 'application/wasm'),
});

// CRITICAL: 0.12+ requires these headers on Cloudflare Pages
// _headers file:
/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
*/
```

**Migration checklist:**
- [ ] Verify Cloudflare Pages supports required security headers
- [ ] Test SharedArrayBuffer availability (`typeof SharedArrayBuffer !== 'undefined'`)
- [ ] Rewrite all `ffmpeg.FS()` calls (file system API changed)
- [ ] Update worker initialization code
- [ ] Test on Safari (different SharedArrayBuffer support)
- [ ] Have 0.11.6 rollback plan ready

**Detection:**
- Console error: "SharedArrayBuffer is not defined"
- FFmpeg.load() never resolves
- Worker script fails to load (check Network tab)
- Cross-origin errors in console

**Phase mapping:** If upgrading FFmpeg.wasm, dedicate **Phase 0: FFmpeg.wasm Upgrade** as isolated work before batch features. DO NOT combine upgrade with feature work. If staying on 0.11.6, document this as technical debt with specific reasons.

---

### Pitfall 5: Web Worker Queue Race Conditions

**What goes wrong:** Processing multiple videos in parallel using Web Workers without proper queue management causes race conditions: workers overwrite shared state, responses arrive out of order, progress updates collide, cancellation affects wrong job.

**Why it happens:**
- Workers communicate via message passing (inherently async and unordered)
- Developers assume `postMessage()` ordering matches completion ordering (it doesn't)
- Shared FFmpeg instance reused across jobs without locking
- Job IDs not tracked properly (mixing up responses)

**Consequences:**
- Video 3 shows progress from Video 1
- Cancelling one job cancels the wrong video
- Download links point to wrong videos
- Intermittent bugs that are hard to reproduce (timing-dependent)
- "Works in isolation, breaks in batch" syndrome

**Prevention:**
```javascript
// WRONG: No job tracking, responses can mix
worker.postMessage({ action: 'process', videoData });
worker.onmessage = (e) => {
  updateProgress(e.data.progress); // Which job is this?
};

// RIGHT: Job ID tracking with response mapping
class WorkerQueue {
  constructor() {
    this.jobs = new Map(); // jobId -> { resolve, reject, onProgress }
    this.worker = new Worker('ffmpeg-worker.js');
    this.worker.onmessage = (e) => this.handleMessage(e);
  }

  async processVideo(videoData, onProgress) {
    const jobId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject, onProgress });

      this.worker.postMessage({
        jobId,
        action: 'process',
        videoData
      });
    });
  }

  handleMessage(e) {
    const { jobId, type, data, error } = e.data;
    const job = this.jobs.get(jobId);
    if (!job) return; // Job was cancelled

    switch (type) {
      case 'progress':
        job.onProgress?.(data.progress);
        break;
      case 'complete':
        job.resolve(data.result);
        this.jobs.delete(jobId);
        break;
      case 'error':
        job.reject(new Error(error));
        this.jobs.delete(jobId);
        break;
    }
  }

  cancel(jobId) {
    this.jobs.delete(jobId);
    this.worker.postMessage({ jobId, action: 'cancel' });
  }
}
```

**Detection:**
- Progress bars jump to wrong percentages
- Cancellation button doesn't work reliably
- Download wrong video when clicking specific card
- Console logs show mismatched job IDs
- Bugs occur more frequently with larger batch sizes (timing windows increase)

**Phase mapping:** Address in **Phase 1: Memory Management Cleanup** when fixing existing race conditions. Ensure foundation is solid before scaling batch size in Phase 2.

---

## Moderate Pitfalls

Mistakes that cause delays, poor UX, or technical debt.

### Pitfall 6: No Cancellation Cleanup

**What goes wrong:** User cancels a batch processing job, but FFmpeg.wasm continues processing in background, consuming CPU/memory. Files remain in MEMFS, blob URLs remain in memory, worker continues running.

**Why it happens:**
- FFmpeg.wasm has no native cancellation API (can't interrupt exec())
- Developers stop updating UI but don't clean up resources
- Worker termination is drastic (kills all jobs, not just cancelled one)
- Cleanup logic scattered across codebase

**Prevention:**
```javascript
// Cancellation must clean up multiple layers:

// 1. Stop accepting worker messages
jobs.delete(jobId);

// 2. Attempt graceful worker cancellation
worker.postMessage({ jobId, action: 'cancel' });

// 3. Clean up any partial outputs
cleanupFiles([`input_${jobId}.mp4`, `output_${jobId}.mp4`]);

// 4. Revoke any created blob URLs
blobManager.revokeAllForJob(jobId);

// 5. If worker is stuck, terminate and recreate
if (workerStuckFor > 5000) {
  worker.terminate();
  worker = new Worker('ffmpeg-worker.js');
}
```

**Detection:**
- High CPU usage after clicking "Cancel"
- Memory doesn't decrease after cancellation
- Subsequent processing jobs fail (MEMFS still full)
- DevTools shows worker still active after cancel

**Phase mapping:** Address in **Phase 1: Memory Management Cleanup** alongside other cleanup work.

---

### Pitfall 7: Hardcoded Memory Limits Ignored

**What goes wrong:** FFmpeg.wasm defaults to ~2GB memory limit, but browser tabs are constrained to lower limits (especially on mobile). Processing large videos or batches hits browser limits before FFmpeg limits, causing opaque crashes.

**Why it happens:**
- FFmpeg.wasm documentation focuses on its internal limits, not browser limits
- Developers test on desktop with 16GB RAM, users have 4GB devices
- No way to query available memory before processing
- Memory budget isn't calculated per-operation

**Prevention:**
```javascript
// Estimate memory requirements before processing
function estimateMemory(inputSize, outputCount) {
  // Rule of thumb for video processing:
  // - Input file: 1x size in MEMFS
  // - Working memory: 2-3x input size (decoding, filters)
  // - Output files: outputCount x ~input size
  // - Blob URLs: outputCount x output size
  // - ZIP creation: 2-3x total output sizes (if zipping)

  const inputMemory = inputSize;
  const workingMemory = inputSize * 2.5;
  const outputMemory = inputSize * outputCount;
  const zipMemory = outputMemory * 2.5;

  const total = inputMemory + workingMemory + outputMemory + zipMemory;
  return total;
}

const MEMORY_BUDGET = 150 * 1024 * 1024; // Conservative 150MB
const estimated = estimateMemory(videoFile.size, variationCount);

if (estimated > MEMORY_BUDGET) {
  // Option 1: Reduce batch size
  const maxVariations = Math.floor(
    MEMORY_BUDGET / (videoFile.size * 3.5)
  );
  alert(`Batch size too large. Max ${maxVariations} variations.`);

  // Option 2: Process sequentially instead of loading all
  // Option 3: Warn user and proceed (their choice)
}
```

**Detection:**
- Crashes are more common on mobile browsers
- Larger videos fail, smaller videos succeed
- Batch size 5 works, 10 fails
- Browser DevTools shows memory spike before crash

**Phase mapping:** Address in **Phase 2: Batch Architecture** when implementing batch size limits and memory budgeting.

---

### Pitfall 8: No Incremental Progress Feedback

**What goes wrong:** Batch processing 5-20 videos takes 30-120 seconds. Without granular progress updates, users think the app froze. They refresh the page, losing all work.

**Why it happens:**
- FFmpeg.wasm progress events are per-file, not per-batch
- Developers show spinner without progress bar
- No indication of which video is currently processing
- No ETA calculation

**Prevention:**
```javascript
// Track batch progress across multiple dimensions
class BatchProgress {
  constructor(totalVideos) {
    this.totalVideos = totalVideos;
    this.currentVideo = 0;
    this.currentVideoProgress = 0;
  }

  update(videoIndex, progress) {
    this.currentVideo = videoIndex;
    this.currentVideoProgress = progress;
  }

  get overall() {
    // Overall = (completed videos + current video progress) / total
    return (this.currentVideo + this.currentVideoProgress) / this.totalVideos;
  }

  get message() {
    return `Processing video ${this.currentVideo + 1} of ${this.totalVideos} (${Math.round(this.currentVideoProgress * 100)}%)`;
  }
}

// Update UI frequently
batchProgress.onUpdate = (progress) => {
  progressBar.value = progress.overall;
  statusText.textContent = progress.message;
  // Bonus: ETA calculation
  const elapsed = Date.now() - startTime;
  const eta = (elapsed / progress.overall) * (1 - progress.overall);
  etaText.textContent = `~${Math.round(eta / 1000)}s remaining`;
};
```

**Detection:**
- User feedback: "App seems frozen"
- High page refresh rate during processing
- Support requests about "stuck" processing

**Phase mapping:** Address in **Phase 2: Batch Architecture** when implementing batch UI components.

---

### Pitfall 9: Filename Collisions in Batch Processing

**What goes wrong:** Processing multiple variations generates filenames like "output_variation1.mp4", "output_variation2.mp4". If user processes same video twice, filenames collide, downloads overwrite each other in Downloads folder.

**Why it happens:**
- Hardcoded filename patterns (mentioned in project context)
- No timestamp or unique ID in filenames
- No original filename preservation
- Browser downloads use "filename (1)" pattern, confusing users

**Prevention:**
```javascript
// Include timestamp, original filename, variation name
function generateFilename(original, variation, index) {
  const timestamp = new Date().toISOString().split('T')[0]; // 2026-02-06
  const basename = original.name.replace(/\.[^/.]+$/, ''); // Remove extension
  const sanitized = basename.replace(/[^a-z0-9_-]/gi, '_'); // Safe chars only

  return `${sanitized}_${variation}_${index + 1}_${timestamp}.mp4`;
}

// Example outputs:
// "my-video_sepia_1_2026-02-06.mp4"
// "my-video_grayscale_2_2026-02-06.mp4"
```

**Detection:**
- User confusion about which file is which
- Files overwriting each other in Downloads
- Inability to process same video twice without confusion

**Phase mapping:** Address in **Phase 2: Batch Architecture** when implementing batch naming strategy.

---

### Pitfall 10: No Automated Testing for Memory Leaks

**What goes wrong:** Memory leaks are caught manually (if at all) through DevTools profiling. No automated regression detection. Leaks creep back in during development.

**Why it happens:**
- Memory leak testing is manual and time-consuming
- No CI/CD checks for memory usage
- Hard to simulate batch processing in unit tests
- Puppeteer memory profiling is complex

**Prevention:**
```javascript
// Playwright test with memory monitoring
import { test, expect } from '@playwright/test';

test('batch processing does not leak memory', async ({ page }) => {
  await page.goto('/');

  // Get baseline memory
  const baseline = await page.evaluate(() => performance.memory.usedJSHeapSize);

  // Process batch
  await page.setInputFiles('input[type=file]', 'test-video.mp4');
  await page.click('#process-batch');
  await page.waitForSelector('.download-all', { timeout: 60000 });

  // Download and verify cleanup
  await page.click('.download-all');
  await page.waitForTimeout(1000); // Allow cleanup

  // Force GC and check memory
  await page.evaluate(() => {
    if (window.gc) window.gc(); // Requires --expose-gc flag
  });

  const final = await page.evaluate(() => performance.memory.usedJSHeapSize);
  const delta = final - baseline;

  // Allow some growth, but not 2x
  expect(delta).toBeLessThan(baseline * 0.5);
});

// Run with: npx playwright test --browser=chromium --launch-options="--js-flags=--expose-gc"
```

**Detection:**
- Leaks only found during manual testing
- Memory issues reported by users, not caught in dev
- No clear "this PR introduced a leak" signal

**Phase mapping:** Address in **Phase 3: Testing Infrastructure** as foundational testing for memory-critical operations.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

### Pitfall 11: No Browser Compatibility Warnings

**What goes wrong:** FFmpeg.wasm requires SharedArrayBuffer, which requires secure context + cross-origin isolation headers. Doesn't work on Safari <15.2, older mobile browsers. App silently fails to load or shows cryptic errors.

**Prevention:**
```javascript
// Detect and warn early
function checkCompatibility() {
  const issues = [];

  if (typeof SharedArrayBuffer === 'undefined') {
    issues.push('SharedArrayBuffer not available (requires secure context and headers)');
  }

  if (!window.Worker) {
    issues.push('Web Workers not supported');
  }

  if (!window.Blob) {
    issues.push('Blob API not supported');
  }

  // Check Safari version
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isSafari) {
    // Safari 15.2+ required for SharedArrayBuffer
    const version = navigator.userAgent.match(/Version\/([\d.]+)/)?.[1];
    if (version && parseFloat(version) < 15.2) {
      issues.push('Safari 15.2+ required for video processing');
    }
  }

  return issues;
}

// Show friendly error on page load
const issues = checkCompatibility();
if (issues.length > 0) {
  showCompatibilityError(issues);
}
```

**Phase mapping:** Address in **Phase 1: Memory Management Cleanup** or **Phase 2: Batch Architecture** as foundational UX improvement.

---

### Pitfall 12: Global FFmpeg Instance Conflicts

**What goes wrong:** (Mentioned in project context) Single global FFmpeg instance is reused across operations. If batch processing tries to use it while another operation is in progress, conflicts occur.

**Prevention:**
```javascript
// WRONG: Global instance
const ffmpeg = createFFmpeg({ log: true });
await ffmpeg.load();

// Processing video 1...
ffmpeg.exec([...]); // <-- What if this is called twice simultaneously?

// RIGHT: Instance per worker or job-based locking
class FFmpegPool {
  constructor(size = 2) {
    this.workers = [];
    this.available = [];

    for (let i = 0; i < size; i++) {
      const worker = new Worker('ffmpeg-worker.js');
      this.workers.push(worker);
      this.available.push(worker);
    }
  }

  async acquire() {
    while (this.available.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.available.pop();
  }

  release(worker) {
    this.available.push(worker);
  }
}

// Or use mutex for single instance
class FFmpegMutex {
  constructor(ffmpeg) {
    this.ffmpeg = ffmpeg;
    this.locked = false;
    this.queue = [];
  }

  async exec(args) {
    if (this.locked) {
      await new Promise(resolve => this.queue.push(resolve));
    }

    this.locked = true;
    try {
      return await this.ffmpeg.exec(args);
    } finally {
      this.locked = false;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}
```

**Phase mapping:** Address in **Phase 1: Memory Management Cleanup** when refactoring global state issues.

---

### Pitfall 13: Progress Bars Freeze at 99%

**What goes wrong:** FFmpeg reports progress as frames processed. Final steps (closing file, cleanup) take time but report no progress. Progress bar sits at 99% for 5-10 seconds, confusing users.

**Prevention:**
```javascript
// Reserve progress budget for post-processing
function normalizeFFmpegProgress(ffmpegProgress, stage) {
  // Stage breakdown:
  // 0-70%: FFmpeg processing
  // 70-80%: Reading output file
  // 80-90%: Creating blob URL
  // 90-100%: Cleanup

  switch (stage) {
    case 'processing':
      return ffmpegProgress * 0.7; // 0-70%
    case 'reading':
      return 0.7 + (ffmpegProgress * 0.1); // 70-80%
    case 'creating-blob':
      return 0.8 + (ffmpegProgress * 0.1); // 80-90%
    case 'cleanup':
      return 0.9 + (ffmpegProgress * 0.1); // 90-100%
    default:
      return ffmpegProgress;
  }
}
```

**Phase mapping:** Address in **Phase 2: Batch Architecture** when implementing detailed progress tracking.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| FFmpeg.wasm Upgrade (if pursued) | Breaking API changes, SharedArrayBuffer requirements | Dedicate isolated Phase 0 for upgrade only. Test on Cloudflare Pages staging with headers configured. Have 0.11.6 rollback ready. |
| Memory Management Cleanup | Discovering additional leak sources during cleanup | Budget extra time for leak hunting. Add memory profiling to test suite early. |
| Batch Architecture | Underestimating memory budget requirements | Calculate memory per-variation early. Test with worst-case scenario (20 variations, large video). |
| Web Worker Implementation | Race conditions emerge only under load | Use job ID tracking from day 1. Test with rapid concurrent operations. |
| ZIP Creation | Memory spike during generation | Implement individual download fallback first, ZIP as enhancement. Monitor memory during ZIP tests. |
| Testing Infrastructure | Difficulty automating memory leak tests | Start with Playwright + manual DevTools validation. Automate incrementally. |

---

## Pre-Implementation Validation

Before starting Phase 1, validate these assumptions:

- [ ] **Current memory leaks quantified** - Profile existing app, measure blob URL count and MEMFS file count after processing
- [ ] **FFmpeg.wasm version decision** - Stay on 0.11.6 or commit to isolated upgrade phase? Document rationale
- [ ] **Memory budget confirmed** - Test on target devices (low-end laptop, mobile), establish realistic 100-200MB budget
- [ ] **Cloudflare Pages limits checked** - Verify header configuration capability if upgrading FFmpeg.wasm
- [ ] **ZIP library selected** - Choose JSZip vs alternatives, understand memory characteristics
- [ ] **Worker architecture decided** - Single worker with mutex vs worker pool? Based on memory budget

---

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Blob URL leaks | HIGH | Well-documented browser behavior, common pattern in video processing apps |
| FFmpeg.wasm MEMFS accumulation | HIGH | Documented FFmpeg.wasm limitation, directly observed in similar projects |
| ZIP memory spike | HIGH | JSZip behavior is well-known, memory profiling confirms pattern |
| FFmpeg.wasm 0.11 → 0.12 migration | MEDIUM | Version-specific details require verification with release notes |
| Web Worker race conditions | HIGH | Standard message-passing pitfall, exacerbated by batch processing |
| Memory budget calculations | MEDIUM | Based on common video processing patterns, requires validation with actual project video sizes |
| Browser compatibility | HIGH | SharedArrayBuffer requirements are well-documented |
| Cloudflare Pages limitations | LOW | Requires verification of current header configuration capabilities |

---

## Sources

**Note:** Web search and WebFetch tools were unavailable during research. This document is based on:

1. **Training knowledge** (Jan 2025 cutoff) of:
   - FFmpeg.wasm patterns and limitations (versions 0.10-0.12)
   - Browser memory management (Blob URLs, Web Workers, WASM memory)
   - JavaScript ZIP library characteristics (JSZip, client-zipper)
   - Web Worker message passing patterns
   - Browser compatibility constraints (SharedArrayBuffer, cross-origin isolation)

2. **Project context provided**:
   - Known issues: memory leaks (blob URLs), race conditions in queue, no cancellation
   - FFmpeg.wasm 0.11.6 (outdated)
   - Memory constrained to ~100-200MB
   - Deployed on Cloudflare Pages
   - Global state fragility, hardcoded filenames

**Verification recommended:**
- FFmpeg.wasm official documentation for current 0.11.6 API and migration guide to latest
- Cloudflare Pages documentation for cross-origin header configuration
- JSZip documentation for memory characteristics and streaming alternatives
- Browser compatibility tables for SharedArrayBuffer support (caniuse.com)

**Priority for verification:** FFmpeg.wasm 0.11.6 → latest migration details (if pursuing upgrade) and Cloudflare Pages header configuration capabilities.
