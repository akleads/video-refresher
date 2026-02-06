# Phase 1: FFmpeg.wasm Upgrade - Research

**Researched:** 2026-02-06
**Domain:** FFmpeg.wasm WebAssembly video processing
**Confidence:** HIGH

## Summary

FFmpeg.wasm 0.12.x represents a major rewrite with breaking API changes from 0.11.x. The upgrade requires comprehensive code refactoring: class-based instantiation replaces factory functions, filesystem operations become async, method names change (run→exec, FS→writeFile/readFile), and configuration moves to load() instead of constructor.

Multi-threading via `@ffmpeg/core-mt` requires SharedArrayBuffer, which demands COOP/COEP headers. Cloudflare Pages supports these headers via a `_headers` file. Browser compatibility is excellent (Chrome 68+, Firefox 79+, Safari 15.2+) but iOS Safari lacks SharedArrayBuffer in workers. Single-threaded fallback via `@ffmpeg/core-st` is available but requires explicit detection and separate loading logic.

**Primary recommendation:** Use `@ffmpeg/core-mt@0.12.10` with toBlobURL() for CDN loading, implement SharedArrayBuffer detection for automatic fallback to `@ffmpeg/core-st`, configure COOP/COEP headers via `_headers` file, and expect to refactor 80%+ of existing FFmpeg integration code due to breaking API changes.

## Standard Stack

The established libraries/tools for FFmpeg.wasm 0.12.x:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @ffmpeg/ffmpeg | 0.12.14 | Main FFmpeg.wasm interface | Official package, class-based API, event system |
| @ffmpeg/core-mt | 0.12.10 | Multi-threaded WASM core | 2x performance, official multi-threading support |
| @ffmpeg/util | 0.12.2 | Utility functions (toBlobURL, fetchFile) | CORS bypass, file fetching helpers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @ffmpeg/core-st | 0.12.10 | Single-threaded WASM core | Fallback when SharedArrayBuffer unavailable |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CDN loading | npm + bundler | CDN avoids build step but requires toBlobURL for CORS; bundler handles deps but adds complexity |
| Multi-threaded | Single-threaded only | MT gives 2x perf but requires COOP/COEP headers and browser support |

**Installation (if using npm):**
```bash
npm install @ffmpeg/ffmpeg@0.12.14 @ffmpeg/util@0.12.2
# Then choose one:
npm install @ffmpeg/core-mt@0.12.10  # Multi-threading
npm install @ffmpeg/core-st@0.12.10  # Single-threaded
```

**CDN Loading (recommended for no-build-step projects):**
```javascript
// From jsdelivr CDN
const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'
// Use toBlobURL to bypass CORS issues
```

## Architecture Patterns

### Recommended Migration Structure

The 0.11.x → 0.12.x upgrade is not incremental; it requires complete refactoring of FFmpeg integration code.

### Pattern 1: Class-Based Instantiation (BREAKING CHANGE)
**What:** Replace factory function with constructor
**When to use:** Always in 0.12.x
**Example:**
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/migration/

// 0.11.x (OLD - DO NOT USE)
import { createFFmpeg } from '@ffmpeg/ffmpeg'
const ffmpeg = createFFmpeg({ log: true })
await ffmpeg.load()

// 0.12.x (NEW - REQUIRED)
import { FFmpeg } from '@ffmpeg/ffmpeg'
const ffmpeg = new FFmpeg()
await ffmpeg.load({
  coreURL: '...',
  wasmURL: '...',
  workerURL: '...'  // Required for multi-threading
})
```

### Pattern 2: Async File System Operations (BREAKING CHANGE)
**What:** All FS operations now return Promises
**When to use:** All file read/write/delete operations
**Example:**
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/migration/

// 0.11.x (OLD - DO NOT USE)
ffmpeg.FS('writeFile', 'input.mp4', videoData)
const output = ffmpeg.FS('readFile', 'output.mp4')
ffmpeg.FS('unlink', 'input.mp4')

// 0.12.x (NEW - REQUIRED)
await ffmpeg.writeFile('input.mp4', videoData)
const output = await ffmpeg.readFile('output.mp4')
await ffmpeg.deleteFile('input.mp4')
```

### Pattern 3: Event-Based Logging and Progress (BREAKING CHANGE)
**What:** Callbacks replaced with event listeners
**When to use:** Progress tracking, debug logging
**Example:**
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/migration/

// 0.11.x (OLD - DO NOT USE)
const ffmpeg = createFFmpeg({
  log: true,
  progress: ({ ratio }) => {
    console.log('Progress:', ratio * 100 + '%')
  }
})

