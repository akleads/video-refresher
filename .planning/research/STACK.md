# Technology Stack: Batch Video Processing & Optimization

**Project:** Video Creative Variation Tool - Batch Processing Milestone
**Researched:** 2026-02-06
**Context:** Adding batch variation generation and performance optimization to existing FFmpeg.wasm app

## Research Limitations

**IMPORTANT:** This research was conducted without access to external verification tools (WebSearch, WebFetch, Context7). All recommendations are based on training data current to January 2025 and should be verified against official documentation before implementation.

**Verification needed for:**
- Current latest versions (check npm, GitHub releases)
- Breaking changes since January 2025
- New alternatives that may have emerged

**Confidence Level: MEDIUM** - Recommendations are sound based on established patterns, but versions and specific features require verification.

---

## Recommended Stack

### Core: FFmpeg.wasm

| Technology | Recommended Version | Current Version | Purpose | Confidence |
|------------|-------------------|-----------------|---------|------------|
| @ffmpeg/ffmpeg | 0.12.x | 0.11.6 | Video processing engine | MEDIUM |
| @ffmpeg/util | Latest matching | N/A (new) | Utility functions for FFmpeg.wasm | MEDIUM |

**Why upgrade from 0.11.6:**
- v0.12.x introduced multi-threading support via SharedArrayBuffer
- Better memory management for batch processing
- Improved performance (2-3x faster for supported operations)
- Better API for progress tracking

**Installation:**
```bash
# Verify latest versions at npmjs.com before installing
npm install @ffmpeg/ffmpeg@latest @ffmpeg/util@latest
```

**CDN Usage (for no-build setup):**
```javascript
// Verify versions at esm.sh or unpkg before using
import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.x';
import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.x';
```

**Critical Configuration:**
```javascript
const ffmpeg = new FFmpeg();

// Enable multi-threading (REQUIRES COOP/COEP headers)
await ffmpeg.load({
  coreURL: await toBlobURL(/* ffmpeg-core.js */, 'text/javascript'),
  wasmURL: await toBlobURL(/* ffmpeg-core.wasm */, 'application/wasm'),
  workerURL: await toBlobURL(/* ffmpeg-core.worker.js */, 'text/javascript'),
});
```

**Confidence:** MEDIUM - Version 0.12.x existed in my training data, but verify if newer versions are available.

---

### ZIP Creation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| JSZip | 3.10.x+ | Create ZIP archives in browser | Industry standard, actively maintained | HIGH |

**Why JSZip:**
- De facto standard for browser ZIP creation
- Handles large files via streaming
- Works entirely client-side
- Well-documented, stable API
- No dependencies

**Installation:**
```bash
# Verify latest version
npm install jszip
```

**CDN Usage:**
```javascript
// Verify version
import JSZip from 'https://esm.sh/jszip@3.10.1';
```

**Critical Usage Pattern:**
```javascript
const zip = new JSZip();

// Add files (Blob or ArrayBuffer)
for (let i = 0; i < variations.length; i++) {
  zip.file(`variation-${i + 1}.mp4`, variations[i].blob);
}

// Generate with streaming for large files
const blob = await zip.generateAsync({
  type: 'blob',
  compression: 'STORE', // No compression for video files
  streamFiles: true // Critical for memory efficiency
});
```

**Why NOT alternatives:**
- **fflate**: Lower-level, requires more manual work; JSZip is simpler for this use case
- **zip.js**: More complex API, overkill for simple ZIP creation
- **client-zip**: Newer library, less battle-tested than JSZip

**Confidence:** HIGH - JSZip is well-established and appropriate for this use case.

---

### Parallel Processing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Web Workers API | Native | Run FFmpeg instances in parallel | Built-in, no dependencies | HIGH |
| Comlink | 4.4.x | Simplify Worker communication | Makes Workers feel like regular objects | MEDIUM |

**Architecture: Worker Pool Pattern**

```javascript
// Main thread manages queue
class VideoProcessingPool {
  constructor(workerCount = navigator.hardwareConcurrency || 4) {
    this.workers = [];
    this.queue = [];

    for (let i = 0; i < workerCount; i++) {
      this.workers.push(new Worker('video-worker.js', { type: 'module' }));
    }
  }

  async processVariations(inputFile, variations) {
    // Distribute variations across worker pool
  }
}
```

