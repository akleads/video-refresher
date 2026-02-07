# Phase 2: Memory Management - Research

**Researched:** 2026-02-06
**Domain:** Browser-based memory management with FFmpeg.wasm and blob URLs
**Confidence:** HIGH

## Summary

Memory management in browser-based video processing is a multi-layered challenge requiring careful coordination between blob URL lifecycle, FFmpeg.wasm's virtual filesystem cleanup, and JavaScript object retention. The current codebase creates blob URLs without revoking them and stores references indefinitely in the `processedVideos` array, causing memory to grow linearly with each processed video.

Browser blob URLs are deliberately designed as memory-persistent objects that survive until explicitly revoked with `URL.revokeObjectURL()` or until page unload. FFmpeg.wasm 0.12.x uses a virtual MEMFS filesystem that requires manual cleanup via `deleteFile()` operations, though the library has known issues with instance-level cleanup methods like `exit()`. The `processedVideos` array creates strong references to blob URLs and metadata, preventing garbage collection even if individual references are nullified elsewhere.

For this phase, the standard approach is: (1) implement centralized blob URL registry with automatic revocation, (2) ensure FFmpeg filesystem cleanup after each operation via existing `deleteFile()` calls, (3) limit `processedVideos` array size with automatic oldest-entry eviction, and (4) avoid FFmpeg instance recreation unless recovery is needed, as the library supports sequential operations on a single loaded instance.

**Primary recommendation:** Implement lifecycle-aware blob URL management with explicit revocation points, maintain existing FFmpeg filesystem cleanup, and cap the `processedVideos` array with LRU-style eviction rather than unbounded growth.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Browser Blob API | Native | Create/revoke object URLs | Built-in browser capability, zero dependencies |
| FFmpeg.wasm | 0.12.14 | Video processing | Already in use, established WebAssembly FFmpeg port |
| Chrome DevTools Memory Panel | Native | Memory profiling and leak detection | Industry standard for memory debugging |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Performance Monitor | Native (Chrome DevTools) | Real-time heap tracking | Manual verification of memory stability |
| Heap Snapshots | Native (Chrome DevTools) | Memory leak identification | Comparing before/after states |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual blob tracking | WeakMap for automatic GC | Cannot enumerate/iterate blob URLs for bulk cleanup; unsuitable for centralized registry pattern |
| FFmpeg instance recreation | Single persistent instance | Current approach is correct; recreation causes significant performance overhead and is unnecessary |
| Unbounded array | LRU cache library | Adds dependency for simple eviction logic; manual implementation preferred for transparency |

**Installation:**
No additional packages required. All memory management uses browser native APIs.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── memory/
│   ├── blobRegistry.js      # Centralized blob URL tracking and cleanup
│   └── arrayManager.js      # processedVideos size limiting
├── ffmpeg/
│   └── cleanup.js           # FFmpeg filesystem operations wrapper
└── app.js                   # Main application (existing)
```

Note: For this simple application, inline implementation in `app.js` is acceptable. The structure above is provided as guidance for larger applications.

### Pattern 1: Blob URL Registry with Lifecycle Management
**What:** Centralized tracking of all created blob URLs with explicit cleanup points
**When to use:** Any application creating multiple blob URLs across operations
**Example:**
```javascript
// Source: MDN Blob URL documentation + field research
class BlobURLRegistry {
  constructor() {
    this.urls = new Map(); // URL string -> metadata
  }

  register(blob, metadata = {}) {
    const url = URL.createObjectURL(blob);
    this.urls.set(url, {
      blob,
      created: Date.now(),
      ...metadata
    });
    return url;
  }

  revoke(url) {
    if (this.urls.has(url)) {
      URL.revokeObjectURL(url);
      this.urls.delete(url);
    }
  }

