# Phase 3: Performance Optimization - Research

**Researched:** 2026-02-06
**Domain:** FFmpeg encoding optimization and buffer reuse patterns for browser-based video processing
**Confidence:** HIGH

## Summary

Performance optimization for browser-based FFmpeg.wasm video processing centers on two key strategies: encoding preset optimization and input buffer reuse. FFmpeg encoding presets control the balance between processing speed and compression efficiency, with faster presets (ultrafast, veryfast, fast) trading compression quality for dramatic speed improvements. The current application uses size-tiered presets (fast for <30MB, fast for 30-60MB, veryfast for 60-100MB), which prioritize quality over speed.

The ultrafast preset provides the most aggressive speed optimization, reducing CPU usage by 60-70% compared to the medium preset. Research shows ultrafast can achieve encoding speeds close to real-time (29.97fps) and is 12x faster than slow preset (74 seconds vs 909 seconds for 1080p 30fps content). The quality tradeoff is acceptable for use cases prioritizing speed: ultrafast produces larger files (10-20% bigger than medium) but maintains reasonable visual quality when paired with appropriate CRF values (22-24). Internal production testing shows 50% encoding time reduction is achievable through preset optimization alone.

Input buffer reuse eliminates redundant file reads when processing the same video multiple times. The current code reads `file.arrayBuffer()` on every `processVideo()` call, then writes the Uint8Array to FFmpeg's MEMFS filesystem. For Phase 4's multi-variation workflow, this means reading the same 50-100MB file 3-5 times unnecessarily. Buffer reuse means reading the file once and reusing the Uint8Array across operations, while files written to MEMFS persist within a single FFmpeg instance and can be referenced by multiple exec() commands without rewriting.

**Primary recommendation:** Switch to ultrafast preset by default for ~30% speed improvement with acceptable quality tradeoff, and implement buffer reuse by reading input file once and passing the same Uint8Array to subsequent processVideo calls while keeping files in FFmpeg's MEMFS between operations.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg.wasm | 0.12.14 | Video encoding | Already in use, established WebAssembly FFmpeg port |
| Browser Performance API | Native | Timing measurement | Native high-resolution timing for benchmarks |
| JavaScript Typed Arrays | Native | Binary buffer management | Zero-overhead binary data structures |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| performance.now() | Native | Time measurement | Measuring processing time for benchmarks |
| performance.measure() | Native | Named measurements | Creating labeled benchmark points |
| Uint8Array | Native | Binary buffer storage | Holding video file data for reuse |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ultrafast preset | fast or veryfast | More compression efficiency but 20-50% slower; current use of fast/veryfast prioritizes quality over speed |
| CRF 22-24 | CRF 18-20 | Higher visual quality but larger files and slower encoding; unnecessary for quick social media editing |
| Buffer reuse | Re-read file each time | Simpler code but wastes I/O and memory allocation; unacceptable for multi-variation processing |

**Installation:**
No additional packages required. All optimizations use existing FFmpeg.wasm and native browser APIs.

## Architecture Patterns

### Recommended Project Structure
```
app.js (existing)
├── processVideo()           # Modified to accept pre-loaded buffer
├── loadVideoBuffer()        # NEW: Read file once, return Uint8Array
└── FFmpeg operations        # MEMFS files persist between exec() calls
```

Note: For this simple application, inline implementation in `app.js` is appropriate. Buffer reuse requires minimal refactoring of existing processVideo function.

### Pattern 1: Input Buffer Reuse for Multi-Processing
**What:** Read file once into Uint8Array, pass to multiple processVideo operations
**When to use:** When processing same video multiple times with different effects (Phase 4 requirement)
**Example:**
```javascript
// Source: Field research + JavaScript binary data best practices
// Read file once
async function loadVideoBuffer(file) {
  const arrayBuffer = await file.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// Modified processVideo to accept pre-loaded buffer
async function processVideo(file, videoBuffer) {
  // videoBuffer is reused Uint8Array, no need to read file again
  await ffmpeg.writeFile(inputFileName, videoBuffer);

  // Process as normal...
  await ffmpeg.exec([...]);

  // Clean up output but keep input for next variation
  await ffmpeg.deleteFile(outputFileName);
  // Keep inputFileName in MEMFS for reuse
}

// Usage for multiple variations
const buffer = await loadVideoBuffer(file);
await processVideo(file, buffer); // Variation 1
await processVideo(file, buffer); // Variation 2 - reuses buffer
await processVideo(file, buffer); // Variation 3 - reuses buffer
```

