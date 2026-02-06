# Project Research Summary

**Project:** Video Creative Variation Tool - Batch Processing Milestone
**Domain:** Browser-based video processing with FFmpeg.wasm
**Researched:** 2026-02-06
**Confidence:** MEDIUM

## Executive Summary

This project adds batch variation generation capability to an existing video refresher tool. The core challenge is processing 5-20 video variations from a single upload entirely in the browser, creating unique random effect combinations for each variation, and delivering them as a downloadable ZIP file. The recommended approach keeps the existing single FFmpeg.wasm instance architecture with an enhanced sequential queue, avoiding parallel Web Worker patterns that would exceed browser memory limits.

The critical constraint is browser memory (100-200MB budget). Success depends on aggressive memory management: reading the input file once and reusing the buffer across all variations, revoking blob URLs immediately after use, cleaning up FFmpeg's in-memory filesystem between operations, and using streaming ZIP creation. The existing FFmpeg.wasm 0.11.6 version should be upgraded to 0.12.x for multi-threading support, but this requires setting COOP/COEP headers on Cloudflare Pages and must be treated as an isolated upgrade phase.

Key risk: Memory leaks during batch processing will cause browser crashes. The existing codebase already has known memory leak issues (unreleased blob URLs, accumulated processed videos array). These MUST be fixed before scaling to batch operations. The recommended approach is defensive: validate memory budget before processing, implement centralized blob URL management, add explicit FFmpeg filesystem cleanup, and provide clear cancellation with cleanup hooks.

## Key Findings

### Recommended Stack

FFmpeg.wasm should be upgraded from 0.11.6 to 0.12.x for multi-threading support (2-3x performance improvement per video), but this requires architectural changes. JSZip 3.10.x+ is the standard choice for creating browser-based ZIP downloads. Web Workers should NOT be used for parallel FFmpeg instances (memory constraints make this impractical), but a single worker for UI responsiveness could be considered post-MVP.

**Core technologies:**
- **FFmpeg.wasm 0.12.x** (upgrade from 0.11.6): Multi-threading support via SharedArrayBuffer, better memory management for batch processing
- **JSZip 3.10.x+**: ZIP creation in browser with streaming support to reduce memory pressure
- **Native Web Workers API**: Queue management on main thread, potentially move FFmpeg to worker for UI responsiveness (optional)
- **file-saver 2.0.x**: Simplified download triggering with cross-browser compatibility

**Critical requirements:**
- COOP/COEP headers must be set on Cloudflare Pages for SharedArrayBuffer (required by FFmpeg.wasm 0.12.x)
- Worker pool pattern is NOT recommended (memory constraints)
- No compression for video files in ZIP (MP4 is already compressed, DEFLATE wastes time)

### Expected Features

The MVP focuses on core batch functionality with strict memory management. Users expect control over variation count, unique effects per variation, progress indication, and bulk ZIP download. Advanced features like effect intensity control and metadata export can be deferred.

**Must have (table stakes):**
- Specify variation count (5-20 range with validation)
- Unique effect combinations per variation (no duplicates within batch)
- Progress indication per variation ("Processing variation 3/10...")
- Bulk download as ZIP (using JSZip)
- Cancel batch operation (stop flag checked between variations)
- Consistent naming scheme (originalname_var1_abc123.mp4)
- Memory cleanup between variations (critical for stability)
- Preview first variation (quality check before download)

**Should have (competitive):**
- Effect intensity control (subtle vs dramatic variations)
- Export metadata file (JSON manifest of effects applied per variation)
- Smart effect distribution (ensure batch covers all effect types)

**Defer (v2+):**
- Preview all variations before download (memory-intensive)
- Guaranteed minimum difference (perceptual hashing, complex)
- Resume failed batch (requires IndexedDB persistence)
- Parallel processing (memory constraints make this impractical)

**Explicitly reject:**
- Manual effect selection per variation (decision fatigue)
- Server-side processing (constraint: must stay client-side)
- Individual variation downloads (batch = bulk operation)
- Variation comparison UI (memory nightmare with 20 videos)
- Persistent history (session-based is sufficient)

### Architecture Approach

The architecture extends the existing sequential queue system rather than introducing parallel processing. Input file is read once into an ArrayBuffer and reused across all N variations. Each variation processes sequentially through the single FFmpeg.wasm instance, with explicit cleanup after each operation. A centralized Memory Manager tracks all blob URLs and provides cleanup hooks. ZIP creation happens after all variations complete, with streaming to reduce peak memory usage.

