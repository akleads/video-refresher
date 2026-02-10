---
phase: 12-server-job-cancellation
plan: 01
subsystem: api
tags: [ffmpeg, node.js, child-process, sqlite, cancellation, graceful-shutdown]

# Dependency graph
requires:
  - phase: 07-server-core
    provides: Server job processing with FFmpeg spawning and progress tracking
  - phase: 08-server-cleanup
    provides: Cleanup daemon for expired jobs
provides:
  - POST /api/jobs/:id/cancel endpoint for stopping in-progress jobs
  - 3-stage FFmpeg termination (stdin 'q' -> SIGTERM -> SIGKILL)
  - Cancellation-aware processing loop that stops between variations
  - Partial output file cleanup (preserves completed variations)
  - 'cancelled' status in database with cancelled_at timestamp
affects: [13-ui-hybrid-processing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 3-stage process termination escalation (stdin 'q' -> 2s -> SIGTERM -> 2s -> SIGKILL)
    - Process registry pattern for FFmpeg child process tracking
    - Cancellation polling between variations (not mid-variation)
    - Partial file cleanup by comparing filesystem to database records

key-files:
  created:
    - server/lib/cancel.js
  modified:
    - server/db/schema.js
    - server/db/queries.js
    - server/lib/ffmpeg.js
    - server/lib/processor.js
    - server/lib/queue.js
    - server/routes/jobs.js

key-decisions:
  - "3-stage FFmpeg termination: stdin 'q' first for graceful cleanup, then SIGTERM, finally SIGKILL"
  - "Cancellation check between variations (not during) to minimize partial files"
  - "Completion status wins race: if job finishes before kill takes effect, stays 'completed'"
  - "Cancelled jobs included in 24h cleanup lifecycle (same as completed/failed)"

patterns-established:
  - "Process registry pattern: Map<jobFileId, ChildProcess> for cancellation tracking"
  - "Partial file cleanup: scan filesystem, delete files not in database output_files table"
  - "Cancellation-aware error handling: check isCancelled flag after FFmpeg promise rejection"

# Metrics
duration: 2min
completed: 2026-02-09
---

# Phase 12 Plan 01: Server Job Cancellation Summary

**POST /api/jobs/:id/cancel with 3-stage FFmpeg termination, cancellation-aware processing loop, and partial file cleanup**

## Performance

- **Duration:** 2 minutes
- **Started:** 2026-02-09T21:37:32Z
- **Completed:** 2026-02-09T21:40:31Z
- **Tasks:** 2
- **Files modified:** 7 (1 created)

## Accomplishments
- POST /api/jobs/:id/cancel endpoint handles queued, processing, and terminal job states
- 3-stage FFmpeg termination (stdin 'q' -> SIGTERM -> SIGKILL) prevents corrupted output files
- Processing loop checks for cancellation before each variation and between files
- Completed variations preserved after cancellation (only partial files deleted)
- Cancelled jobs included in cleanup daemon with 24h expiry

## Task Commits

Each task was committed atomically:

1. **Task 1: Database schema, queries, and FFmpeg stdin + cancel function** - `ffeb7e5` (feat)
2. **Task 2: Cancel endpoint, processor cancellation loop, and queue wiring** - `b7ad861` (feat)

## Files Created/Modified
- `server/lib/cancel.js` - Process registry and 3-stage graceful FFmpeg termination
- `server/db/schema.js` - Added cancelled_at column migration to jobs table
- `server/db/queries.js` - Added cancelJob, isJobCancelled queries; updated cleanup to include 'cancelled'
- `server/lib/ffmpeg.js` - Changed FFmpeg spawn to pipe stdin (not ignore) for 'q' command
- `server/lib/processor.js` - Cancellation checks between variations, register/unregister processes, partial file cleanup
- `server/lib/queue.js` - Skip marking cancelled jobs as failed in catch block
- `server/routes/jobs.js` - POST /:id/cancel endpoint, cancelledAt field, allow cancelled jobs in download

## Decisions Made

**3-stage-escalation:** Use stdin 'q' -> wait 2s -> SIGTERM -> wait 2s -> SIGKILL for graceful FFmpeg termination. This prevents corrupted MP4 files (missing moov atom) that occur with immediate SIGTERM/SIGKILL.

**cancellation-between-variations:** Check for cancellation before starting each variation (not during). Minimizes partial files and allows clean completion of current variation before stopping.

**completion-wins-race:** If all variations finish naturally before kill signal takes effect, job status remains 'completed' (not 'cancelled'). Checked by re-reading job status after kill attempt.

**cancelled-in-cleanup:** Include 'cancelled' status in getExpiredJobs and getEvictionCandidates queries. Cancelled jobs follow same 24h lifecycle as completed/failed.

**process-registry:** Maintain Map<jobFileId, ChildProcess> for active FFmpeg processes. Enables graceful kill with stdin.write('q') before escalating to signals.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Server-side cancellation complete. Phase 13 (UI Hybrid Processing) can:
- Call POST /api/jobs/:id/cancel from UI cancel buttons
- Display cancelledAt timestamp in job detail view
- Show "Cancelled (X/Y)" status with completion count
- Download partial results (completed variations) from cancelled jobs

No blockers. Cancellation endpoints tested via module loading verification.

---
*Phase: 12-server-job-cancellation*
*Completed: 2026-02-09*
