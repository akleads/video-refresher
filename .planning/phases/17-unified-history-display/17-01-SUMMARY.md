---
phase: 17-unified-history-display
plan: 01
subsystem: ui
tags: [sqlite, express, dom, css, job-list, filenames]

# Dependency graph
requires:
  - phase: 16-device-job-history-upload
    provides: Device job upload with source column and job_files records
provides:
  - Unified job list API returning source filenames per job
  - Redesigned job cards with filename titles, source badges, and aligned metadata
affects: [18-polish-and-ux, 19-production-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "GROUP_CONCAT join query for aggregating child records into parent response"
    - "Filename truncation pattern: 1-3 show all, 4+ shows first two + N more"

key-files:
  created: []
  modified:
    - server/db/queries.js
    - server/routes/jobs.js
    - views/job-list.js
    - styles.css

key-decisions:
  - "Keep existing listJobs query alongside new listJobsWithFiles for backward compatibility"
  - "Filename display uses text truncation with hover tooltip for full list"

patterns-established:
  - "Job card title shows source filenames instead of opaque job IDs"
  - "Source badge pattern: small uppercase pill with color-coded device/server variants"
  - "Meta row pattern: left-aligned badge + counts, right-aligned timestamp"

# Metrics
duration: 1min
completed: 2026-02-10
---

# Phase 17 Plan 01: Unified History Display Summary

**Job list API with GROUP_CONCAT filename aggregation and redesigned cards showing source filenames, device/server badges, and aligned metadata row**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-10T20:17:54Z
- **Completed:** 2026-02-10T20:19:16Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added listJobsWithFiles query joining jobs with job_files via GROUP_CONCAT to return original filenames
- Updated GET /api/jobs to return fileNames array for each job
- Redesigned job cards: filename titles with ellipsis truncation, device/server source badges, aligned meta row
- Added CSS classes for job-card-title, job-card-meta, job-card-source with device/server color variants

## Task Commits

Each task was committed atomically:

1. **Task 1: Add source filenames to job list API response** - `50a7334` (feat)
2. **Task 2: Redesign job cards with filenames, source badge, and aligned layout** - `bdb72c3` (feat)

## Files Created/Modified
- `server/db/queries.js` - Added listJobsWithFiles prepared statement with GROUP_CONCAT join
- `server/routes/jobs.js` - Updated GET / to use listJobsWithFiles and return fileNames array
- `views/job-list.js` - Replaced job-card-id with filename-based title, added source badge and meta row
- `styles.css` - Added job-card-title, job-card-meta, job-card-meta-left, job-card-source, job-card-source-device, job-card-source-server classes

## Decisions Made
- Kept existing `listJobs` query alongside new `listJobsWithFiles` since other code may reference the original
- Filename display truncation: 1-3 files show all names, 4+ shows first two with "+N more" suffix
- Added `title` attribute on card title for hover tooltip showing full filename list

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Unified job list displays both device and server jobs with filenames
- Source badges visually distinguish processing mode
- Ready for any polish/UX improvements in subsequent phases

---
*Phase: 17-unified-history-display*
*Completed: 2026-02-10*