// 0.12.x (NEW - REQUIRED)
const ffmpeg = new FFmpeg()
ffmpeg.on('log', ({ message }) => {
  console.log('FFmpeg:', message)
})
ffmpeg.on('progress', ({ progress, time }) => {
  // progress: 0-1 ratio
  // time: microseconds (divide by 1000000 for seconds)
  console.log('Progress:', Math.round(progress * 100) + '%')
})
```

### Pattern 4: CDN Loading with toBlobURL (REQUIRED for CDN usage)
**What:** Convert CDN URLs to blob URLs to bypass CORS restrictions
**When to use:** Loading core files from CDN (unpkg, jsdelivr, esm.sh)
**Example:**
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/getting-started/usage/
import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.14/+esm'
import { toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm'

const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'

const ffmpeg = new FFmpeg()
await ffmpeg.load({
  coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript')
})
```

### Pattern 5: SharedArrayBuffer Detection and Fallback
**What:** Check for SharedArrayBuffer support before loading multi-threaded core
**When to use:** Production apps that need broad browser compatibility
**Example:**
```javascript
// Source: Synthesized from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

function supportsSharedArrayBuffer() {
  return typeof SharedArrayBuffer !== 'undefined' &&
         crossOriginIsolated === true
}

const baseURL = supportsSharedArrayBuffer()
  ? 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'  // Multi-threaded
  : 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.10/dist/esm'  // Single-threaded

const loadConfig = {
  coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
  wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
}

// Only add workerURL for multi-threaded
if (supportsSharedArrayBuffer()) {
  loadConfig.workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript')
}

await ffmpeg.load(loadConfig)
```

