# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-08)

**Core value:** Upload video creatives, get multiple unique variations ready for ad platform rotation -- fast, without waiting at the screen.
**Current focus:** v3.0 Hybrid Processing -- Phase 12: Server Job Cancellation

## Current Position

Phase: 12 of 13 (Server Job Cancellation)
Plan: 01 of 1
Status: Complete
Last activity: 2026-02-09 -- Completed 12-01-PLAN.md

Progress: [################----] 96% (26/~27 plans, v3.0 in progress)

## Performance Metrics

**v1.0 Velocity:**
- Total plans completed: 8
- Average duration: 4.8 min

**v2.0 Velocity:**
- Total plans completed: 12
- Average duration: 2.3 min

**v3.0 Velocity (in progress):**
- Total plans completed: 6
- Average duration: 3.2 min

## Accumulated Context

### Decisions

Full decision log in PROJECT.md Key Decisions table (22 decisions, all marked Good).

**Phase 10:**
- CORP-header-simple: Use simple middleware instead of helmet for single header requirement
- effects-rng-parameter: Shared effects module accepts RNG function for isomorphic design
- COOP-COEP-all-paths: Applied headers to /* pattern for consistent cross-origin isolation
- device-server-terminology: Used 'device'/'server' in getProcessingMode() to match UI requirements
- no-auto-wire: Capability detection module created without wiring into views (deferred to Phase 13)
- Dockerfile fix: Added COPY for shared lib/effects-shared.js to Docker image

**Phase 11 (Plan 01):**
- cdn-imports: Use CDN imports (esm.sh) for FFmpeg.wasm and client-zip to avoid bundler requirements
- multi-threaded-fallback: Multi-threaded FFmpeg with single-threaded fallback for broad device compatibility
- progress-throttling: Throttle progress updates at 2% increments to prevent postMessage flooding
- buffer-copy-pattern: Create new Uint8Array before writeFile to prevent ArrayBuffer neutering

**Phase 11 (Plan 02):**
- fixed-worker-count: 2 dedicated workers (not dynamic scaling) for predictable performance on typical devices
- retry-once-skip: Retry-once-then-skip failure handling prevents batch abortion while maximizing successful variations
- defensive-copying: Fresh Uint8Array copy per job prevents ArrayBuffer neutering across concurrent workers
- partial-cancellation: Cancellation returns completed results for incremental download

**Phase 11 (Plan 03):**
- module-level-file-passing: setDeviceProcessingData() stores File objects in module state (can't serialize to URLs)
- beforeunload-lifecycle: Handler attached during processing, removed when done/cancelled
- partial-download: Cancel button produces ZIP of completed variations

**Phase 12 (Plan 01):**
- 3-stage-escalation: stdin 'q' -> 2s -> SIGTERM -> 2s -> SIGKILL for graceful FFmpeg termination
- cancellation-between-variations: Check for cancellation before each variation (not during) to minimize partial files
- completion-wins-race: Job status stays 'completed' if all variations finish before kill takes effect
- cancelled-in-cleanup: Cancelled jobs follow same 24h expiry lifecycle as completed/failed
- process-registry: Map<jobFileId, ChildProcess> for active FFmpeg process tracking

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-09
Stopped at: Completed 12-01-PLAN.md (Server Job Cancellation)
Resume file: None
Next: Phase 13 (UI Hybrid Processing)
