---
phase: 06-backend-foundation
plan: 02
subsystem: api-server
tags: [express, multer, upload, jobs, rest-api]
requires:
  - phase: 06-01
    provides: Express app with SQLite database, auth middleware, and health endpoint
provides:
  - Multi-file upload endpoint with Multer DiskStorage
  - Job creation API with job and file records in SQLite
  - Job status query endpoint returning per-video entries
  - Job list endpoint
  - ID generation utility using nanoid
affects: [06-03, 07-01]
tech-stack:
  added: []
  patterns:
    - Multer DiskStorage for direct-to-volume file uploads
    - Factory function pattern for routers (createJobsRouter)
    - nanoid wrapper in lib/id.js for ID strategy abstraction
key-files:
  created:
    - server/lib/id.js
    - server/middleware/upload.js
    - server/routes/jobs.js
  modified:
    - server/index.js
key-decisions:
  - "Multer DiskStorage writes directly to UPLOAD_DIR (Fly Volume path)"
  - "Variations clamped to 1-20 range with default of 5"
  - "Factory function pattern for jobs router (receives db and queries)"
patterns-established:
  - "All job routes require requireAuth middleware"
  - "Upload accepts up to 10 MP4 files, 500MB each, rejects non-MP4"
  - "202 Accepted for job creation (async processing semantics)"
  - "File IDs and job IDs both use nanoid for consistency"
duration: 1m 27s
completed: 2026-02-07
---

# Phase 06 Plan 02: Jobs API Summary

**Multi-file upload endpoint with Multer DiskStorage, job creation in SQLite, and job status/list queries**

## Performance

- **Duration:** 1 minute 27 seconds
- **Started:** 2026-02-07T20:08:12Z
- **Completed:** 2026-02-07T20:09:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Implemented multi-file upload endpoint accepting up to 10 MP4 files (500MB each)
- Created job and file records in SQLite with queued status
- Built job status and job list query endpoints
- Verified full API works end-to-end with curl tests (auth → upload → status → list)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create upload middleware, ID generator, and jobs routes** - `b98cebd` (feat)
2. **Task 2: Mount jobs routes and verify full API locally** - `041712d` (feat)

## Files Created/Modified

- `server/lib/id.js` - nanoid wrapper for generating job and file IDs
- `server/middleware/upload.js` - Multer DiskStorage configured for Fly Volume path (UPLOAD_DIR)
- `server/routes/jobs.js` - POST /api/jobs, GET /api/jobs/:id, GET /api/jobs endpoints with requireAuth
- `server/index.js` - Mounted jobs router at /api/jobs

## Decisions Made

### 1. Multer DiskStorage to UPLOAD_DIR
**Context:** Need to write uploaded files directly to Fly Volume, not /tmp (which is RAM disk on Fly.io).
**Decision:** Configure Multer DiskStorage with destination set to `process.env.UPLOAD_DIR`.
**Rationale:** Follows 06-RESEARCH.md Pattern 3, avoids RAM consumption on Fly.io.
**Impact:** All uploaded files land in /data/uploads on Fly.io, ./data/uploads locally.

### 2. Variations Clamped to 1-20 Range
**Context:** User can specify variationsPerVideo in request body.
**Decision:** Parse as int, default to 5, clamp to range 1-20 using `Math.max(1, Math.min(20, ...))`.
**Rationale:** Prevents resource exhaustion from excessive variations (e.g., 1000 variations per video).
**Impact:** API enforces reasonable limits without rejecting requests.

### 3. Factory Function for Jobs Router
**Context:** Jobs router needs access to db and queries for SQLite operations.
**Decision:** Export `createJobsRouter(db, queries)` factory function that returns a Router.
**Rationale:** Follows established pattern from 06-RESEARCH.md, allows dependency injection.
**Impact:** index.js creates router: `const jobsRouter = createJobsRouter(db, queries)`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. All tasks completed successfully on first attempt.

## Verification Results

All API endpoints tested successfully:

1. ✓ Health endpoint returns 200 with status
2. ✓ Auth endpoint returns bearer token for correct password
3. ✓ Upload endpoint accepts MP4 with token, returns 202 with jobId and file details
4. ✓ Job status endpoint returns job with per-video entries (status: queued)
5. ✓ Job list endpoint returns array with job summaries
6. ✓ Uploaded file exists in UPLOAD_DIR (./data/uploads/), not /tmp
7. ✓ Error cases return proper HTTP status codes:
   - 401 for missing auth
   - 400 for empty upload
   - 404 for nonexistent job

## API Endpoints Delivered

### POST /api/jobs
- **Auth:** Bearer token required
- **Body:** `multipart/form-data` with `videos` files and optional `variations` field
- **Response:** 202 Accepted with jobId, files array, variationsPerVideo, totalVariations, statusUrl
- **Validation:** Rejects if no files uploaded (400), rejects non-MP4 (Multer fileFilter)

### GET /api/jobs/:id
- **Auth:** Bearer token required
- **Response:** Job object with jobId, status, totalVideos, totalVariations, files array, createdAt, expiresAt, error
- **Validation:** Returns 404 if job not found

### GET /api/jobs
- **Auth:** Bearer token required
- **Response:** Array of job summaries (id, status, totalVideos, totalVariations, createdAt)
- **Limit:** 50 most recent jobs (from queries.listJobs)

## Next Phase Readiness

**Ready for Phase 06-03 (Deployment):** ✓

All API routes are implemented and verified locally. The server is ready for Dockerization and deployment to Fly.io.

**Blockers:** None

**Recommendations for 06-03:**
1. Create Dockerfile with node:22-slim base and FFmpeg installation
2. Configure fly.toml with volume mount at /data
3. Set secrets for AUTH_PASSWORD and TOKEN_SECRET via `fly secrets set`
4. Deploy with `fly deploy` and verify live endpoints
5. Test upload endpoint with real MP4 file to verify volume writability on Fly.io

---
*Phase: 06-backend-foundation*
*Completed: 2026-02-07*