### Pattern 6: Cloudflare Pages COOP/COEP Headers
**What:** Enable SharedArrayBuffer via cross-origin isolation headers
**When to use:** Deploying to Cloudflare Pages with multi-threading
**Example:**
```
# Source: https://developers.cloudflare.com/pages/configuration/headers/
# File: _headers (place in build output directory)

/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### Anti-Patterns to Avoid
- **Assuming backward compatibility:** 0.12.x is NOT compatible with 0.11.x code. Expect to refactor 80%+ of FFmpeg integration.
- **Mixing sync and async FS operations:** All file operations are async in 0.12.x. Do not use 0.11.x synchronous patterns.
- **Loading core files directly from CDN without toBlobURL:** Workers have CORS restrictions; always use toBlobURL for CDN resources.
- **Assuming multi-threading always works:** SharedArrayBuffer requires COOP/COEP headers AND browser support. Always implement fallback.
- **Reusing FFmpeg instances after terminate():** Once terminate() is called, you must call load() again before using the instance.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CORS bypass for CDN loading | Custom proxy/service worker | toBlobURL from @ffmpeg/util | Officially supported, handles blob URL creation and cleanup |
| Progress calculation | Parse FFmpeg stderr manually | ffmpeg.on('progress') event | Built-in progress tracking with ratio and time, though experimental |
| SharedArrayBuffer detection | Feature detection only | Check both typeof SharedArrayBuffer and crossOriginIsolated | SharedArrayBuffer may exist but be disabled without proper headers |
| File type conversion | Read/parse file headers | fetchFile from @ffmpeg/util | Handles URLs, File objects, Blob conversion automatically |

**Key insight:** FFmpeg.wasm 0.12.x architecture assumes workers + async operations. Custom solutions that try to work around these assumptions (inline workers, synchronous wrappers) will break or perform poorly.

## Common Pitfalls

### Pitfall 1: Version Mismatch Between Packages
**What goes wrong:** Loading @ffmpeg/ffmpeg@0.12.14 with @ffmpeg/core-mt@0.12.6 causes "module not found" or runtime errors
**Why it happens:** Core packages are not always published in sync with main package; npm CDN caching delays
**How to avoid:** Pin to known-good version combo: @ffmpeg/ffmpeg@0.12.14 + @ffmpeg/core-mt@0.12.10 + @ffmpeg/util@0.12.2
**Warning signs:** 404 errors loading core files, "Cannot find module" errors, version mismatch warnings in console
**Source:** [GitHub Discussion #812](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/812)

### Pitfall 2: Memory Leaks with Multiple Processes
**What goes wrong:** Browser memory grows linearly with each video processed, never releasing; "out of memory" errors after ~60 videos
**Why it happens:** terminate() does not fully kill workers or free WASM memory; WASM heap persists between operations
**How to avoid:** For bulk processing, implement page reload after N videos (recommended: 20-30); for single videos, reload after completion or provide download-and-refresh flow
**Warning signs:** Browser memory grows steadily, tab becomes sluggish, "out of memory" or "memory access out of bounds" errors
**Source:** [Issue #494](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/494), [Issue #200](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/200), [Issue #704](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/704)

### Pitfall 3: Headers Not Applied Without Full Restart
**What goes wrong:** COOP/COEP headers configured but SharedArrayBuffer still undefined; dev server shows headers but browser rejects
**Why it happens:** Browser caches cross-origin isolation state; hot reload doesn't clear security context
**How to avoid:** After adding COOP/COEP headers, fully stop and restart dev server (not just reload page); clear browser cache if issues persist
**Warning signs:** Headers visible in network tab but crossOriginIsolated === false, SharedArrayBuffer undefined despite headers
**Source:** [Medium: FFmpeg.wasm Integration Debugging Journey](https://medium.com/@nikunjkr1752003/ffmpeg-wasm-integration-debugging-journey-report-e23d579e81a0)

### Pitfall 4: Safari iOS Incompatibility (Multi-threading)
**What goes wrong:** Multi-threaded core fails silently on iOS Safari; SharedArrayBuffer undefined
**Why it happens:** iOS Safari (as of iOS 17) does not support SharedArrayBuffer in Web Workers
**How to avoid:** Implement single-threaded fallback for all Safari users; detect with browser UA or SharedArrayBuffer check
**Warning signs:** Works in Chrome/Firefox, fails in Safari; user reports on iOS devices
**Source:** [Browser Compatibility Research](https://caniuse.com/sharedarraybuffer)

### Pitfall 5: Progress Event Inaccuracy
**What goes wrong:** Progress jumps erratically, shows negative values, or stays at 0%
**Why it happens:** Progress calculation only accurate when input/output lengths match; experimental feature with known bugs in 0.12.6+
**How to avoid:** Use progress for UI feedback only, not critical logic; validate progress values (clamp 0-1, check for negative); consider showing indeterminate spinner instead
**Warning signs:** Progress goes backward, exceeds 100%, or returns negative time values
**Source:** [Issue #600](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/600), [Issue #152](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/152)

### Pitfall 6: Cloudflare Pages Header File Location
**What goes wrong:** `_headers` file created but headers not applied; COOP/COEP still missing in production
**Why it happens:** _headers must be in publish/build output directory (e.g., `public/_headers`), not project root
**How to avoid:** Place _headers where static files are served from; verify in Cloudflare Pages deploy logs that headers file is detected
**Warning signs:** Headers work locally but not in production; Cloudflare deploy log doesn't mention _headers
**Source:** [Cloudflare Pages Headers Documentation](https://developers.cloudflare.com/pages/configuration/headers/)

## Code Examples

Verified patterns from official sources:

### Complete 0.11.x to 0.12.x Refactor Example
```javascript
// Source: https://ffmpegwasm.netlify.app/docs/migration/

// ===== 0.11.x CODE (BEFORE) =====
import { createFFmpeg, fetchFile } from '@ffmpeg/ffmpeg'

let ffmpeg = null
let ffmpegLoaded = false

async function loadFFmpeg() {
  if (ffmpegLoaded) return

  ffmpeg = createFFmpeg({
    log: true,
    progress: ({ ratio }) => {
      updateProgress(Math.round(ratio * 100))
    },
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
  })

  await ffmpeg.load()
  ffmpegLoaded = true
}

async function processVideo(file) {
  await loadFFmpeg()

  const inputFile = 'input.mp4'
  const outputFile = 'output.mp4'

  // Write file (synchronous)
  ffmpeg.FS('writeFile', inputFile, await fetchFile(file))

  // Run command
  await ffmpeg.run('-i', inputFile, '-vf', 'scale=1280:720', outputFile)

  // Read output (synchronous)
  const data = ffmpeg.FS('readFile', outputFile)

  // Cleanup
  ffmpeg.FS('unlink', inputFile)
  ffmpeg.FS('unlink', outputFile)

  return new Blob([data.buffer], { type: 'video/mp4' })
}

// ===== 0.12.x CODE (AFTER) =====
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg = null
let ffmpegLoaded = false