  revokeAll() {
    for (const url of this.urls.keys()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }

  // Clean up URLs older than threshold
  revokeOlderThan(ageMs) {
    const now = Date.now();
    for (const [url, metadata] of this.urls.entries()) {
      if (now - metadata.created > ageMs) {
        this.revoke(url);
      }
    }
  }
}

// Usage
const blobRegistry = new BlobURLRegistry();
const url = blobRegistry.register(videoBlob, { type: 'processed' });
video.src = url;

// Later: explicit cleanup
blobRegistry.revoke(url);

// Or: bulk cleanup when user navigates away
window.addEventListener('beforeunload', () => blobRegistry.revokeAll());
```

### Pattern 2: Bounded Array with Eviction Policy
**What:** Array size limiting with automatic removal of oldest entries
**When to use:** Storing unbounded user-generated data in memory (videos, images, documents)
**Example:**
```javascript
// Source: Standard JavaScript data structures + garbage collection research
class BoundedArray {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.items = [];
  }

  push(item) {
    this.items.push(item);

    // Evict oldest when limit exceeded
    if (this.items.length > this.maxSize) {
      const removed = this.items.shift();

      // Cleanup hook for resources
      if (this.onEvict) {
        this.onEvict(removed);
      }
    }
  }

  getAll() {
    return this.items.slice(); // Return copy
  }

  clear() {
    // Cleanup all items
    if (this.onEvict) {
      this.items.forEach(item => this.onEvict(item));
    }
    this.items = [];
  }
}

// Usage for processedVideos
const MAX_VIDEOS = 20; // Cap at 20 videos
const processedVideos = new BoundedArray(MAX_VIDEOS);

// Hook for blob URL cleanup when evicted
processedVideos.onEvict = (video) => {
  URL.revokeObjectURL(video.processedURL);
  if (video.originalURL) {
    URL.revokeObjectURL(video.originalURL);
  }
};

// Add videos normally
processedVideos.push({ processedURL: url, originalURL: origUrl, ... });
```

### Pattern 3: FFmpeg Filesystem Cleanup Wrapper
**What:** Ensure FFmpeg MEMFS cleanup with error tolerance
**When to use:** All FFmpeg operations that write temporary files
**Example:**
```javascript
// Source: FFmpeg.wasm GitHub issues #365, #494
async function processWithCleanup(ffmpeg, inputFile, outputFile, ffmpegArgs) {
  try {
    // Write input
    await ffmpeg.writeFile(inputFile, videoData);

    // Process
    await ffmpeg.exec(ffmpegArgs);

    // Read output
    const result = await ffmpeg.readFile(outputFile);

    return result;
  } finally {
    // Always cleanup, even on error
    try {
      await ffmpeg.deleteFile(inputFile);
    } catch (e) {
      console.warn('Input cleanup warning:', e);
    }

    try {
      await ffmpeg.deleteFile(outputFile);
    } catch (e) {
      console.warn('Output cleanup warning:', e);
    }
  }
}
```

### Pattern 4: FFmpeg Instance Recovery on Failure
**What:** Detect corrupted FFmpeg state and reload instance
**When to use:** After FFmpeg processing errors that may leave instance in bad state
**Example:**
```javascript
// Source: FFmpeg.wasm GitHub issues #242, #330
async function recoverFFmpegIfNeeded(ffmpeg, error) {
  // Indicators of corrupted instance state
  const corruptionIndicators = [
    /abort/i,
    /OOM/i,
    /Out of Memory/i,
    /WASM/i
  ];

  const needsRecovery = corruptionIndicators.some(
    pattern => pattern.test(error.message)
  );

  if (needsRecovery) {
    console.warn('FFmpeg instance may be corrupted, reloading...');

    // Note: ffmpeg.exit() has known issues in 0.12.x
    // Safest approach is to create new instance
    ffmpeg = new FFmpeg();

    // Re-setup event handlers
    ffmpeg.on('progress', handleProgress);
    ffmpeg.on('log', handleLog);

    // Reload
    await loadFFmpeg(); // Your existing load function

    return { recovered: true, ffmpeg };
  }

  return { recovered: false, ffmpeg };
}

