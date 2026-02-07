# Roadmap: Video Refresher - Batch Processing Milestone

## Overview

This roadmap transforms the existing single-video processing tool into a batch variation generator. The journey begins with FFmpeg.wasm modernization, then establishes memory stability (critical for batch operations), optimizes performance, builds core batch generation with progress tracking, and completes with ZIP download for bulk variations. Each phase delivers a verifiable capability that unblocks the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: FFmpeg.wasm Upgrade** - Modernize FFmpeg.wasm to 0.12.x for multi-threading and better memory management
- [x] **Phase 2: Memory Management** - Fix memory leaks and establish cleanup infrastructure for batch stability
- [x] **Phase 3: Performance Optimization** - Optimize encoding settings and buffer reuse for efficient batch processing
- [ ] **Phase 4: Core Batch Generation** - Build variation count input, unique effect combinations, and batch progress tracking
- [ ] **Phase 5: ZIP Download** - Implement bulk download of all variations as single ZIP file

## Phase Details

### Phase 1: FFmpeg.wasm Upgrade
**Goal**: FFmpeg.wasm upgraded to 0.12.x with multi-threading support and verified stability
**Depends on**: Nothing (first phase)
**Requirements**: PERF-01
**Success Criteria** (what must be TRUE):
  1. FFmpeg.wasm 0.12.x loaded successfully with SharedArrayBuffer support
  2. COOP/COEP headers configured on Cloudflare Pages for multi-threading
  3. Existing single-video processing continues working with new FFmpeg API
  4. Fallback to single-threaded mode works when SharedArrayBuffer unavailable
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md — FFmpeg 0.12.x initialization with SharedArrayBuffer detection and COOP/COEP header verification
- [x] 01-02-PLAN.md — Migrate processVideo() to 0.12.x async API and verify end-to-end processing

### Phase 2: Memory Management
**Goal**: Memory leaks eliminated and cleanup infrastructure established for batch stability
**Depends on**: Phase 1
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04
**Success Criteria** (what must be TRUE):
  1. User can process same video 10 times consecutively without memory growth (verified in DevTools)
  2. All blob URLs are automatically revoked after video processing completes
  3. FFmpeg virtual filesystem cleaned between each video operation
  4. processedVideos array properly managed with old entries removed
  5. FFmpeg instance recovers gracefully from processing failures
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — BlobURLRegistry, blob URL revocation lifecycle, bounded processedVideos with eviction cleanup
- [x] 02-02-PLAN.md — FFmpeg instance recovery on corruption errors + human verification of memory stability

### Phase 3: Performance Optimization
**Goal**: Processing speed optimized for efficient batch operations
**Depends on**: Phase 2
**Requirements**: PERF-02, PERF-03
**Success Criteria** (what must be TRUE):
  1. Video encoding uses ultrafast preset by default
  2. Input video file read once and buffer reused for multiple operations
  3. Processing time per video reduced by ~30% compared to baseline (measured with sample video)
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md — Ultrafast encoding preset, buffer reuse infrastructure, and performance timing

### Phase 4: Core Batch Generation
**Goal**: User can generate multiple unique variations from single upload with progress tracking
**Depends on**: Phase 3
**Requirements**: BATCH-01, BATCH-02, BATCH-03, BATCH-04, PROG-01, PROG-02
**Success Criteria** (what must be TRUE):
  1. User can specify variation count via number input (1-20 range with validation)
  2. Each variation in batch receives unique random effect combination (no duplicate combos)
  3. UI displays per-variation progress: "Processing variation 3/10..." with progress bar
  4. User can cancel batch processing mid-operation and partial work stops cleanly
  5. All processed variations follow naming pattern: originalname_var1_abc123.mp4
  6. First completed variation displays in preview area for quality check
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md — Batch logic foundations: unique effect generator, variation filename formatter, and processVideo extension
- [ ] 04-02-PLAN.md — Batch UI controls, orchestration with cancellation, progress tracking, and end-to-end verification

### Phase 5: ZIP Download
**Goal**: All batch variations downloadable as single ZIP file
**Depends on**: Phase 4
**Requirements**: DL-01, DL-02
**Success Criteria** (what must be TRUE):
  1. User can download all variations in batch as single ZIP file
  2. ZIP file uses STORE compression (no re-compression of video data)
  3. ZIP download triggered with single click after batch completes
  4. All blob URLs cleaned up after ZIP download completes
**Plans**: TBD

Plans:
- [ ] 05-01: [To be determined during planning]

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. FFmpeg.wasm Upgrade | 2/2 | Complete | 2026-02-07 |
| 2. Memory Management | 2/2 | Complete | 2026-02-06 |
| 3. Performance Optimization | 1/1 | Complete | 2026-02-06 |
| 4. Core Batch Generation | 0/2 | Not started | - |
| 5. ZIP Download | 0/TBD | Not started | - |