async function loadFFmpeg() {
  if (ffmpegLoaded) return

  ffmpeg = new FFmpeg()

  // Event listeners instead of config
  ffmpeg.on('log', ({ message }) => {
    console.log('FFmpeg:', message)
  })

  ffmpeg.on('progress', ({ progress, time }) => {
    updateProgress(Math.round(progress * 100))
  })

  // Load with toBlobURL for CDN
  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript')
  })

  ffmpegLoaded = true
}

async function processVideo(file) {
  await loadFFmpeg()

  const inputFile = 'input.mp4'
  const outputFile = 'output.mp4'

  // Write file (async)
  await ffmpeg.writeFile(inputFile, await fetchFile(file))

  // Run command → exec
  await ffmpeg.exec(['-i', inputFile, '-vf', 'scale=1280:720', outputFile])

  // Read output (async)
  const data = await ffmpeg.readFile(outputFile)

  // Cleanup (async)
  await ffmpeg.deleteFile(inputFile)
  await ffmpeg.deleteFile(outputFile)

  return new Blob([data.buffer], { type: 'video/mp4' })
}
```

### Production-Ready Fallback Pattern
```javascript
// Source: Synthesized from official docs + browser compatibility research

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

async function loadFFmpegWithFallback() {
  const ffmpeg = new FFmpeg()

  // Check for SharedArrayBuffer support
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined' &&
                                crossOriginIsolated === true

  let coreType = 'single-threaded'
  let baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.10/dist/esm'

  if (hasSharedArrayBuffer) {
    coreType = 'multi-threaded'
    baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm'
  }

  console.log(`Loading FFmpeg (${coreType})`)

  const loadConfig = {
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  }

  // Multi-threaded requires worker file
  if (hasSharedArrayBuffer) {
    loadConfig.workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript')
  }

  await ffmpeg.load(loadConfig)

  return { ffmpeg, isMultiThreaded: hasSharedArrayBuffer }
}
```

### Cloudflare Pages Production Configuration
```
# Source: https://developers.cloudflare.com/pages/configuration/headers/
# File: public/_headers (for Cloudflare Pages deployment)

# Enable SharedArrayBuffer for all pages
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

