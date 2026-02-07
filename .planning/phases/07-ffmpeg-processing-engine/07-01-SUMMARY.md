---
phase: 07-ffmpeg-processing-engine
plan: 01
subsystem: database, ffmpeg, processing
tags: better-sqlite3, ffmpeg, ffprobe, child_process, node-stdlib, progress-tracking

# Dependency graph
requires:
  - phase: 06-data-persistence-foundation
    provides: SQLite schema (jobs, job_files), better-sqlite3 setup, queries.js pattern
provides:
  - Extended database schema with progress tracking columns (progress_percent, duration_seconds, ffmpeg_pid, error, completed_variations, updated_at)
  - New output_files table for tracking variation outputs
  - FFmpeg spawn wrapper with stderr progress parsing and ffprobe duration extraction
  - Random effects generator matching v1 ranges (rotation, brightness, contrast, saturation)
  - 15 new prepared statements for progress updates, output tracking, and recovery
affects: 07-02 (processor and queue will consume these modules), 08-api-integration

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "child_process.spawn with readline stderr parsing for FFmpeg progress"
    - "Idempotent schema migration with try/catch for duplicate column errors"
    - "Return {process, promise} pattern for pid tracking with async operations"
    - "readline.close() in both close and error handlers to prevent FD leaks"

key-files:
  created:
    - server/lib/ffmpeg.js
    - server/lib/effects.js
  modified:
    - server/db/schema.js
    - server/db/index.js
    - server/db/queries.js

key-decisions:
  - "Store FFmpeg pid in SQLite for recovery tracking (enables zombie process cleanup on restart)"
  - "Return 0 from getVideoDuration on probe failure (allows encoding without progress tracking)"
  - "Clamp progress to 0-100 range in spawnFFmpeg (prevents negative or >100% display)"
  - "Collect last 20 stderr lines for error reporting (detailed debugging without full log storage)"

patterns-established:
  - "migrateSchema() pattern: idempotent column additions with try/catch duplicate detection"
  - "Effect generation: JSON.stringify for Set-based deduplication"
  - "FFmpeg filter string: rotate (radians) + eq (brightness/contrast/saturation)"

# Metrics
duration: 2min
completed: 2026-02-07
---

# Phase 7 Plan 1: FFmpeg Processing Foundation Summary

**Database schema extended with progress tracking (6 new columns + output_files table), FFmpeg spawn wrapper with real-time progress parsing, and v1-compatible effects generator**

## Performance

- **Duration:** 2 minutes
- **Started:** 2026-02-07T21:48:59Z
- **Completed:** 2026-02-07T21:50:54Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Extended job_files schema with 6 progress/tracking columns (progress_percent, duration_seconds, ffmpeg_pid, error, completed_variations, updated_at)
- Created output_files table for tracking each variation's path and file size
- Built FFmpeg spawn wrapper with readline-based stderr progress parsing and pid tracking
- Implemented ffprobe duration extraction with graceful failure (returns 0 on error)
- Created effects generator matching v1 ranges exactly (rotation 0.001-0.01 radians, brightness -0.05 to 0.05, contrast/saturation 0.95-1.05)
- Added 15 new prepared statements for progress updates, output tracking, and recovery queries

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend database schema and queries for progress and output tracking** - `4a86b84` (feat)
2. **Task 2: Create FFmpeg spawn wrapper and effects generator modules** - `1ee3414` (feat)

## Files Created/Modified
- `server/db/schema.js` - Added migrateSchema() function with idempotent column additions, created output_files table with indexes
- `server/db/index.js` - Added migrateSchema() call after createTables()
- `server/db/queries.js` - Added 15 new prepared statements for progress, status, output files, and recovery
- `server/lib/ffmpeg.js` - FFmpeg spawn wrapper with progress parsing, ffprobe duration extraction, and {process, promise} return pattern
- `server/lib/effects.js` - Random effects generator with v1-compatible ranges and buildFilterString() helper

## Decisions Made

**Decision: Store FFmpeg pid in SQLite for recovery tracking**
- **Rationale:** Enables zombie process cleanup on server restart. Without pid tracking, crashed servers leave orphaned FFmpeg processes consuming CPU/disk.

**Decision: Return 0 from getVideoDuration on probe failure**
- **Rationale:** Allows encoding to proceed without progress tracking rather than failing entire job. Progress callbacks are skipped when duration is 0.

**Decision: Collect last 20 stderr lines for error reporting**
- **Rationale:** FFmpeg errors are often at end of stderr. Collecting all stderr is memory-intensive for long encodes, 20 lines provides debug context without bloat.

**Decision: Use try/catch for idempotent schema migrations**
- **Rationale:** SQLite doesn't support ALTER TABLE ... IF NOT EXISTS. Try/catch with "duplicate column name" check provides idempotency without fragile column existence queries.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all modules imported and verified successfully on first run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Plan 07-02 (Processor and Queue Worker):**
- Database schema supports progress tracking and output file logging
- FFmpeg wrapper provides spawn interface with progress callbacks
- Effects generator produces unique variations
- All queries prepared for update operations during processing

**Blockers:** None

**Concerns:**
- FFmpeg filter parity between FFmpeg.wasm 5-6.x (v1) and native FFmpeg 5.1.8 (deployed) remains unverified until Plan 07-02 testing. Rotation and eq filters are stable since FFmpeg 4.x, but exact syntax should be validated during first encode.

---
*Phase: 07-ffmpeg-processing-engine*
*Completed: 2026-02-07*