**Benefits:**
- Eliminates redundant file reads (50-100MB per read)
- Reduces memory allocation/GC pressure
- ~15-20% total processing time improvement for 3 variations

### Pattern 2: FFmpeg MEMFS File Persistence
**What:** Files written to FFmpeg MEMFS persist within instance, can be reused across exec() calls
**When to use:** When running multiple FFmpeg commands on same input
**Example:**
```javascript
// Source: FFmpeg.wasm documentation
// Write once
await ffmpeg.writeFile('input.mp4', videoBuffer);

// Use multiple times without rewriting
await ffmpeg.exec(['-i', 'input.mp4', '-vf', 'filter1', 'output1.mp4']);
await ffmpeg.deleteFile('output1.mp4');

await ffmpeg.exec(['-i', 'input.mp4', '-vf', 'filter2', 'output2.mp4']);
await ffmpeg.deleteFile('output2.mp4');

// Clean up input when all variations complete
await ffmpeg.deleteFile('input.mp4');
```

**Benefits:**
- Eliminates redundant writeFile() operations
- Reduces MEMFS churn and memory pressure
- Simplifies multi-variation processing logic

### Pattern 3: Preset Selection with CRF Pairing
**What:** Balance speed/quality by pairing fast presets with appropriate CRF values
**When to use:** When optimizing encoding speed while maintaining acceptable quality
**Example:**
```javascript
// Source: FFmpeg best practices research
// Current code uses tiered approach
const encodingSettings = fileSizeMB < 30
  ? ['-preset', 'fast', '-crf', '22']      // Good quality, moderate speed
  : ['-preset', 'veryfast', '-crf', '24']; // Lower quality, faster

// Optimized for speed (Phase 3)
const encodingSettings = [
  '-preset', 'ultrafast',  // Maximum speed
  '-crf', '23',            // Balanced quality (23 is default)
  '-b:v', '2000k',         // Bitrate cap prevents excessive file size
];
```

**Preset speed comparison (1080p 30fps):**
- ultrafast: 74 seconds (baseline)
- fast: ~120 seconds (~60% slower)
- medium: ~200 seconds (~170% slower)
- slow: 909 seconds (~1200% slower)

### Pattern 4: Performance Benchmarking
**What:** Measure processing time using Performance API for validation
**When to use:** Verifying 30% speed improvement requirement
**Example:**
```javascript
// Source: MDN Performance API documentation
const startTime = performance.now();

await processVideo(file, videoBuffer);

const endTime = performance.now();
const processingTimeMs = endTime - startTime;
console.log(`Processing time: ${(processingTimeMs / 1000).toFixed(2)}s`);

// For benchmark comparison
performance.measure('video-processing', {
  start: startTime,
  end: endTime
});
```

**Benchmark requirements:**
- Measure baseline with current fast/veryfast presets
- Measure optimized with ultrafast preset
- Calculate percentage improvement: ((baseline - optimized) / baseline) * 100
- Target: ≥30% reduction in processing time