**With Comlink (optional but recommended):**
```javascript
// Simpler API than raw postMessage
import { wrap } from 'https://esm.sh/comlink@4.4.1';

const worker = new Worker('video-worker.js', { type: 'module' });
const api = wrap(worker);

// Use worker methods like normal async functions
const result = await api.processVideo(videoData, effects);
```

**Why Comlink:**
- Eliminates postMessage boilerplate
- Type-safe communication (with TypeScript)
- Automatic serialization handling
- Small footprint (2.5KB gzipped)

**Why NOT:**
- If you want zero dependencies, raw Workers work fine
- Slightly more complex mental model

**Confidence:** HIGH for Web Workers, MEDIUM for Comlink version.

---

## Performance Optimization Stack

### Memory Management

| Technique | Implementation | When | Confidence |
|-----------|----------------|------|------------|
| Blob cleanup | `URL.revokeObjectURL()` | After each variation | HIGH |
| FFmpeg cleanup | `ffmpeg.deleteFile()` | After reading output | HIGH |
| Worker termination | `worker.terminate()` | After batch complete | HIGH |

### Progress Tracking

```javascript
ffmpeg.on('progress', ({ progress, time }) => {
  // progress: 0-1
  // time: current processing time in microseconds
  updateUI(progress);
});
```

**Confidence:** HIGH - Standard FFmpeg.wasm API.

### SharedArrayBuffer Requirements

**CRITICAL:** Multi-threaded FFmpeg.wasm requires COOP/COEP headers.

**Cloudflare Pages Configuration:**
```
# _headers file in public directory
/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
```

**Fallback Strategy:**
```javascript
// Detect SharedArrayBuffer support
const supportsMultiThreading = typeof SharedArrayBuffer !== 'undefined';

await ffmpeg.load({
  // Use multi-thread core if available, single-thread otherwise
  coreURL: supportsMultiThreading
    ? 'ffmpeg-core-mt.js'
    : 'ffmpeg-core.js'
});
```

**Confidence:** HIGH - This is a well-documented requirement.

---

## Supporting Libraries

### File Handling

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| file-saver | 2.0.x | Trigger browser downloads | Download individual files or ZIP | HIGH |

**Installation:**
```bash
npm install file-saver
```

**Usage:**
```javascript
import { saveAs } from 'file-saver';

// Download the ZIP
saveAs(zipBlob, 'variations.zip');
```

**Why NOT alternatives:**
- Raw `<a download>` works but file-saver handles edge cases and cross-browser issues

**Confidence:** HIGH

---

### Progress UI (Optional)

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| None required | - | Use native HTML5 `<progress>` | Lightweight, no dependencies | HIGH |
| nprogress | 0.2.x | Top-bar progress indicator | If you want polished UX | MEDIUM |

**Recommendation:** Stick with native `<progress>` element for batch processing. It's sufficient and has zero dependencies.

**Confidence:** HIGH

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not | Confidence |
|----------|-------------|-------------|---------|------------|
| Video Processing | FFmpeg.wasm | WebCodecs API | Limited browser support (2025), less feature-rich | HIGH |
| Video Processing | FFmpeg.wasm | Server-side processing | Against project constraint (client-side only) | HIGH |
| ZIP Creation | JSZip | fflate | More low-level, requires more code | MEDIUM |
| ZIP Creation | JSZip | zip.js | More complex API, unnecessary for this use case | MEDIUM |
| ZIP Creation | JSZip | client-zip | Newer, less proven in production | MEDIUM |
| Worker Management | Raw Workers | Comlink | Comlink adds small dependency but simplifies code significantly | MEDIUM |
| Worker Management | Worker Pool | Single Worker | Pool enables true parallelization across CPU cores | HIGH |
| CDN | esm.sh | unpkg | esm.sh has better ESM support and redirects | MEDIUM |
| CDN | esm.sh | jsdelivr | esm.sh is faster for ESM packages | MEDIUM |

---

## Installation Guide

### Option 1: CDN-based (Current Setup)

**Recommended for this project** - No build step, works on Cloudflare Pages.

```html
<!-- index.html -->
<script type="module">
  // Verify versions before using
  import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
  import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.1';
  import JSZip from 'https://esm.sh/jszip@3.10.1';
  import { saveAs } from 'https://esm.sh/file-saver@2.0.5';
  import { wrap } from 'https://esm.sh/comlink@4.4.1';

  // Your code
</script>
```