**Major components:**
1. **Variation Generation Controller** — Orchestrates N-variation batch from single input, manages shared ArrayBuffer, coordinates queue and memory cleanup
2. **Enhanced FFmpeg Processing Queue** — Extends existing queue to accept pre-read ArrayBuffer instead of File, adds inter-variation cleanup, tracks batch progress
3. **Random Effect Generator** — Pure utility that generates unique FFmpeg command variations with seeded randomness for reproducibility
4. **Memory Manager** — Cross-cutting component that tracks blob URLs, provides centralized revocation, monitors memory budget
5. **ZIP Download Manager** — Aggregates N variations into single ZIP using JSZip with streaming, triggers download, handles cleanup
6. **Batch Progress Aggregator** — Combines per-variation progress into overall batch progress, provides ETA estimates

**Key architectural decisions:**
- **Single FFmpeg instance, NOT parallel workers:** Memory constraints (each instance = 20-50MB + video buffers) make parallel processing impractical
- **Shared input buffer:** Read file.arrayBuffer() once, pass reference to all variations (eliminates N×file_size memory waste)
- **Aggressive cleanup:** Revoke blob URLs immediately after ZIP creation, delete FFmpeg files between variations, clear batch state after download
- **Sequential processing with delays:** 100ms delay between variations allows UI updates and GC opportunities

### Critical Pitfalls

The research identified 13 pitfalls across three severity levels. The five critical pitfalls all relate to memory management and must be addressed in Phase 1 before implementing batch features.

1. **Memory exhaustion from unrevoked blob URLs** — Each video creates a blob URL that holds entire file in memory until explicitly revoked. With 20 variations, this causes browser crashes. Prevention: Centralized BlobURLManager with explicit lifecycle management.

2. **FFmpeg.wasm file system accumulation** — FFmpeg's in-memory filesystem doesn't auto-cleanup. Files accumulate until crash. Prevention: Explicit deleteFile() calls in finally blocks after each variation.

3. **Synchronous ZIP creation memory spike** — Creating ZIP loads all videos simultaneously into memory (2-3x file sizes). Prevention: Use JSZip with streamFiles: true, revoke blob URLs immediately after adding to ZIP.

4. **FFmpeg.wasm 0.11 → 0.12+ migration breaking changes** — Major API changes, new SharedArrayBuffer requirements, different worker setup. Prevention: Dedicate isolated Phase 0 for upgrade only, test COOP/COEP headers on Cloudflare Pages, have 0.11.6 rollback ready.

5. **Web Worker queue race conditions** — If using workers (optional), message passing creates ordering issues, response mixups, cancellation affects wrong job. Prevention: Job ID tracking with response mapping, mutex for shared FFmpeg instance.

**Moderate pitfalls:**
- No cancellation cleanup (resources continue consuming CPU/memory)
- Hardcoded memory limits ignored (browser limits < FFmpeg limits)
- No incremental progress feedback (users think app froze)
- Filename collisions in batch processing (need timestamps + unique IDs)

**Minor pitfalls:**
- No browser compatibility warnings (SharedArrayBuffer requires headers)
- Global FFmpeg instance conflicts (needs mutex or per-worker instances)
- Progress bars freeze at 99% (reserve budget for post-processing)

## Implications for Roadmap

Based on research, suggested phase structure prioritizes memory stability before adding batch features. FFmpeg.wasm upgrade should be isolated, and ZIP creation should be deferred until core batch processing is proven stable.

### Phase 0: FFmpeg.wasm Upgrade (Optional but Recommended)
**Rationale:** FFmpeg.wasm 0.12.x provides 2-3x performance improvement and better memory management, but requires architectural changes. Isolating this work prevents entanglement with batch feature implementation.
**Delivers:** FFmpeg.wasm 0.12.x integration with multi-threading support
**Addresses:** Performance optimization, better memory handling for batch processing
**Avoids:** Pitfall #4 (breaking API changes mixed with feature work)
**Critical requirements:**
- Configure COOP/COEP headers on Cloudflare Pages (_headers file)
- Rewrite FFmpeg initialization from createFFmpeg() to new FFmpeg()
- Update file operations (API changed in 0.12.x)
- Test SharedArrayBuffer availability with fallback to single-threaded mode
- Have 0.11.6 rollback plan ready

**Decision point:** If upgrade is too risky, document decision to stay on 0.11.6 and accept slower performance. This is a valid choice given memory constraints.

