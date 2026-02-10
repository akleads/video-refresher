---
phase: 15-format-support
plan: 01
subsystem: ui, api, processing
tags: [mov, quicktime, ffmpeg, multer, mime-type, file-validation]

# Dependency graph
requires:
  - phase: 03-device-processing
    provides: FFmpeg.wasm worker pool and Web Worker pipeline
  - phase: 05-server-processing
    provides: Server FFmpeg processor, multer upload middleware, ZIP download route
provides:
  - MOV file acceptance across frontend, server, and device processing pipelines
  - Extension-agnostic filename handling in server processor and ZIP download
  - Extension-aware FFmpeg.wasm input for correct container format detection
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extension-agnostic basename extraction via path.extname() instead of hardcoded '.mp4'"
    - "MIME type array includes() check instead of single equality for file validation"
    - "Dynamic input filename in FFmpeg.wasm virtual filesystem based on source extension"

key-files:
  created: []
  modified:
    - views/upload.js
    - server/middleware/upload.js
    - server/lib/processor.js
    - server/routes/jobs.js
    - lib/device-processing/ffmpeg-worker.js
    - lib/device-processing/worker-pool.js

key-decisions:
  - "Used explicit extension list (mp4|mov) in ZIP folder naming for user-visible clarity rather than generic strip"
  - "FFmpeg.wasm input filename uses original extension so FFmpeg identifies QuickTime container correctly"
  - "Worker pool stores extension on instance (this.currentVideoExt) since processVideo processes one file at a time"

patterns-established:
  - "Multi-format acceptance: validate by both MIME type and file extension for browser compatibility"
  - "Input extension passthrough: worker-pool.js extracts extension and passes to ffmpeg-worker.js via postMessage"

# Metrics
duration: 2min
completed: 2026-02-10
---

# Phase 15 Plan 01: Format Support Summary

**MOV file support across entire upload-to-processing pipeline with video/quicktime MIME acceptance, extension-aware FFmpeg.wasm input, and always-MP4 output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-10T18:25:47Z
- **Completed:** 2026-02-10T18:27:33Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- MOV files accepted via file picker, drag-and-drop, and server upload validation
- FFmpeg.wasm uses correct input file extension so QuickTime container is properly detected
- Server processor and ZIP download handle any extension generically
- All output remains MP4 regardless of input format

## Task Commits

Each task was committed atomically:

1. **Task 1: Add MOV acceptance to frontend upload and server middleware** - `bb11e68` (feat)
2. **Task 2: Fix extension handling in server processor, download route, and device worker** - `02fcd1a` (feat)

## Files Created/Modified
- `views/upload.js` - File input accept attribute, addFiles() validation, UI text all updated for MOV
- `server/middleware/upload.js` - Multer fileFilter accepts video/quicktime MIME type
- `server/lib/processor.js` - Generic extension stripping via path.extname() instead of hardcoded '.mp4'
- `server/routes/jobs.js` - ZIP folder name strips both .mp4 and .mov extensions
- `lib/device-processing/ffmpeg-worker.js` - Dynamic input filename with correct extension for container detection
- `lib/device-processing/worker-pool.js` - Extracts and passes original file extension to worker

## Decisions Made
- Used explicit extension list `(mp4|mov)` in ZIP folder naming rather than generic strip -- user-visible naming benefits from clarity
- FFmpeg.wasm input filename uses original extension because FFmpeg relies on file extension for container format detection in the virtual filesystem
- Worker pool stores extension on `this.currentVideoExt` instance property since it processes one video file at a time

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- MOV support complete across all code paths
- Ready for next phase

---
*Phase: 15-format-support*
*Completed: 2026-02-10*