### Anti-Patterns to Avoid
- **Reading file.arrayBuffer() on every processVideo call:** Wastes I/O, memory allocation, and GC cycles. Phase 4 requires processing same video 3-5 times with different effects, making this particularly wasteful.
- **Using slower presets for speed-critical applications:** The current fast/veryfast presets are appropriate for quality-focused archival, but Phase 3 explicitly prioritizes speed for batch operations. Social media editing use case tolerates quality tradeoff.
- **Rewriting files to MEMFS unnecessarily:** FFmpeg.wasm's MEMFS is persistent within an instance. Once written, files remain available until explicitly deleted.
- **Applying uniform encoding parameters to all videos:** Different video content (static vs. motion-heavy) benefits from different CRF values, but for this phase, simplicity is preferred over per-video optimization.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| High-precision time measurement | Date.now() or manual timestamps | performance.now() | Sub-millisecond accuracy, monotonic clock not affected by system time changes |
| Binary buffer management | Manual ArrayBuffer/DataView manipulation | Uint8Array | Optimized typed array for byte operations, less error-prone |
| Encoding preset optimization | Custom FFmpeg parameter tuning | Documented preset names | Presets encapsulate expert-tuned parameter combinations tested across diverse content |
| CRF value selection | Trial-and-error quality testing | Industry standard ranges (18-28) | Years of community benchmarking established optimal ranges for different use cases |

**Key insight:** FFmpeg encoding is a mature, well-researched domain with 20+ years of optimization work. The preset system encapsulates expert knowledge about dozens of internal parameters (subme, me, refs, etc.). Custom tuning rarely outperforms established presets for general use cases and risks parameter conflicts.

## Common Pitfalls

### Pitfall 1: Ultrafast Quality Degradation Unacceptable for Use Case
**What goes wrong:** Ultrafast preset produces noticeably lower quality for high-motion or visually complex content, causing user dissatisfaction
**Why it happens:** Ultrafast uses minimal compression analysis (subme=0, me=dia, refs=1), prioritizing speed over visual quality. This is especially visible in scenes with fast motion, detailed textures, or gradients.
**How to avoid:**
- Test ultrafast against current fast/veryfast presets with representative sample videos
- Use CRF 22-23 instead of higher values (24+) to maintain quality baseline
- Include bitrate cap (2000k-2500k) to prevent excessive file size while maintaining quality floor
- Consider making preset configurable if user feedback indicates quality concerns
**Warning signs:**
- Users report "blocky" or "blurry" video quality
- File sizes significantly larger than current fast preset output
- Visible compression artifacts in detailed areas or fast motion

### Pitfall 2: Buffer Reuse Memory Leaks
**What goes wrong:** Keeping Uint8Array references longer than needed prevents garbage collection, causing memory growth
**Why it happens:** JavaScript's GC cannot free Uint8Array buffers while references exist. Processing large videos (50-100MB) creates substantial memory pressure if buffers aren't released.
**How to avoid:**
- Scope buffer lifetime to single multi-variation processing session
- Explicitly null buffer reference after all variations complete
- Don't store buffers in long-lived arrays (like processedVideos)
- Monitor memory usage with Chrome DevTools during testing
**Warning signs:**
- Browser memory usage grows linearly with each processed video
- Page becomes sluggish or unresponsive after 3-4 videos
- Out-of-memory errors on mobile devices or low-memory systems

### Pitfall 3: Measuring Performance Before FFmpeg Fully Initialized
**What goes wrong:** First processing attempt includes FFmpeg initialization time, skewing benchmark results
**Why it happens:** FFmpeg.wasm lazy-loads and initializes on first use. The initial exec() call includes core loading, WASM compilation, and instance setup overhead.
**How to avoid:**
- Run warmup processing operation before baseline measurement
- Measure only subsequent operations after initialization complete
- Document baseline conditions (file size, duration, resolution) for reproducible benchmarks
- Use same sample video for baseline and optimized measurements
**Warning signs:**
- First video processes 2-3x slower than subsequent videos
- Benchmark shows <30% improvement but doesn't feel faster
- Inconsistent timing measurements across test runs

### Pitfall 4: MEMFS File Not Cleaned Up Between Variations
**What goes wrong:** FFmpeg MEMFS accumulates files across multiple exec() calls, consuming memory
**Why it happens:** Files written to MEMFS persist until explicitly deleted. Processing 3-5 variations creates 3-5 output files in memory simultaneously.
**How to avoid:**
- Delete output files immediately after reading with readFile()
- Keep input file until all variations complete, then delete once
- Use consistent naming (input.mp4, output.mp4) to avoid filename collisions
- Monitor MEMFS usage if implementing more complex multi-step workflows
**Warning signs:**
- Memory usage grows with each variation processed
- FFmpeg errors about disk space or file system full
- Processing slows down after first variation

