---
phase: 07-ffmpeg-processing-engine
plan: 03
subsystem: infra
tags: [process-management, graceful-shutdown, recovery, job-queue, signal-handlers]

# Dependency graph
requires:
  - phase: 07-01
    provides: FFmpeg wrapper, effects generator, DB queries for recovery (getProcessingJobs, getFilesWithPid, clearFilePid)
  - phase: 07-02
    provides: processJob function, JobQueueWorker class
provides:
  - Server-integrated queue worker with automatic startup
  - Graceful shutdown handling for SIGTERM/SIGINT with FFmpeg cleanup
  - Startup recovery that marks stuck jobs as failed and kills orphaned FFmpeg processes
  - Enhanced job status endpoint with per-file progress, completed variations, and output files
affects: [08-api-integration, 09-ui-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signal handlers (SIGTERM/SIGINT) for graceful shutdown with resource cleanup"
    - "Startup recovery for interrupted jobs and orphaned processes"
    - "Queue worker lifecycle managed by server (start after listen, stop on shutdown)"

key-files:
  created: []
  modified:
    - server/index.js
    - server/routes/jobs.js

key-decisions:
  - "Worker starts AFTER server listens and recovery runs (ensures DB ready)"
  - "Orphaned FFmpeg processes killed with SIGKILL (no parent to forward SIGTERM)"
  - "Active FFmpeg processes killed with SIGTERM during graceful shutdown (allows cleanup)"
  - "Overall progress calculated as average of file progress (100% if job completed)"

patterns-established:
  - "recoverInterruptedJobs() pattern: mark stuck jobs failed, kill orphaned pids"
  - "gracefulShutdown() pattern: stop worker, kill FFmpeg, mark jobs failed, close DB, exit"
  - "Job status response includes per-file progress, completedVariations, error, outputs array"

# Metrics
duration: 1min
completed: 2026-02-07
---

# Phase 7 Plan 3: Recovery and Process Management Summary

**Production-ready queue worker with graceful shutdown, startup recovery for interrupted jobs, and enhanced status API with real-time progress tracking**

## Performance

- **Duration:** 1 minute
- **Started:** 2026-02-07T21:58:23Z
- **Completed:** 2026-02-07T21:59:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Integrated queue worker into server startup with automatic recovery and processing
- Implemented graceful shutdown handling that stops worker, kills active FFmpeg processes, and marks interrupted jobs as failed
- Added startup recovery that detects stuck jobs from crashes and kills orphaned FFmpeg processes
- Enhanced job status endpoint with per-file progress, completed variations, error messages, and output file details
- Overall progress calculated as average of file-level progress

## Task Commits

Each task was committed atomically:

1. **Task 1: Add startup recovery, graceful shutdown, and queue worker to server** - `aa51946` (feat)
2. **Task 2: Enhance job status endpoint with progress and output data** - `f229e75` (feat)

## Files Created/Modified
- `server/index.js` - Imports JobQueueWorker, creates worker instance, implements recoverInterruptedJobs() function, adds gracefulShutdown() with SIGTERM/SIGINT handlers, starts worker after server listens
- `server/routes/jobs.js` - Enhanced GET /:id handler to query output_files, calculate overallProgress, and include per-file progress/completedVariations/error/outputs in response

## Decisions Made

**1. Worker starts after server listens and recovery runs**
- Rationale: Ensures database is fully ready and any interrupted jobs from previous crashes are cleaned up before starting new processing

**2. Orphaned processes killed with SIGKILL, active processes with SIGTERM**
- Rationale: Orphaned processes from previous server run have no parent to forward signals, require SIGKILL. Active processes during graceful shutdown have server as parent and can be given time to cleanup with SIGTERM (followed by SIGKILL after 2s timeout if needed)

**3. Overall progress as average of file progress**
- Rationale: Simple calculation that provides meaningful progress bar for users. Alternative (weighted by file size) adds complexity without meaningful UX improvement for typical use case.

**4. Per-file outputs included in job status response**
- Rationale: Frontend can display download links for completed variations even while batch is still processing. Enables progressive enhancement of UI.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 8 (API Integration):**
- Queue worker fully integrated and production-ready
- Graceful shutdown prevents orphaned processes
- Startup recovery handles crash scenarios
- Status endpoint provides all data needed for progress UI

**Phase 7 Complete:**
- All three plans (foundation, processor, recovery) finished
- FFmpeg processing engine is production-ready
- No blockers for Phase 8 API integration and testing

**Concerns:** None - all planned functionality delivered and verified.

---
*Phase: 07-ffmpeg-processing-engine*
*Completed: 2026-02-07*
