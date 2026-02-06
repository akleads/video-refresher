# Codebase Concerns

**Analysis Date:** 2026-02-06

## Tech Debt

**Memory Management - URL Object Leaks:**
- Issue: `URL.createObjectURL()` creates blob URLs that are never revoked, causing memory accumulation with each video processed
- Files: `app.js` lines 275 (original), 439 (processed), and all stored processedURL references in `processedVideos` array
- Impact: Browser memory grows indefinitely as users process videos. Long session processing could exhaust available memory and crash the application, particularly on devices with limited RAM
- Fix approach: Call `URL.revokeObjectURL()` when:
  - Original video URL is replaced by a new file
  - Processed video is removed from history
  - Before clearing the `processedVideos` array
  - On session cleanup

**FFmpeg Instance Lifecycle:**
- Issue: FFmpeg is loaded globally (`let ffmpeg = null`) and loaded once with `ffmpegLoaded` flag, but never unloaded or reinitialized if corrupted
- Files: `app.js` lines 15-16, 18-57, 315-327
- Impact: If FFmpeg initialization partially fails, the `ffmpegLoaded` flag remains false but the instance may be in an inconsistent state. Subsequent processing attempts will fail silently with cryptic errors. No recovery mechanism exists
- Fix approach: Add error state tracking and implement FFmpeg reload on consecutive failures

**Global State Accumulation:**
- Issue: `processedVideos` array grows indefinitely with no clearing mechanism
- Files: `app.js` lines 77, 449-457
- Impact: Browser memory consumption increases with each processed video. Sessions processing 50+ videos could face memory pressure. No way to clear history without page reload
- Fix approach: Implement video history clearing with UI button or automatic cleanup of old entries

**File Size Validation Inconsistency:**
- Issue: File size warning shows 100MB limit in alert (lines 262-267), but comments reference 200MB in error messages (line 423) and README suggests 500MB
- Files: `app.js` lines 262-272, 295, 423; `README.md` line 64; `DEPLOYMENT.md` line 70
- Impact: Users receive conflicting guidance about actual file size limits. 100MB is the practical browser memory limit but documentation suggests 500MB is possible, setting false expectations
- Fix approach: Standardize on single realistic limit (100MB) across all messages and documentation

---

## Known Bugs

**Queue Processing Race Condition:**
- Symptoms: Simultaneous file additions during queue processing may cause files to be skipped or processed multiple times
- Files: `app.js` lines 172-196 (`processQueue()`), 159-168 (`handleMultipleFiles()`)
- Trigger: Rapidly drag-drop multiple file groups while first batch is processing
- Workaround: Wait for queue to complete before adding more files; observable via UI

**Processing Status Text Persistence:**
- Symptoms: Error messages from failed processing remain visible and don't clear when new files are processed
- Files: `app.js` lines 283-284, 300-303
- Trigger: Process video → fails with error → process next video. Error text remains while new processing occurs
- Workaround: Manually refresh page to clear status

**HTML Injection Risk via Filename:**
- Symptoms: Maliciously named files with HTML/script characters could be displayed unescaped in DOM
- Files: `app.js` lines 277 (originalName), 496 (processed video item name), 224 (queue list)
- Trigger: Upload file with name containing `<script>`, `<img onerror=`, or other HTML characters
- Workaround: Browser filename sanitization typically blocks this, but not guaranteed across all browsers

---

## Security Considerations

**XSS via innerHTML with File Metadata:**
- Risk: File names are directly interpolated into HTML strings and assigned via `innerHTML`
- Files: `app.js` lines 224 (queue), 496 (processed video list), 235 and 508 (innerHTML assignments)
- Current mitigation: Filenames come from File API (`file.name`), which should be sanitized by browser; however, no explicit escaping is performed
- Recommendations:
  - Use `textContent` instead of `innerHTML` for plain text content
  - If HTML needed, use `createElement()` and `appendChild()` instead of string interpolation
  - Add input validation: reject filenames with special characters

**CDN Dependency - Supply Chain Risk:**
- Risk: FFmpeg loaded from unpkg.com CDN without integrity checking
- Files: `app.js` lines 3, 40
- Current mitigation: Using pinned version (0.11.6), CDN is reputable
- Recommendations:
  - Add Subresource Integrity (SRI) hash to CDN imports if frontend supports it
  - Document that CDN outage makes application non-functional
  - Consider self-hosting FFmpeg.wasm if reliability is critical

**Global Function Exposure:**
- Risk: `downloadProcessedVideo()` exposed to global window scope for onclick handlers
- Files: `app.js` line 512, HTML inline onclick attributes
- Current mitigation: Function validates array index before access
- Recommendations:
  - Use event delegation on parent container instead of inline onclick
  - Keep functions in module scope; don't expose to global