// Usage
try {
  await ffmpeg.exec([...]);
} catch (error) {
  const { recovered, ffmpeg: newInstance } = await recoverFFmpegIfNeeded(ffmpeg, error);

  if (recovered) {
    ffmpeg = newInstance;
    // Optionally retry operation
  } else {
    throw error; // Propagate non-corruption errors
  }
}
```

### Anti-Patterns to Avoid

- **Immediate revocation after assignment**: Don't revoke blob URLs immediately after setting `video.src = url`. The browser needs time to load the resource. Revoke after load event or when replacing/removing the video element.

- **WeakMap for blob URLs**: Blob URLs are strings (primitives), not objects. WeakMap only accepts object keys, making it unsuitable for blob URL tracking.

- **FFmpeg instance recreation per operation**: Don't create a new FFmpeg instance for each video. The library supports sequential operations on a loaded instance. Only recreate on corruption/failure.

- **No size limit on processedVideos**: Unbounded arrays cause linear memory growth. Always cap at reasonable limit (10-50 items depending on video sizes).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Memory leak detection | Custom instrumentation | Chrome DevTools Memory Panel + Heap Snapshots | Built-in, industry-standard tooling with deep engine integration |
| Garbage collection triggering | Manual GC calls | Natural reference removal + browser GC | Manual GC is not reliable cross-browser and interferes with engine optimization |
| Blob lifecycle tracking | Ad-hoc `created` flags | Centralized registry pattern | Prevents scattered cleanup logic and missed revocations |
| FFmpeg MEMFS inspection | Custom FS debugging | `ffmpeg.FS('readdir', '/')` (if needed) | Library provides filesystem introspection; don't reimplement |

**Key insight:** Browser memory management is event-driven and lifecycle-based. Custom memory management abstractions add complexity without benefit when native patterns (explicit cleanup at lifecycle points) work reliably.

## Common Pitfalls

### Pitfall 1: Blob URLs Surviving Beyond Necessity
**What goes wrong:** Blob URLs remain in memory after the video element is removed or replaced, consuming memory unnecessarily.

**Why it happens:** Blob URLs are **not** automatically garbage collected when the DOM element using them is removed. The browser maintains the blob URL mapping until explicitly revoked or page unload.

**How to avoid:**
1. Track all created blob URLs in a registry
2. Revoke when DOM element is removed or replaced
3. Revoke when user navigates to different functionality
4. Bulk revoke on page unload for safety

**Warning signs:**
- Memory grows linearly with number of processed videos
- DevTools Memory Panel shows increasing blob storage
- Heap snapshot shows many "Detached HTMLVideoElement" objects

**Source:** [MDN Blob URL Documentation](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob)

### Pitfall 2: FFmpeg Filesystem Not Cleaned Between Operations
**What goes wrong:** Files remain in MEMFS after processing, accumulating and consuming WASM memory heap space.

**Why it happens:** FFmpeg.wasm uses a virtual in-memory filesystem (MEMFS). Files written to this filesystem persist until explicitly deleted. There is no automatic cleanup.

**How to avoid:**
1. Always use try-finally blocks around FFmpeg operations
2. Call `deleteFile()` for both input and output files in finally block
3. Log cleanup warnings but don't fail on cleanup errors
4. Current code already does this (lines 509-514 in app.js) - **maintain this pattern**

**Warning signs:**
- Memory grows even with blob URL revocation
- FFmpeg processing gets slower over multiple operations
- "Out of Memory" errors on later operations despite earlier successes

**Source:** [FFmpeg.wasm GitHub Issue #365](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/365)

### Pitfall 3: processedVideos Array Growing Unbounded
**What goes wrong:** Each processed video adds an object to the array, creating strong references to blob URLs and metadata. Array never shrinks, causing linear memory growth.

**Why it happens:** JavaScript arrays maintain strong references to all elements. Even if you revoke a blob URL, if the string reference exists in an object in the array, that memory slot remains allocated.

**How to avoid:**
1. Set maximum array size (e.g., 20 videos)
2. Implement eviction policy (remove oldest when adding new beyond limit)
3. Revoke blob URLs in eviction handler before removing object
4. Provide "Clear All" UI button for manual cleanup

**Warning signs:**
- Memory grows proportionally to number of videos processed
- Heap snapshots show array with hundreds of video objects
- Browser becomes sluggish after processing many videos

**Source:** [JavaScript Memory Management - MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management)

### Pitfall 4: FFmpeg Instance Corruption After Errors
**What goes wrong:** After certain FFmpeg errors (OOM, abort, WASM failures), the instance may be left in a corrupted state where subsequent operations fail or hang.

**Why it happens:** FFmpeg.wasm 0.12.x has known issues where internal WASM state corruption isn't fully recoverable. The `exit()` method itself has bugs that can worsen the problem.

**How to avoid:**
1. Detect corruption-indicating errors (abort, OOM, WASM failures)
2. Create new FFmpeg instance on detected corruption
3. Don't call `exit()` for recovery - known buggy in 0.12.x
4. Re-setup event handlers on new instance
5. Optionally retry the failed operation once

**Warning signs:**
- FFmpeg operations hang indefinitely after an error
- "FFmpeg is not loaded" despite `ffmpegLoaded === true`
- Console shows WASM-related errors

**Sources:**
- [FFmpeg.wasm Issue #242 - exit() bugs](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/242)
- [FFmpeg.wasm Issue #330 - Can't reuse ffmpeg](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/330)

### Pitfall 5: Not Clamping Video Element References
**What goes wrong:** Setting `video.src = blobURL` multiple times for the same element creates multiple load attempts, potentially loading old blob data even after revocation.

**Why it happens:** Video element load behavior is asynchronous. Changing `src` doesn't immediately release the old blob URL reference from browser internal structures.

**How to avoid:**
1. Revoke old blob URL AFTER new one is loaded (use `loadeddata` event)
2. Or: explicitly set `video.src = ''` before revoking and assigning new URL
3. Store current blob URL with element to track what needs revocation

**Warning signs:**
- Video playback shows wrong video briefly
- Memory doesn't decrease even after revocation
- Browser console shows "blob URL not found" warnings

**Source:** Field research + MDN video element documentation

## Code Examples

Verified patterns from official sources:

### Blob URL Creation and Revocation
```javascript
// Source: MDN - https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
const videoBlob = new Blob([videoData], { type: 'video/mp4' });
const blobURL = URL.createObjectURL(videoBlob);