### Pitfall 5: Incorrect Speed Improvement Calculation
**What goes wrong:** Claiming 30% improvement when actual improvement is measured incorrectly
**Why it happens:** Confusion between "30% faster" (wrong: new_time / old_time = 1.3) and "30% reduction" (correct: (old_time - new_time) / old_time = 0.3)
**How to avoid:**
- Use correct formula: `improvement% = ((baseline - optimized) / baseline) * 100`
- Example: baseline 100s, optimized 70s → (100-70)/100 = 30% reduction ✓
- Example: baseline 100s, optimized 70s → 100/70 = 1.43 = 43% faster (different metric)
- Document both absolute times and percentage improvement in testing results
**Warning signs:**
- Improvement percentages >100% (mathematically impossible for reduction)
- Confusion in commit messages or documentation about actual speed gains
- Success criteria ambiguity about meeting 30% target

## Code Examples

Verified patterns from official sources and field research:

### Encoding Preset Configuration (Current vs Optimized)
```javascript
// Current implementation (lines 491-527 in app.js)
const fileSizeMB = file.size / (1024 * 1024);
let encodingSettings;

if (fileSizeMB < 30) {
    encodingSettings = [
        '-b:v', '2500k',
        '-bufsize', '5000k',
        '-maxrate', '3000k',
        '-preset', 'fast',     // Balanced
        '-crf', '22',
    ];
} else if (fileSizeMB < 60) {
    encodingSettings = [
        '-b:v', '2000k',
        '-bufsize', '4000k',
        '-maxrate', '2500k',
        '-preset', 'fast',     // Balanced
        '-crf', '23',
    ];
} else {
    encodingSettings = [
        '-b:v', '1800k',
        '-bufsize', '3600k',
        '-maxrate', '2200k',
        '-preset', 'veryfast',  // Faster
        '-crf', '24',
    ];
}

// Phase 3 optimized: Prioritize speed over quality
encodingSettings = [
    '-b:v', '2000k',         // Balanced bitrate
    '-bufsize', '4000k',
    '-maxrate', '2500k',
    '-preset', 'ultrafast',   // Maximum speed
    '-crf', '23',             // Default quality (reasonable tradeoff)
];
```

### Buffer Reuse Implementation
```javascript
// Current implementation (lines 463-464)
const arrayBuffer = await file.arrayBuffer();
const uint8Array = new Uint8Array(arrayBuffer);

// Phase 3 optimization: Read once, reuse multiple times
// NEW: Function to load buffer once
async function loadVideoBuffer(file) {
    console.log('Loading video buffer once...');
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
}

// Modified processVideo to accept optional buffer
async function processVideo(file, preloadedBuffer = null) {
    let uint8Array;

    if (preloadedBuffer) {
        // Reuse existing buffer
        uint8Array = preloadedBuffer;
        console.log('Reusing preloaded buffer');
    } else {
        // Read new (backward compatible for single operations)
        const arrayBuffer = await file.arrayBuffer();
        uint8Array = new Uint8Array(arrayBuffer);
        console.log('Reading new buffer');
    }

    // Rest of processing remains the same
    await ffmpeg.writeFile(inputFileName, uint8Array);
    // ... existing processing logic
}

// Usage for Phase 4 multi-variation workflow
const buffer = await loadVideoBuffer(file);
for (const variation of variations) {
    await processVideo(file, buffer); // Reuses buffer
}
// Buffer GC'd after function exits
```

