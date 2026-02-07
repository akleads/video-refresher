---
phase: 07-ffmpeg-processing-engine
plan: 02
subsystem: video-processing
tags: [ffmpeg, sqlite, job-queue, background-worker, video-encoding]

# Dependency graph
requires:
  - phase: 07-01
    provides: FFmpeg wrapper (spawnFFmpeg, getVideoDuration), effects generator (generateUniqueEffects, buildFilterString), DB queries for progress tracking
provides:
  - Video processor that turns uploaded videos into variations using FFmpeg and effects
  - Background job queue worker that polls SQLite and processes jobs fire-and-forget
  - Per-file progress tracking and error isolation
affects: [07-03, 08-api-endpoints, 09-ui-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [fire-and-forget job processing, per-file error isolation, SQLite polling queue]

key-files:
  created: [server/lib/processor.js, server/lib/queue.js]
  modified: []

key-decisions:
  - "processJob handles partial failures - job marked 'completed' if any file succeeds"
  - "Queue worker uses setImmediate for rapid back-to-back job processing"
  - "Progress updates throttled to 2% increments to reduce DB writes"

patterns-established:
  - "Per-file error handling: failed file doesn't block batch processing"
  - "Overall file progress = (variation_index * 100 + variation_percent) / total_variations"
  - "Queue worker polls every 2 seconds, processes one job at a time"

# Metrics
duration: 1min
completed: 2026-02-07
---

# Phase 7 Plan 2: FFmpeg Processing Engine Summary

**Video processor with per-file FFmpeg spawning, progress tracking, and background queue worker polling SQLite for fire-and-forget job processing**

## Performance

- **Duration:** 1 min 26 sec
- **Started:** 2026-02-07T21:53:50Z
- **Completed:** 2026-02-07T21:55:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Built core video processing orchestrator that drives FFmpeg to create variations
- Implemented background job queue worker with SQLite polling
- Per-file error isolation prevents single video failure from blocking entire batch
- Progress tracking updates SQLite as each variation encodes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create video processor module** - `31f643a` (feat)
2. **Task 2: Create job queue worker with SQLite polling** - `007e220` (feat)

## Files Created/Modified
- `server/lib/processor.js` - Exports processJob(job, db, queries, outputDir). Processes each file independently, probes duration, generates N unique effects, spawns FFmpeg N times, updates progress in SQLite, records output files.
- `server/lib/queue.js` - Exports JobQueueWorker class. Polls SQLite every 2 seconds for queued jobs, processes one at a time, stoppable, tracks current job ID.

## Decisions Made

**1. Partial success handling for jobs**
- Job status set to 'completed' if any file succeeds (not just all files)
- Only marked 'failed' if ALL files fail
- Rationale: Batch processing should deliver partial results when possible

**2. setImmediate for rapid job processing**
- After completing a job, worker uses setImmediate to check for next job
- Falls back to 2-second polling if queue empty
- Rationale: Process back-to-back jobs without artificial delay

**3. Progress throttling to 2% increments**
- SQLite progress updates only written when change >= 2%
- Prevents excessive DB writes during encoding
- Rationale: Balance responsiveness with write efficiency

**4. Per-file progress calculation**
- Overall progress = (variation_index * 100 + variation_percent) / total_variations
- Provides smooth 0-100% progress across all variations for a file
- Rationale: User sees continuous progress, not jumps between variations

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 7 Plan 3 (recovery and process management):**
- Core processing engine complete
- Progress tracking and error handling in place
- Queue worker architecture proven

**Ready for Phase 8 (API endpoints):**
- processJob and JobQueueWorker can be integrated into server startup
- All DB queries already prepared for status polling endpoints

**Concerns:**
- No recovery mechanism for orphaned FFmpeg processes yet (07-03)
- No server-side startup integration yet (08-api-endpoints)

---
*Phase: 07-ffmpeg-processing-engine*
*Completed: 2026-02-07*