// Use the blob URL
videoElement.src = blobURL;

// Wait for video to load
videoElement.addEventListener('loadeddata', () => {
  console.log('Video loaded, blob URL can be revoked after user is done viewing');
});

// Revoke when done (e.g., replacing with new video)
URL.revokeObjectURL(blobURL);
```

### FFmpeg Filesystem Cleanup (from current codebase)
```javascript
// Source: Current app.js lines 509-514 (already implemented correctly)
try {
  await ffmpeg.deleteFile(inputFileName);
  await ffmpeg.deleteFile(outputFileName);
} catch (e) {
  console.warn('Cleanup warning:', e);
}
```

### Array Size Limiting with Eviction
```javascript
// Source: Standard JavaScript + GC research
function addProcessedVideo(video) {
  const MAX_VIDEOS = 20;

  processedVideos.push(video);

  if (processedVideos.length > MAX_VIDEOS) {
    const removed = processedVideos.shift(); // Remove oldest

    // Cleanup evicted video's resources
    URL.revokeObjectURL(removed.processedURL);
    if (removed.originalURL) {
      URL.revokeObjectURL(removed.originalURL);
    }
  }

  updateProcessedVideosList();
}
```

### Memory Verification in DevTools
```javascript
// Source: Chrome DevTools documentation
// Manual verification steps for success criteria:
// 1. Open Chrome DevTools → Performance Monitor
// 2. Watch "JS heap size" metric
// 3. Process same video 10 times consecutively
// 4. Heap size should stabilize after initial growth
// 5. Should not grow linearly with each iteration
//
// Or use Heap Snapshots:
// 1. Take heap snapshot before processing
// 2. Process video 10 times
// 3. Force garbage collection (trash icon in Memory panel)
// 4. Take second heap snapshot
// 5. Compare snapshots - should see minimal growth in blob/video objects
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual blob URL tracking | Centralized registry pattern | Emerging best practice (2024+) | Prevents missed revocations, enables lifecycle-aware cleanup |
| FFmpeg instance per video | Single persistent instance | FFmpeg.wasm 0.12+ architecture | Massive performance improvement, reduces load overhead |
| `ffmpeg.exit()` for cleanup | Filesystem cleanup only, instance reuse | 0.12.x due to exit() bugs | More reliable operation sequencing |
| Unbounded result storage | Bounded collections with LRU eviction | SPA best practices (2020+) | Prevents memory growth in long-running apps |
| page unload only cleanup | Lifecycle-aware cleanup at multiple points | Modern web app patterns | Better memory hygiene for SPAs |