### Phase 1: Memory Management Cleanup
**Rationale:** Existing codebase has known memory leaks (blob URLs, processed videos array). These MUST be fixed before scaling to 20 variations or crashes are guaranteed.
**Delivers:** Centralized blob URL management, FFmpeg filesystem cleanup, memory budget validation
**Addresses:** Pitfalls #1 (blob URLs), #2 (FFmpeg FS), #5 (race conditions), #6 (cancellation cleanup), #12 (global instance conflicts)
**Components implemented:**
- Memory Manager (blob URL registry, lifecycle tracking)
- Enhanced cleanup in existing queue (deleteFile() calls in finally blocks)
- Memory budget estimation (validate before batch start)
- Cancellation cleanup hooks (stop processing, clean up partial work)

**Success criteria:** Process single video 10 times in succession without memory growth, verified with Chrome DevTools memory profiler.

### Phase 2: Core Batch Generation
**Rationale:** With memory foundation solid, add batch orchestration. This phase implements the core value proposition (N variations from single upload) without ZIP download complexity.
**Delivers:** Variation count input, unique effect combinations, batch progress, individual downloads
**Addresses:** Table stakes features from FEATURES.md (variation count, unique effects, progress, cancel)
**Uses:** Enhanced FFmpeg queue (Phase 1), Random Effect Generator (new)
**Implements:** Variation Generation Controller, Batch Progress Aggregator
**Components implemented:**
- Batch Configuration Interface (variation count input, 5-20 range)
- Variation Generation Controller (shared ArrayBuffer, sequential processing)
- Random Effect Generator (seeded randomness for reproducibility)
- Batch Progress Aggregator (per-variation + overall progress)

**Success criteria:** Generate 10 variations, each with unique effects, download individually, verify memory cleanup after batch.

### Phase 3: ZIP Download
**Rationale:** Bulk download is essential for good UX with 10+ variations, but ZIP creation has memory risks. Defer until core batch processing is proven stable.
**Delivers:** ZIP creation with JSZip, bulk download trigger, streaming to reduce memory
**Addresses:** Table stakes feature (bulk download) while avoiding Pitfall #3 (memory spike)
**Uses:** JSZip 3.10.x+, file-saver 2.0.x
**Implements:** ZIP Download Manager
**Components implemented:**
- JSZip integration (CDN: esm.sh/jszip@3.10.1)
- Streaming ZIP creation (streamFiles: true option)
- Memory-aware batch sizing (warn if estimated peak > 150MB)
- Cleanup after download (revoke all blob URLs)

**Success criteria:** Download 20 variations as ZIP (<200MB peak memory), verify cleanup afterward.

### Phase 4: Polish & Differentiators (Optional)
**Rationale:** Core MVP is complete. Add nice-to-have features based on user feedback.
**Delivers:** Effect intensity control, metadata export, smart effect distribution
**Addresses:** Competitive features from FEATURES.md
**Components implemented:**
- Effect intensity slider (subtle vs dramatic randomness)
- Metadata JSON export (manifest of effects per variation)
- Smart effect distribution (ensure all effect types represented)

**Defer to post-MVP:** Preview all variations, perceptual hash validation, resume failed batch.

### Phase Ordering Rationale

- **Phase 0 first (if pursued):** FFmpeg.wasm upgrade has cascading impacts. Isolate to prevent mixing architectural changes with feature work.
- **Phase 1 before Phase 2:** Memory leaks MUST be fixed before scaling to batch operations. Crashes during Phase 2 testing would require backtracking.
- **Phase 2 before Phase 3:** Prove core batch processing works before adding ZIP complexity. Individual downloads provide fallback if ZIP creation fails.
- **Phase 3 completion = MVP:** ZIP download completes the core value proposition (generate N variations, download as bundle).
- **Phase 4 is optional:** Differentiators add polish but aren't essential for launch.

**Critical path:** Phase 1 → Phase 2 → Phase 3 (Phases 0 and 4 are optional)

**Parallelizable work:** Random Effect Generator (Phase 2), Batch Configuration UI (Phase 2) can be built in parallel with Phase 1 cleanup.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 0 (FFmpeg.wasm Upgrade):** Need official migration guide, test COOP/COEP headers on Cloudflare Pages, verify SharedArrayBuffer fallback behavior
- **Phase 3 (ZIP Download):** Test JSZip memory characteristics with real data (20 × 5MB files), verify streaming actually reduces peak memory

