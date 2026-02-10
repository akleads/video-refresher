---
phase: 16-device-job-history-upload
plan: 01
subsystem: api
tags: [express, multer, sqlite, multipart, device-upload]

# Dependency graph
requires:
  - phase: 15-format-support
    provides: MOV/MP4 format handling in server and device modes
provides:
  - POST /api/jobs/device endpoint for device result upload
  - jobs.source column distinguishing device vs server jobs
  - deviceUpload multer instance (no MIME filter, 200 file limit)
affects: [16-02, 17-unified-history-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Device job upload via multipart form with JSON metadata in sourceFiles field"
    - "Transaction-wrapped DB writes for multi-table job record creation"
    - "Filename-based source file matching using basename extraction"

key-files:
  created: []
  modified:
    - server/db/schema.js
    - server/db/queries.js
    - server/routes/jobs.js
    - server/middleware/upload.js
    - server/index.js

key-decisions:
  - "Device upload uses separate multer instance without MIME filter (browser blobs have generic types)"
  - "Source file matching uses basename extraction from originalname path segments"
  - "outputDir passed as parameter to createJobsRouter rather than imported as module-level constant"

patterns-established:
  - "Device jobs use source='device', status='completed' at creation time (pre-processed)"
  - "Job file records for device jobs have empty upload_path and zero file_size (no server-side source file)"

# Metrics
duration: 4min
completed: 2026-02-10
---

# Phase 16 Plan 01: Device Job History Upload - Server Endpoint Summary

**POST /api/jobs/device endpoint with source column migration, deviceUpload multer, and transactional job record creation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-10T19:51:44Z
- **Completed:** 2026-02-10T19:55:48Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `source` column to jobs table with migration (default 'server', device jobs use 'device')
- Created `insertDeviceJob` and `insertDeviceJobFile` prepared statements
- Built POST /api/jobs/device endpoint: auth-gated, multipart upload, transactional DB writes
- Added `deviceUpload` multer instance with no MIME filter and 200-file limit
- Job listing and detail APIs now include `source` field for all jobs

## Task Commits

Each task was committed atomically:

1. **Task 1: Add source column to jobs table and device job queries** - `bc3e75e` (feat)
2. **Task 2: Create POST /api/jobs/device endpoint** - `4fc4ab8` (feat)

## Files Created/Modified
- `server/db/schema.js` - Added source column migration for jobs table
- `server/db/queries.js` - Added insertDeviceJob and insertDeviceJobFile prepared statements
- `server/routes/jobs.js` - Added POST /device route, source field in list/detail responses, fs import
- `server/middleware/upload.js` - Added deviceUpload multer instance (no MIME filter, 200 files)
- `server/index.js` - Pass OUTPUT_DIR to createJobsRouter

## Decisions Made
- Device upload uses a separate multer instance (`deviceUpload`) without MIME type filtering, since browser-created Blobs may have generic MIME types like `application/octet-stream`
- Source file matching parses the uploaded filename's path segments (format: `{basename}/{basename}_var{N}_{uuid}.mp4`) to find the corresponding job_file record
- `outputDir` is passed as a function parameter to `createJobsRouter` rather than using a module-level import, keeping the router testable and consistent with other parameter patterns

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Server endpoint ready for frontend integration in 16-02
- Frontend needs to upload device processing results via multipart POST to /api/jobs/device
- sourceFiles metadata format: `[{name: "video.mp4", variationCount: 5}]`
- Result files should use originalname format: `{sourceBaseName}/{sourceBaseName}_var{N}_{uuid}.mp4`

---
*Phase: 16-device-job-history-upload*
*Completed: 2026-02-10*