**Deprecated/outdated:**
- **FFmpeg.wasm 0.11.x `exit()` for reuse**: 0.12.x architecture changed, exit() now buggy and unnecessary for sequential operations
- **WeakMap for blob URL tracking**: Never worked (blob URLs are strings/primitives, not objects)
- **Manual garbage collection triggers**: Never reliable cross-browser, removed from most browser APIs

## Open Questions

Things that couldn't be fully resolved:

1. **What is the optimal MAX_VIDEOS value?**
   - What we know: Should be based on typical video sizes and browser memory limits
   - What's unclear: Varies by user's browser/device - desktop can handle 50+, mobile should be more conservative (10-20)
   - Recommendation: Start with 20 as reasonable middle ground, make it configurable later if needed

2. **Should we implement automated memory testing?**
   - What we know: Tools like MemLab exist for automated leak detection
   - What's unclear: Whether complexity is justified for this phase vs manual DevTools verification
   - Recommendation: Manual DevTools verification for Phase 2, defer automated testing to future optimization phase if needed

3. **Should original video blob URLs be revoked immediately after processing?**
   - What we know: Original video is only shown in preview, not used after processing
   - What's unclear: Whether user might want to replay original after processing
   - Recommendation: Keep original video displayed until user processes another video, then revoke old original URL

4. **FFmpeg instance recovery: when to retry vs fail?**
   - What we know: Some errors (OOM) shouldn't retry, others (transient WASM issues) might succeed on retry
   - What's unclear: How to reliably distinguish retryable from non-retryable errors
   - Recommendation: Don't retry automatically in Phase 2; just ensure clean recovery. Retry logic can be added in later phase if user feedback indicates need.

## Sources

### Primary (HIGH confidence)
- [MDN - URL.createObjectURL()](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) - Blob URL management official documentation
- [MDN - JavaScript Memory Management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Memory_management) - Garbage collection and reference management
- [MDN - WeakMap](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap) - Weak reference patterns
- [Chrome DevTools - Memory Panel](https://developer.chrome.com/docs/devtools/memory) - Memory profiling official guide
- [Chrome DevTools - Performance Monitor](https://developer.chrome.com/docs/devtools/performance-monitor) - Real-time memory tracking
- [FFmpeg.wasm GitHub Issue #242](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/242) - exit() method bugs
- [FFmpeg.wasm GitHub Issue #330](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/330) - Instance reuse patterns
- [FFmpeg.wasm GitHub Issue #365](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/365) - RAM usage reduction techniques
- [FFmpeg.wasm GitHub Issue #494](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/494) - Memory leak reports

### Secondary (MEDIUM confidence)
- [Building a Browser-Based Video Editor with FFmpeg WASM](https://abhikhatri.com/blog/browser-video-editor-ffmpeg-wasm) - Real-world implementation patterns
- [JavaScript.info - WeakMap and WeakSet](https://javascript.info/weakmap-weakset) - Weak reference tutorial
- [DebugBear - Debugging JavaScript Memory Leaks](https://www.debugbear.com/blog/debugging-javascript-memory-leaks) - Practical debugging guide
- [DevTools Tips - Find memory leaks by comparing heap snapshots](https://devtoolstips.org/tips/en/find-memory-leaks/) - Heap snapshot workflow
- [MemLab - Facebook's Memory Leak Detection Framework](https://engineering.fb.com/2022/09/12/open-source/memlab/) - Automated testing approach

### Tertiary (LOW confidence)
- [Cobertos Blog - Automated Memory Leak Testing in Browser](https://cobertos.com/blog/post/automated-memory-leak-testing-in-the-browser) - Testing strategies (2020 publication, may be dated)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Browser native APIs, well-documented FFmpeg.wasm patterns
- Architecture: HIGH - Patterns verified in FFmpeg.wasm issues and MDN documentation
- Pitfalls: HIGH - Documented in official GitHub issues and MDN warnings

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable browser APIs and established library patterns)

**Notes:**
- Current codebase already implements FFmpeg filesystem cleanup correctly (app.js:509-514)
- Primary gaps: blob URL revocation and processedVideos array management
- FFmpeg instance is correctly maintained as singleton - no changes needed to instance lifecycle
- Manual DevTools verification is standard practice for memory testing in this domain
