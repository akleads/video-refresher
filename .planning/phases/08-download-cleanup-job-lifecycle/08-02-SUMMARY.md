---
phase: 08-download-cleanup-job-lifecycle
plan: 02
subsystem: infra
tags: [cleanup, daemon, sqlite, disk-management, lifecycle]

# Dependency graph
requires:
  - phase: 06-job-queue-worker
    provides: JobQueueWorker and job processing infrastructure
  - phase: 02-upload-api-storage
    provides: DATA_DIR, OUTPUT_DIR, volume storage structure
provides:
  - CleanupDaemon class with automatic expiry and eviction
  - Cleanup queries (getExpiredJobs, getEvictionCandidates, deleteJob, getStuckQueuedJobs)
  - 5-minute cleanup interval with 85% disk usage eviction threshold
  - Graceful lifecycle integration (start/stop with server)
affects: [deployment, monitoring, storage-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Daemon pattern with setInterval + unref() for background tasks"
    - "Crash-safe deletion (disk files before DB rows)"
    - "fs.statfsSync for disk usage monitoring"

key-files:
  created:
    - server/lib/cleanup.js
  modified:
    - server/db/queries.js
    - server/index.js

key-decisions:
  - "5-minute cleanup interval balances responsiveness with CPU overhead"
  - "85% eviction threshold provides buffer before hitting volume limit"
  - "Stuck queued jobs marked failed before expiry (prevents orphaned queued state)"
  - "Pass DATA_DIR (not OUTPUT_DIR) to CleanupDaemon for accurate statfsSync"

patterns-established:
  - "Daemon lifecycle: start() with timer.unref(), stop() with clearInterval"
  - "File deletion before DB deletion for crash safety"
  - "Eviction iterates oldest-first with threshold recheck after each deletion"

# Metrics
duration: 112s
completed: 2026-02-07
---

# Phase 8 Plan 2: Cleanup Daemon Summary

**Automatic job expiry (24h) and storage eviction (85% threshold) using CleanupDaemon with fs.statfsSync and crash-safe deletion**

## Performance

- **Duration:** 1min 52s
- **Started:** 2026-02-08T00:48:46Z
- **Completed:** 2026-02-08T00:50:38Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- CleanupDaemon runs every 5 minutes to enforce time-based expiry and storage-cap eviction
- Expired jobs (24h+ completed/failed) automatically deleted with files removed from volume
- Storage pressure eviction triggers at 85% usage, targeting oldest completed/failed jobs
- Stuck queued jobs (past expires_at) marked failed before expiry cycle
- Daemon integrated into server startup and graceful shutdown lifecycle

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cleanup queries and create CleanupDaemon** - `19051e6` (feat)
2. **Task 2: Integrate CleanupDaemon into server lifecycle** - `ee4b822` (feat)

## Files Created/Modified
- `server/lib/cleanup.js` - CleanupDaemon class with expireOldJobs, markStuckJobs, evictIfNeeded methods
- `server/db/queries.js` - Added getExpiredJobs, getEvictionCandidates, deleteJob, getStuckQueuedJobs prepared statements
- `server/index.js` - Import CleanupDaemon, instantiate with (db, queries, DATA_DIR), start/stop lifecycle

## Decisions Made

**1. 5-minute cleanup interval**
- Rationale: Balances responsiveness (jobs expire within 5 min of 24h mark) with CPU overhead (no need for sub-minute polling)

**2. 85% eviction threshold**
- Rationale: Provides buffer before hitting 3GB volume limit (450MB headroom at threshold)

**3. Mark stuck queued jobs failed before expiry**
- Rationale: Prevents orphaned queued jobs from lingering past expiry; users see clear "expired while queued" status

**4. Pass DATA_DIR (not OUTPUT_DIR) to CleanupDaemon**
- Rationale: fs.statfsSync needs volume mount point for accurate disk usage stats; OUTPUT_DIR is a subdirectory

**5. Delete files from disk BEFORE DB rows**
- Rationale: Crash-safe ordering — if process crashes mid-cleanup, DB row remains (will be retried), but files are gone (safe)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 8 Plan 1 (Download endpoint):**
- Cleanup daemon operational and integrated
- Job lifecycle fully managed (creation → processing → expiry/eviction)
- Download endpoint can assume cleanup handles old jobs automatically

**No blockers.**

---
*Phase: 08-download-cleanup-job-lifecycle*
*Completed: 2026-02-07*