Phases with standard patterns (skip research-phase):
- **Phase 1 (Memory Management):** Standard blob URL lifecycle patterns, well-documented FFmpeg.wasm cleanup
- **Phase 2 (Core Batch):** Queue extension follows existing pattern, effect randomization is straightforward utility

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | FFmpeg.wasm 0.12.x benefits documented but migration details need verification. JSZip is proven. Version numbers need current check. |
| Features | MEDIUM | Feature priorities based on ad creative tool patterns (domain knowledge) but not verified with user research or competitor analysis. |
| Architecture | MEDIUM | Single FFmpeg instance approach is sound based on memory constraints. Web Worker anti-pattern validated by training knowledge but specific memory numbers are estimates. |
| Pitfalls | HIGH | Memory leak patterns and FFmpeg.wasm limitations are well-documented. Specific to observed issues in existing codebase. |

**Overall confidence:** MEDIUM

The core architectural recommendations (sequential processing, shared buffer, aggressive cleanup) are sound and grounded in browser memory constraints. The specific technology choices (FFmpeg.wasm 0.12.x, JSZip) are appropriate. However, confidence is limited by:

1. **No external verification:** WebSearch and WebFetch unavailable during research. All recommendations based on training data (Jan 2025 cutoff).
2. **Version uncertainty:** Specific FFmpeg.wasm 0.12.x features and API details require verification against current documentation.
3. **Memory estimates:** Peak memory calculations (150MB threshold, 100MB per batch) are estimates based on typical file sizes, not tested with actual project videos.
4. **Cloudflare Pages capabilities:** COOP/COEP header configuration needs verification.

### Gaps to Address

Gaps that need resolution during planning or early implementation:

- **FFmpeg.wasm version decision:** Upgrade to 0.12.x or stay on 0.11.6? Requires testing COOP/COEP headers on Cloudflare Pages staging environment. If headers can't be configured, must stay on 0.11.6 (document this trade-off).

- **Memory budget validation:** Estimates assume 5MB video files. Test with actual user videos (likely 10-50MB for ad creatives) to refine thresholds. May need to reduce max batch size from 20 to 10-15.

- **JSZip streaming effectiveness:** Training knowledge suggests streamFiles: true reduces memory, but this needs empirical validation with 20-video batch. If streaming doesn't help, fallback to "download individually" as primary UX.

- **Effect uniqueness threshold:** How different do variations need to be for ad platforms to accept them? Research didn't find specific perceptual hash distance requirements. Consider consulting domain expert or testing with Meta/Google ad platforms during Phase 2.

- **Browser compatibility baseline:** SharedArrayBuffer requires secure context + COOP/COEP headers. This excludes older browsers and Safari <15.2. Decide: block these browsers with friendly error, or provide degraded experience (single-threaded FFmpeg)?

- **Cancellation implementation:** Can FFmpeg.wasm abort mid-encoding, or only between variations? Research suggests only between, but needs verification. Impacts Phase 1 cancellation cleanup design.

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis (app.js, CONCERNS.md, PROJECT.md) — directly observed memory leaks, race conditions, architecture patterns
- FFmpeg.wasm architectural constraints from training data — single instance limitations, MEMFS behavior, SharedArrayBuffer requirements

### Secondary (MEDIUM confidence)
- FFmpeg.wasm 0.11.6 → 0.12.x migration patterns from training knowledge (Jan 2025 cutoff) — API changes, performance improvements
- JSZip memory characteristics from training data — streaming behavior, compression trade-offs
- Browser memory limits and blob URL lifecycle — well-documented Web API behavior
- Ad platform duplicate detection behavior — inferred from training knowledge of Meta/Google ad policies

### Tertiary (LOW confidence, needs validation)
- Specific version numbers (FFmpeg.wasm 0.12.10, JSZip 3.10.1) — may be outdated, check npm before implementation
- Memory budget thresholds (150MB safe limit) — estimates based on typical devices, requires testing
- Performance benchmarks (2-3x improvement with 0.12.x) — based on published benchmarks, actual results vary by device/browser
- Cloudflare Pages header configuration — capabilities not verified, needs docs check

### Verification Required
Before implementation, verify these findings against current sources:
1. [@ffmpeg/ffmpeg latest version](https://www.npmjs.com/package/@ffmpeg/ffmpeg) — check if 0.12.x stable, review changelog
2. [FFmpeg.wasm migration guide](https://github.com/ffmpegwasm/ffmpeg.wasm) — 0.11.6 → latest upgrade path
3. [Cloudflare Pages documentation](https://developers.cloudflare.com/pages/) — COOP/COEP header configuration
4. [JSZip documentation](https://stuk.github.io/jszip/) — verify streamFiles option and memory characteristics
5. Test on target devices (low-end laptop 4GB RAM, mobile browsers) — validate memory budget assumptions

---
*Research completed: 2026-02-06*
*Ready for roadmap: yes*