# Optional: Cache FFmpeg core files aggressively (if self-hosting)
/ffmpeg-core/*
  Cache-Control: public, max-age=31536000, immutable
```

### Python Dev Server with COOP/COEP (for local testing)
```python
# Source: Common pattern for local SharedArrayBuffer testing
# File: dev_server.py

from http.server import HTTPServer, SimpleHTTPRequestHandler

class COOPCOEPHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    server = HTTPServer(('localhost', 8000), COOPCOEPHandler)
    print('Dev server running at http://localhost:8000')
    print('COOP/COEP headers enabled for SharedArrayBuffer testing')
    server.serve_forever()
```

## State of the Art

| Old Approach (0.11.x) | Current Approach (0.12.x) | When Changed | Impact |
|----------------------|--------------------------|--------------|--------|
| Factory function (createFFmpeg) | Class constructor (new FFmpeg) | July 2023 (0.12.0) | Breaking: All instantiation code must change |
| Sync FS operations (FS.writeFile) | Async methods (await writeFile) | July 2023 (0.12.0) | Breaking: All file I/O must be awaited |
| run(...args) | exec([args]) | July 2023 (0.12.0) | Breaking: Command execution syntax changes |
| Config in constructor | Config in load() | July 2023 (0.12.0) | Breaking: Initialization pattern changes |
| Callbacks (setLogger/setProgress) | Event listeners (on/off) | July 2023 (0.12.0) | Breaking: Event handling refactor required |
| Single package (@ffmpeg/ffmpeg) | Split packages (@ffmpeg/ffmpeg + @ffmpeg/util) | July 2023 (0.12.0) | Must import fetchFile from @ffmpeg/util |
| Implicit core loading | Explicit core URLs (CDN or self-hosted) | July 2023 (0.12.0) | Must provide coreURL, wasmURL, workerURL |
| COEP: require-corp only | COEP: require-corp OR credentialless | 2025 update | More flexible cross-origin isolation |

**Deprecated/outdated:**
- **@ffmpeg/ffmpeg@0.11.x**: Still on npm but unmaintained; no security updates; incompatible with 0.12.x patterns
- **Implicit corePath in createFFmpeg**: No longer supported; must explicitly provide URLs in load()
- **0.11.x CDN pattern (esm.sh/@ffmpeg/ffmpeg@0.11.6)**: Worker CORS issues; 0.12.x requires toBlobURL
- **exit() method**: Renamed to terminate() in 0.12.x
- **ffprobe as separate tool**: Now built into 0.12.14+ as ffmpeg.ffprobe() method

## Open Questions

Things that couldn't be fully resolved:

1. **Memory leak resolution timeline**
   - What we know: terminate() does not fully release WASM memory; known issue in 0.12.x
   - What's unclear: Whether this will be fixed in 0.13.x or if it's a WASM/browser limitation
   - Recommendation: Plan for page reloads after bulk processing (20-30 videos); monitor GitHub releases for memory fixes

2. **Progress event reliability in 0.12.10**
   - What we know: Progress events had negative value bug in 0.12.6; status in 0.12.10 unclear
   - What's unclear: Whether the bug is fully resolved or still affects certain operations
   - Recommendation: Implement progress with defensive checks (clamp 0-1, validate non-negative); test thoroughly with target video types

3. **esm.sh CDN compatibility for 0.12.x**
   - What we know: 0.11.x worked with esm.sh; 0.12.x examples use jsdelivr
   - What's unclear: Whether esm.sh properly serves 0.12.x core files (especially worker.js)
   - Recommendation: Prefer jsdelivr for 0.12.x (proven in official docs); if using esm.sh, verify all three files (core.js, core.wasm, core.worker.js) load correctly

4. **Cloudflare Pages _headers file precedence**
   - What we know: _headers file works; max 100 rules, 2000 chars per line
   - What's unclear: Whether Cloudflare's default security headers conflict with custom COOP/COEP
   - Recommendation: Test in Cloudflare Pages preview environment; verify crossOriginIsolated === true in production console

5. **Safari desktop vs iOS SharedArrayBuffer support**
   - What we know: iOS Safari lacks SharedArrayBuffer in workers (as of iOS 17)
   - What's unclear: Whether Safari desktop (macOS) has full support or similar limitations
   - Recommendation: Implement fallback for all Safari versions; test on macOS Safari 15.2+

## Sources

### Primary (HIGH confidence)
- [Official Migration Guide 0.11.x to 0.12+](https://ffmpegwasm.netlify.app/docs/migration/) - Complete API mapping
- [FFmpeg.wasm 0.12.0 Release Blog](https://ffmpegwasm.netlify.app/blog/release-ffmpeg.wasm-0.12.0/) - Breaking changes rationale
- [FFmpeg.wasm Usage Documentation](https://ffmpegwasm.netlify.app/docs/getting-started/usage/) - Official patterns for 0.12.x
- [FFmpeg Class API Reference](https://ffmpegwasm.netlify.app/docs/api/ffmpeg/classes/ffmpeg/) - Method signatures
- [Cloudflare Pages Headers Documentation](https://developers.cloudflare.com/pages/configuration/headers/) - Official _headers file format
- [@ffmpeg/util npm package](https://www.npmjs.com/package/@ffmpeg/util) - toBlobURL documentation
- [@ffmpeg/core-mt npm package](https://www.npmjs.com/package/@ffmpeg/core-mt) - Latest version (0.12.10)
- [MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) - Browser compatibility

### Secondary (MEDIUM confidence)
- [GitHub Discussion #812 - v12.14 Release](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/812) - Version status
- [GitHub Issue #494 - Memory Leak](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/494) - Known memory issues
- [GitHub Issue #200 - OOM with Multiple Instances](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/200) - Memory management
- [GitHub Issue #704 - Memory Access Out of Bounds](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/704) - Bulk processing limits
- [GitHub Issue #600 - Progress Event Value](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/600) - Progress bugs
- [GitHub Discussion #856 - Upgrading to 0.12 with Different Domain](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/856) - CORS workarounds
- [Can I Use: SharedArrayBuffer](https://caniuse.com/sharedarraybuffer) - Browser compatibility data

### Tertiary (LOW confidence)
- [Medium: FFmpeg.wasm Integration Debugging Journey](https://medium.com/@nikunjkr1752003/ffmpeg-wasm-integration-debugging-journey-report-e23d579e81a0) - Community troubleshooting
- [Mastering FFMPEG WASM Blog Post](https://harryosmarsitohang.com/articles/ffmpeg-wasm) - General patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official npm versions verified, jsdelivr CDN proven in docs
- Architecture: HIGH - Official migration guide comprehensive, API changes fully documented
- Pitfalls: MEDIUM-HIGH - Memory issues confirmed in multiple GitHub issues; progress bugs documented but fix status unclear

**Research date:** 2026-02-06
**Valid until:** ~March 2026 (30 days) - 0.12.x is stable; watch for 0.13.x announcements with TypeScript rewrite
