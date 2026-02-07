# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-06)

**Core value:** Upload one video creative, get multiple unique variations ready for ad platform rotation — fast and without leaving the browser.
**Current focus:** Phase 4 - Core Batch Generation (Phases 1-3 complete)

## Current Position

Phase: 4 of 5 (Core Batch Generation) — In progress
Plan: 2 of 2 in current phase
Status: Plan 04-02 complete
Last activity: 2026-02-07 — Completed 04-02-PLAN.md

Progress: [███████░░░] 70%

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Average duration: 4.4 min
- Total execution time: 0.52 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-ffmpeg-wasm-upgrade | 2 | 13min | 7min |
| 02-memory-management | 2 | 7min | 4min |
| 03-performance-optimization | 1 | 8min | 8min |
| 04-core-batch-generation | 2 | 6min | 3min |

**Recent Trend:**
- Last 5 plans: 02-02 (5min), 03-01 (8min), 04-01 (2min), 04-02 (4min)
- Trend: Pure logic/function tasks complete quickly; plans with human-verify checkpoints take longer but are still fast

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Keep processing client-side (No backend infrastructure to maintain, zero hosting costs beyond static CDN)
- ZIP download for bulk variations (User processes 5-20 variations; individual downloads impractical at scale)
- Random effect mix per variation (Each variation needs to appear unique to ad platform algorithms)
- Use jsdelivr CDN for FFmpeg.wasm 0.12.x (Proven compatibility with worker files vs esm.sh)
- Clamp FFmpeg progress to 0-1 range (Known bug in 0.12.x returning negative values)
- Check both SharedArrayBuffer and crossOriginIsolated (SharedArrayBuffer may exist but be disabled without COOP/COEP)
- Self-host FFmpeg class worker (CDN blob URLs break due to relative ES module imports in worker.js)
- Cap processedVideos at 20 entries (Balances memory usage with user experience for desktop/mobile middle ground)
- Revoke original video blob URL when new video uploaded (Original only needed for preview until next upload)
- Use simple eviction function instead of class (Transparent implementation, minimal abstraction for single use case)
- Recover FFmpeg instance on corruption errors but don't auto-retry failed operation (Defer retry logic to Phase 4 batch processing context)
- Detect corruption via error message pattern matching (Corruption manifests in specific error messages: abort, OOM, RuntimeError)
- Re-attach event handlers during recovery (Maintain progress/log tracking after FFmpeg instance replacement)
- Use ultrafast preset for all videos regardless of size (Prioritize speed over marginal quality for ad creative workflows)
- Add loadVideoBuffer() for buffer preloading in batch workflows (Prepares for Phase 4 multiple operations on same video)
- Add preloadedBuffer parameter to processVideo() for buffer reuse (Skip redundant file.arrayBuffer() calls)
- Add cleanupInput parameter to conditionally preserve input file in MEMFS (Avoid re-writing same file across batch operations)
- Log encoding performance timing via performance.now() (Visibility into optimization impact)
- Effect parameter ranges: rotation 0.001-0.01 rad, brightness -0.05-0.05, contrast/saturation 0.95-1.05 (Produce visually distinct variations without quality degradation)
- Round effect values to 4 decimal places for consistent duplicate detection (JSON.stringify deduplication requires consistent precision)
- Use maxAttempts = count * 100 in generateUniqueEffects() (Prevent infinite loops while providing generous collision avoidance budget)
- Add fillcolor=black@0 to rotate filter when using custom effects (Prevent transparency artifacts from custom rotation values)
- Extend processVideo() with effects and variationIndex parameters using null defaults (Maintain backward compatibility for existing single-video workflow)
- Use orchestration-layer cancellation with batchCancelled flag between variations (FFmpeg.wasm 0.12.x doesn't expose mid-encoding abort API)
- Process batch variations sequentially in for loop (Avoid FFmpeg instance conflicts and CPU thrashing from parallel encoding)
- Load buffer once before batch loop via loadVideoBuffer() and ffmpeg.writeFile() (Eliminate N-1 redundant file operations)
- Display first completed variation in preview area immediately (Early quality feedback before batch completes)
- Preserve partial results on cancellation (User keeps all completed variations when stopping mid-batch)

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 1: COMPLETE**
- ✓ COOP/COEP headers verified (Cloudflare Pages + server.py)
- ✓ FFmpeg.wasm 0.12.x initialization with multi-threading + fallback
- ✓ processVideo() migrated to async API (writeFile/exec/readFile/deleteFile)
- ✓ Self-hosted class worker resolves CORS issue
- ✓ End-to-end verified: upload → process → preview → download

**Phase 2: COMPLETE**
- ✓ 02-01 complete: BlobURLRegistry + bounded processedVideos with eviction
- ✓ 02-02 complete: FFmpeg instance recovery + memory stability verified across 10 operations
- Ready for Phase 3: Effects library can safely use multiple FFmpeg operations per video

**Phase 3: COMPLETE**
- ✓ 03-01 complete: Ultrafast encoding preset + buffer reuse infrastructure
- Ready for Phase 4: Batch processing infrastructure prepared (loadVideoBuffer, preloadedBuffer, cleanupInput parameters)

**Phase 4: COMPLETE**
- ✓ 04-01 complete: Batch logic foundations (generateUniqueEffects, formatVariationFilename, extended processVideo)
- ✓ 04-02 complete: Batch UI and orchestration (variation count input, generateBatch orchestrator, cancellation)
- Ready for Phase 5: ZIP download for bulk variations
- Decisions made:
  - Orchestration-layer cancellation using shared flag between variations (FFmpeg.wasm can't abort mid-encoding)
  - Sequential batch processing to avoid FFmpeg conflicts and CPU thrashing
  - Buffer reuse pattern: single loadVideoBuffer() + MEMFS write before loop
  - First variation preview for early quality check

## Session Continuity

Last session: 2026-02-07 (Phase 4 complete)
Stopped at: Completed 04-02-PLAN.md
Resume file: None