**Pros:**
- No build step
- Works with existing vanilla JS setup
- Easy to update versions

**Cons:**
- Network requests for each library
- No TypeScript support
- Harder to manage versions

### Option 2: NPM + Bundler (Future Consideration)

```bash
npm install @ffmpeg/ffmpeg @ffmpeg/util jszip file-saver comlink
```

Use with Vite or esbuild for bundling.

**Not recommended now** - Adds complexity without clear benefit for this project.

---

## Architecture Recommendations

### Sequential vs. Parallel Processing

**For 5-20 variations:**

```
SEQUENTIAL (Current):
Upload → Process V1 → Process V2 → ... → Process V20 → ZIP
Total time: ~20 minutes (60s per video)

PARALLEL (Recommended):
Upload → [Process V1, V2, V3, V4] → [V5, V6, V7, V8] → ... → ZIP
Total time: ~5 minutes (4 workers, 60s per video)
```

**Worker Pool Size:**
```javascript
// Use hardware concurrency, but cap at 4 for memory reasons
const workerCount = Math.min(navigator.hardwareConcurrency || 2, 4);
```

**Why cap at 4:**
- Each FFmpeg instance uses ~50-100MB memory
- Video files themselves are 100MB each
- Browser memory limits (~2GB typical)
- 4 workers = ~1GB max, safe headroom

**Confidence:** HIGH

### Memory-Efficient Processing Pipeline

```javascript
// Process in batches to avoid memory issues
async function processBatch(variations, batchSize = 4) {
  const zip = new JSZip();

  for (let i = 0; i < variations.length; i += batchSize) {
    const batch = variations.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(v => processWorker(v))
    );

    // Add to ZIP and cleanup immediately
    results.forEach((blob, idx) => {
      zip.file(`variation-${i + idx + 1}.mp4`, blob);
      URL.revokeObjectURL(blob); // Free memory
    });
  }

  return zip.generateAsync({ type: 'blob', streamFiles: true });
}
```

**Confidence:** HIGH

---

## What NOT to Use

### Do NOT Use: Old FFmpeg.wasm Patterns

**Anti-pattern (v0.11.x):**
```javascript
// Old API
createFFmpeg({ log: true });
```

**Correct (v0.12.x):**
```javascript
// New API
new FFmpeg();
ffmpeg.on('log', ({ message }) => console.log(message));
```

**Why:** API changed significantly in 0.12.x.

### Do NOT Use: Compression for Video Files in ZIP

```javascript
// WRONG
zip.generateAsync({ compression: 'DEFLATE' });

// RIGHT
zip.generateAsync({ compression: 'STORE' });
```

**Why:** Video files are already compressed (MP4 uses H.264). Attempting to compress again:
- Wastes CPU time
- Provides negligible size reduction (<1%)
- Slows down ZIP creation significantly

**Confidence:** HIGH

### Do NOT Use: Synchronous File Operations

```javascript
// WRONG - Blocks main thread
const zipData = zip.generateSync({ type: 'blob' });

// RIGHT - Async, non-blocking
const zipData = await zip.generateAsync({ type: 'blob' });
```

**Why:** Large files will freeze the browser.

**Confidence:** HIGH

### Do NOT Use: Multiple FFmpeg Instances in Same Worker

```javascript
// WRONG - Memory issues
const ffmpeg1 = new FFmpeg();
const ffmpeg2 = new FFmpeg();
await Promise.all([ffmpeg1.load(), ffmpeg2.load()]);

// RIGHT - One instance per worker
const ffmpeg = new FFmpeg();
await ffmpeg.load();
// Reuse same instance for all operations in this worker
```

**Why:** Each FFmpeg.wasm instance is ~50-100MB. Multiple instances per worker cause memory issues.

**Confidence:** HIGH

---

## Version Verification Checklist

Before implementation, verify these versions at official sources:

- [ ] [@ffmpeg/ffmpeg latest version](https://www.npmjs.com/package/@ffmpeg/ffmpeg)
- [ ] [@ffmpeg/util latest version](https://www.npmjs.com/package/@ffmpeg/util)
- [ ] [JSZip latest version](https://www.npmjs.com/package/jszip)
- [ ] [file-saver latest version](https://www.npmjs.com/package/file-saver)
- [ ] [Comlink latest version](https://www.npmjs.com/package/comlink)
- [ ] Check FFmpeg.wasm GitHub for breaking changes since Jan 2025
- [ ] Test SharedArrayBuffer support with COOP/COEP headers on Cloudflare Pages

---

## Migration Path from 0.11.6

### Step 1: Update Imports

```javascript
// OLD (0.11.6)
import { createFFmpeg, fetchFile } from 'https://esm.sh/@ffmpeg/ffmpeg@0.11.6';

// NEW (0.12.x)
import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.1';
```

### Step 2: Update Initialization

```javascript
// OLD
const ffmpeg = createFFmpeg({ log: true });
await ffmpeg.load();

// NEW
const ffmpeg = new FFmpeg();
ffmpeg.on('log', ({ message }) => console.log(message));
await ffmpeg.load({
  coreURL: await toBlobURL(/* ... */),
  wasmURL: await toBlobURL(/* ... */),
  // workerURL for multi-threading
});
```

### Step 3: Update File Operations

```javascript
// File operations remain similar
ffmpeg.writeFile('input.mp4', await fetchFile(file));
await ffmpeg.exec(['-i', 'input.mp4', 'output.mp4']);
const data = await ffmpeg.readFile('output.mp4');
```

### Step 4: Add Cloudflare Pages Headers

Create `public/_headers`:
```
/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Opener-Policy: same-origin
```

**Confidence for migration:** MEDIUM - API patterns are correct based on training data, but verify current documentation.

---

## Performance Benchmarks (Expected)

Based on typical FFmpeg.wasm performance:

| Scenario | 0.11.6 Single-threaded | 0.12.x Multi-threaded + Workers | Improvement |
|----------|------------------------|--------------------------------|-------------|
| 1 variation (100MB MP4) | ~60s | ~30s | 2x |
| 5 variations sequential | ~300s (5min) | ~30s | 10x |
| 20 variations sequential | ~1200s (20min) | ~90s (1.5min) | 13x |

**Assumptions:**
- 4 CPU cores available
- SharedArrayBuffer enabled (COOP/COEP headers set)
- Simple effects (filters, overlays, not complex encoding)

**Actual performance will vary based on:**
- User's CPU (mobile vs. desktop)
- Browser (Chrome/Firefox have best WASM performance)
- Effect complexity
- Video resolution

**Confidence:** MEDIUM - Estimates based on published FFmpeg.wasm benchmarks, but real-world results vary.

---

## Critical Success Factors

For this stack to perform well:

1. **COOP/COEP Headers** - MUST be set for SharedArrayBuffer (multi-threading)
2. **Worker Pool** - MUST use multiple workers for parallelization
3. **Memory Management** - MUST cleanup blobs/URLs after each variation
4. **No ZIP Compression** - MUST use STORE mode for video files
5. **Batch Size Limiting** - MUST process in batches to avoid memory exhaustion

**Missing any of these will severely impact performance or cause crashes.**

**Confidence:** HIGH

---

## Sources

Due to research limitations (no external tool access), this document is based on:

- Training data current to January 2025
- Established patterns for browser-based video processing
- FFmpeg.wasm documentation and community practices
- Web APIs and browser capabilities

**VERIFICATION REQUIRED:** All version numbers, API details, and recent changes must be verified against official documentation before implementation.

**Recommended verification sources:**
- https://github.com/ffmpegwasm/ffmpeg.wasm (releases, changelog, docs)
- https://www.npmjs.com/package/@ffmpeg/ffmpeg (latest version)
- https://www.npmjs.com/package/jszip (latest version, docs)
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- https://web.dev/articles/coop-coep (COOP/COEP header requirements)

---

## Summary

**Recommended Stack:**
- FFmpeg.wasm 0.12.x (upgrade from 0.11.6) for multi-threading
- JSZip 3.10.x+ for ZIP creation
- Web Workers + Comlink for parallelization
- file-saver 2.0.x for downloads
- COOP/COEP headers on Cloudflare Pages

**Key Performance Wins:**
- 10-13x speedup for batch processing via parallelization
- 2x speedup per video via multi-threaded FFmpeg
- Memory-efficient ZIP streaming

**Critical Requirements:**
- Set COOP/COEP headers for SharedArrayBuffer
- Use worker pool pattern (4 workers)
- No compression for video files in ZIP
- Aggressive memory cleanup

**Overall Confidence: MEDIUM** - Recommendations are architecturally sound, but versions and specific features require verification with official sources before implementation.