---

## Performance Bottlenecks

**FFmpeg Memory Allocation - Browser Context:**
- Problem: FFmpeg.wasm runs in browser with shared memory constraints; no memory tuning available
- Files: `app.js` entire `processVideo()` function (lines 310-471)
- Cause: FFmpeg in browser cannot be optimized for memory like server-side FFmpeg. Each encoding operation allocates large intermediate buffers
- Improvement path:
  - Implement server-side processing for files > 50MB
  - Consider streaming/chunked processing (FFmpeg doesn't support this well)
  - Provide user guidance on reducing video resolution before processing

**Encoding Preset vs. Speed Tradeoff:**
- Problem: Using `veryfast` preset for large files (60-100MB) produces lower quality output
- Files: `app.js` lines 388-397
- Cause: Attempt to balance speed and memory; results in visible quality degradation
- Improvement path: Either accept longer processing times with better quality OR document quality expectations clearly in UI

**No Progress Feedback During FFmpeg Processing:**
- Problem: Progress bar updates stop at 20% and stays there during entire FFmpeg encoding
- Files: `app.js` lines 358-416 (FFmpeg runs without progress callback)
- Cause: FFmpeg progress callback data not being captured in wasm version
- Improvement path: Implement fake progress animation or real progress if FFmpeg API supports it in newer versions

**Synchronous File Operations on Main Thread:**
- Problem: `ffmpeg.FS('writeFile')` and `ffmpeg.FS('readFile')` are blocking operations
- Files: `app.js` lines 350 and 435
- Cause: FFmpeg.wasm FS operations must run on main thread; no async variant available
- Improvement path: Monitor browser performance; this is a limitation of FFmpeg.wasm, not code bug. Document user experience expectations (UI freezes during processing)

---

## Fragile Areas

**Error Message Text Matching:**
- Files: `app.js` lines 294-298, 422-428
- Why fragile: Error detection relies on error message strings (`.includes('OOM')`, `.includes('abort')`)
- Error messages from FFmpeg may vary by version, browser, or environment
- Safe modification: Add try-catch blocks with specific error types if available; log full error for debugging
- Test coverage: No automated tests for error handling paths
- Safe testing approach: Test with actual large files and corrupted files to verify messages display correctly

**DOM Element Presence Assumptions:**
- Files: `app.js` multiple getElementById() calls without consistent null-checks in all code paths
- Why fragile: If HTML structure changes (element IDs removed), code silently fails with undefined reference errors
- Example: `document.getElementById('processingStatus')` called in lines 311, 329, etc. If removed from HTML, errors thrown but not caught at call site
- Safe modification: Before any DOM access, establish consistent null-check pattern; log warnings if elements missing
- Test coverage: No checks for missing DOM elements in some functions

**Global State Dependencies:**
- Files: `app.js` lines 15-77 (global `ffmpeg`, `ffmpegLoaded`, `processingQueue`, `isProcessing`, `processedVideos`)
- Why fragile: Complex state machine with multiple booleans; can enter inconsistent states if async operations fail
- Example: `isProcessing` set to true but never reset if async error occurs in processQueue()
- Safe modification: Use state machine pattern or single state object instead of multiple booleans
- Test coverage: No test cases for concurrent upload attempts or rapid queue changes

**Hardcoded Filename Patterns:**
- Files: `app.js` lines 341-342 (input/output filenames)
- Why fragile: `inputFileName = 'input.mp4'` is reused for all files; potential collision if processing same file twice quickly
- Already have uniqueID for output, but input overwrites each time
- Safe modification: Include uniqueID in input filename too or use timestamps
- Test coverage: Not tested with rapid sequential processing

---

## Scaling Limits

**Browser Memory - Hard Limit:**
- Current capacity: ~100-200MB file processing (varies by device)
- Limit: Files > 200MB consistently fail with out-of-memory errors; many devices fail at 100MB
- Scaling path:
  - Implement hybrid architecture: browser for < 50MB, server for larger files
  - Add file compression preprocessing
  - Implement streaming FFmpeg processing (not currently available in wasm)

**Session State - No Persistence:**
- Current capacity: Users can process ~50-100 videos per session before memory pressure
- Limit: `processedVideos` array grows indefinitely; no database/localStorage saves history
- Scaling path:
  - Add video history export/download before clearing
  - Implement localStorage for modest persistence across sessions
  - Add "Clear history" button for memory management

**Concurrent User Load:**
- Current capacity: Unlimited concurrent users (Cloudflare Pages is CDN-based)
- Limit: Each user fully consumes their own device resources; no server throttling
- Scaling path: This is acceptable for current architecture; if moving to server processing, monitor server resource allocation

**CDN Dependency - Single Point of Failure:**
- Current capacity: FFmpeg loads from unpkg.com CDN on every first load
- Limit: CDN outage makes application completely non-functional
- Scaling path: Cache FFmpeg.wasm locally (IndexedDB or service worker); requires 20-50MB local storage

---

## Dependencies at Risk

**FFmpeg.wasm Version 0.11.6 - Outdated:**
- Risk: Using 4-year-old version (released ~2021); no longer maintained
- Files: `app.js` line 3, line 40 (corePath URL)
- Impact: Security vulnerabilities in FFmpeg C bindings; no WebAssembly bindings updates; known memory leaks in older versions
- Migration plan: Upgrade to latest `@ffmpeg/ffmpeg` version (currently 0.12.x+)
  - Requires testing for API changes
  - Newer versions have better memory management
  - May require `_headers` file updates for CORS if upgrading

**unpkg.com CDN - No SRI or Fallback:**
- Risk: No subresource integrity hash; no fallback CDN if primary fails
- Files: `app.js` lines 3, 40
- Impact: Man-in-the-middle attack surface; service disruption if unpkg.com is down
- Migration plan:
  - Add SRI hash: download core file, compute hash, add integrity attribute if using fetch
  - Or self-host FFmpeg.wasm files alongside application
  - Or use jsDelivr CDN as fallback with URL switching logic

**Python 3 server.py - No Long-Term Support:**
- Risk: Simple HTTP server for development only; using for production is unsupported
- Files: `server.py`
- Impact: If deployed to production environment, lacks security, monitoring, rate limiting
- Migration plan:
  - Application is static, should be deployed to Cloudflare Pages (documented)
  - If used locally, document as dev-only and add deprecation warning
  - For production: use documented Cloudflare Pages deployment only

---

## Missing Critical Features

**No Video Processing Cancellation:**
- Problem: Once FFmpeg starts processing, no way to stop it; must wait or hard-refresh page
- Blocks: Users cannot abort long/stuck processing; long videos are problematic
- Impact: Poor UX for mistaken uploads of large files; no graceful shutdown

**No Processing Timeout:**
- Problem: Very large files or corrupted videos can cause FFmpeg to hang indefinitely
- Blocks: Users stuck with frozen UI; no recovery without page refresh
- Impact: Support burden; frustrated users

**No Offline Capability:**
- Problem: Requires CDN load of FFmpeg on first use; application won't work offline
- Blocks: Use cases where internet is unavailable or unreliable
- Impact: Limited to always-connected scenarios

**No Export/Save Processing History:**
- Problem: Processed video history (`processedVideos`) lost on page refresh or browser close
- Blocks: Users cannot see or re-download videos processed in previous sessions
- Impact: Videos must be manually downloaded during same session

**No Video Quality Settings UI:**
- Problem: Encoding preset (bitrate, CRF) chosen automatically based on file size
- Blocks: Users cannot trade quality vs. speed; no control over output
- Impact: Quality may not meet user expectations (especially for veryfast preset on large files)

---

## Test Coverage Gaps

**No Automated Tests:**
- Untested area: All JavaScript functionality
- Files: `app.js` (entire 523 lines)
- Risk: Regressions go undetected; refactoring is risky; complex async logic not validated
- Priority: High - Critical functionality lacks test coverage

**No FFmpeg Integration Tests:**
- Untested area: FFmpeg loading, encoding process, file I/O
- Files: `app.js` lines 18-57 (loadFFmpeg), 310-471 (processVideo)
- Risk: FFmpeg failures and memory issues not caught until user reports; version upgrades could break silently
- Priority: High - Core feature not tested

**No Error Scenario Testing:**
- Untested area: Out of memory, corrupted files, missing DOM elements, CDN failures
- Files: `app.js` error handlers lines 49-56, 294-298, 417-429
- Risk: Error messages untested; error paths may throw unhandled exceptions
- Priority: Medium - Error handling is implemented but unvalidated

**No UI Flow Testing:**
- Untested area: Multi-file queue processing, drag-drop, state transitions
- Files: `app.js` lines 145-196 (queue management), event handlers
- Risk: Race conditions in queue processing not caught; drag-drop may fail silently
- Priority: Medium - Complex stateful flows need validation

**No Browser Compatibility Testing:**
- Untested area: Cross-browser behavior for FFmpeg, SharedArrayBuffer, ES modules
- Files: `app.js` (entire file), `index.html`
- Risk: Features work in Chrome but fail in Firefox/Safari/Edge; wasm or SharedArrayBuffer not available on old browsers
- Priority: Low-Medium - Documented requirements but no verification

---

*Concerns audit: 2026-02-06*