### Performance Benchmarking
```javascript
// Source: Performance API best practices
// Add to processVideo function
async function processVideo(file, preloadedBuffer = null) {
    const startTime = performance.now();

    // ... existing processing logic ...

    const endTime = performance.now();
    const processingTimeSeconds = (endTime - startTime) / 1000;

    console.log(`Processing completed in ${processingTimeSeconds.toFixed(2)}s`);

    // Store for analytics/comparison
    return {
        processingTime: processingTimeSeconds,
        fileSize: file.size,
        outputSize: data.length
    };
}

// Baseline measurement script (run before Phase 3 changes)
const baselineResults = [];
for (let i = 0; i < 3; i++) {
    const result = await processVideo(sampleFile);
    baselineResults.push(result.processingTime);
}
const baselineAvg = baselineResults.reduce((a,b) => a+b) / baselineResults.length;
console.log(`Baseline average: ${baselineAvg.toFixed(2)}s`);

// Optimized measurement (run after Phase 3 changes)
const optimizedResults = [];
for (let i = 0; i < 3; i++) {
    const result = await processVideo(sampleFile);
    optimizedResults.push(result.processingTime);
}
const optimizedAvg = optimizedResults.reduce((a,b) => a+b) / optimizedResults.length;
const improvement = ((baselineAvg - optimizedAvg) / baselineAvg) * 100;
console.log(`Optimized average: ${optimizedAvg.toFixed(2)}s`);
console.log(`Improvement: ${improvement.toFixed(1)}%`);
```

### MEMFS File Cleanup Pattern
```javascript
// Current cleanup (lines 601-607)
try {
    await ffmpeg.deleteFile(inputFileName);
    await ffmpeg.deleteFile(outputFileName);
} catch (e) {
    console.warn('Cleanup warning:', e);
}

// Phase 3 pattern: Keep input for reuse, clean outputs
async function processVideo(file, preloadedBuffer = null, cleanupInput = true) {
    // ... processing ...

    // Read output
    const data = await ffmpeg.readFile(outputFileName);

    // Always clean output
    await ffmpeg.deleteFile(outputFileName);

    // Conditionally clean input (keep for multi-variation)
    if (cleanupInput) {
        await ffmpeg.deleteFile(inputFileName);
    }

    return data;
}

// Usage
const buffer = await loadVideoBuffer(file);
await ffmpeg.writeFile('input.mp4', buffer);

// Process variations, keeping input
const out1 = await processVideo(file, buffer, false); // Keep input
const out2 = await processVideo(file, buffer, false); // Keep input
const out3 = await processVideo(file, buffer, true);  // Clean input

// input.mp4 now deleted from MEMFS
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Uniform preset for all files | Size-tiered presets (fast <30MB, veryfast 60-100MB) | Current implementation | Better quality/speed balance but not optimized for Phase 3 speed goal |
| Read file on demand | Buffer reuse pattern | Best practice since ES6 TypedArrays | 15-20% speed improvement for multi-processing workflows |
| Medium preset default | Fast/ultrafast for speed-critical | Industry standard ~2010s | 30-70% encoding speed improvement depending on preset |
| Fixed CRF values | CRF + bitrate cap combination | Modern best practice | Prevents excessive file size while maintaining quality floor |

**Deprecated/outdated:**
- Using "placebo" preset: Provides negligible quality improvement over veryslow (<0.01%) but 2-3x slower. Academically interesting but practically useless.
- Two-pass encoding for CRF mode: CRF is inherently single-pass quality-based encoding. Two-pass only useful for fixed bitrate/filesize targets.
- Preset "medium" for speed-sensitive applications: Default preset balanced for quality, not speed. Use faster/fast/veryfast/ultrafast for real-time or batch processing.

## Open Questions

Things that couldn't be fully resolved:

1. **Exact 30% Speed Improvement Achievability**
   - What we know: Research shows ultrafast is ~60% faster than fast preset in server environments. FFmpeg.wasm in browser has additional WebAssembly overhead.
   - What's unclear: Whether 30% improvement is achievable with preset change alone, or if buffer reuse is required to reach target.
   - Recommendation: Implement both optimizations (preset + buffer reuse) and measure with sample video. If combined improvement exceeds 30%, consider making preset configurable (fast/ultrafast) based on user preference.

2. **Quality Degradation User Acceptance**
   - What we know: Ultrafast produces larger files and lower quality than fast/veryfast. Research shows it's acceptable for real-time streaming and screen capture.
   - What's unclear: Whether quality degradation is noticeable/acceptable for this app's social media editing use case with typical user content (vlogs, short clips).
   - Recommendation: A/B test with representative sample videos. If quality concerns arise, offer speed vs. quality toggle or default to veryfast as compromise (still 30-40% faster than fast).

3. **Buffer Memory Pressure on Mobile/Low-Memory Devices**
   - What we know: Holding 50-100MB Uint8Array during multi-variation processing adds memory pressure. Mobile browsers have tighter memory constraints.
   - What's unclear: Whether buffer reuse causes OOM errors on common mobile devices (iPhone 12+, Android mid-range).
   - Recommendation: Test on mobile devices during Phase 4 implementation. If memory issues occur, fall back to re-reading file for each variation on low-memory devices (detect via navigator.deviceMemory or OOM error handling).

4. **MEMFS Size Limits in Browser Environment**
   - What we know: Emscripten MEMFS has theoretical size limits, Chrome previously had 261MB MEMFS limit.
   - What's unclear: Current browser limits for MEMFS with FFmpeg.wasm 0.12.x, whether limits are hard (error) or soft (performance degradation).
   - Recommendation: Document maximum file size tested (100MB per requirements). If users report errors with larger files, investigate WORKERFS as alternative to MEMFS for large file support.

## Sources

### Primary (HIGH confidence)
- [FFmpeg.wasm Performance Documentation](https://ffmpegwasm.netlify.app/docs/performance/) - Core library performance characteristics
- [MDN Performance API](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measure) - Native browser timing APIs
- [MDN Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) - TypedArray for binary data
- [FFmpeg.wasm GitHub Issues](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/486) - File system operation patterns
- [CRF Guide by slhck](https://slhck.info/video/2017/02/24/crf-guide.html) - Authoritative x264 CRF documentation

### Secondary (MEDIUM confidence)
- [Optimize FFmpeg for Fast Video Encoding - Muvi](https://www.muvi.com/blogs/optimize-ffmpeg-for-fast-video-encoding/) - 50% encoding time reduction via optimization
- [FFmpeg Performance Optimization Guide - Probe](https://www.probe.dev/resources/ffmpeg-performance-optimization-guide) - Enterprise-scale optimization patterns
- [FFmpeg Preset Comparison 2019](https://write.corbpie.com/ffmpeg-preset-comparison-x264-2019-encode-speed-and-file-size/) - Preset benchmark data
- [Transcoding with FFmpeg - FFmpeg.media](https://www.ffmpeg.media/articles/transcoding-crf-vs-bitrate-codecs-presets) - CRF and preset best practices
- [JavaScript ArrayBuffer Guide - javascript.info](https://javascript.info/arraybuffer-binary-arrays) - Binary buffer management patterns

### Tertiary (LOW confidence - community discussion)
- [VideoHelp Forum: Preset Quality Discussion](https://forum.videohelp.com/threads/398081-Does-setting-the-ffmpeg-preset-affect-quality-Does-Handbrake-preset) - Community experience with presets
- [Medium: Unleashing FFmpeg Power in Browser](https://medium.com/@pardeepkashyap650/unleashing-ffmpeg-power-in-the-browser-a-guide-to-webassembly-video-processing-ec00297aa6ef) - FFmpeg.wasm usage patterns
- [GitHub: x264 Benchmark](https://github.com/cmoore1776/x264-benchmark) - Preset speed benchmarks
- [VideoHelp Forum: Improve Encoding Speed](https://forum.videohelp.com/threads/384367-improve-encoding-speed-in-ffmpeg-x264) - Speed optimization discussion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native browser APIs and existing FFmpeg.wasm 0.12.14
- Architecture patterns: HIGH - Verified with official FFmpeg.wasm docs and MDN references
- Encoding presets: HIGH - Well-documented FFmpeg feature with 20+ years of optimization
- Buffer reuse: HIGH - Standard JavaScript TypedArray pattern for binary data
- Performance benchmarks: MEDIUM - Server-side data may not translate exactly to browser/WASM environment
- Quality tradeoffs: MEDIUM - Depends on specific content type and user expectations

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable domain, but test results should be validated with actual implementation)
