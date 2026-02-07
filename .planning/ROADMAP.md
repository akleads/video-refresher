# Roadmap: Video Refresher

## Milestones

- v1.0 Batch Processing MVP - Phases 1-5 (shipped 2026-02-07)
- v2.0 Server-Side Multi-Video Processing - Phases 6-9 (in progress)

## Phases

<details>
<summary>v1.0 Batch Processing MVP (Phases 1-5) - SHIPPED 2026-02-07</summary>

See MILESTONES.md for v1.0 details.

Phases 1-5 delivered browser-based batch video variation generator with FFmpeg.wasm 0.12.x, unique effect combinations, ZIP download, and memory management -- fully client-side on Cloudflare Pages.

</details>

### v2.0 Server-Side Multi-Video Processing (In Progress)

**Milestone Goal:** Move processing to a backend server on Fly.io, support multiple source videos per batch, and enable fire-and-forget workflow (close tab, return for results).

**Phase Numbering:**
- Integer phases (6, 7, 8, 9): Planned milestone work
- Decimal phases (e.g. 7.1): Urgent insertions if needed

- [x] **Phase 6: Backend Foundation** - API server, database, auth, upload, and Fly.io deployment
- [ ] **Phase 7: FFmpeg Processing Engine** - Server-side video processing with native FFmpeg
- [ ] **Phase 8: Download, Cleanup, and Job Lifecycle** - ZIP download, storage management, expiry, and graceful shutdown
- [ ] **Phase 9: Frontend Integration** - Replace client-side FFmpeg.wasm with API client

## Phase Details

### Phase 6: Backend Foundation
**Goal**: A running Express API on Fly.io that accepts multi-video uploads, authenticates users with a shared password, and persists job state in SQLite -- processing is stubbed but the entire infrastructure is deployed and verified.
**Depends on**: v1.0 (existing frontend on Cloudflare Pages)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, PROC-01, PROC-03
**Success Criteria** (what must be TRUE):
  1. User can POST a shared password to the auth endpoint and receive a bearer token that gates all other endpoints
  2. User can upload multiple MP4 files in a single request and receive a job ID back (HTTP 202)
  3. User can query a job status endpoint with the job ID and see per-video entries in the response (status: queued)
  4. The server is live on Fly.io with a 3GB volume, Docker container runs Node.js 22 + FFmpeg binary, and the health endpoint responds
  5. All uploaded files are written to the Fly Volume (not /tmp), and SQLite database persists across server restarts
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md -- Server foundation: Express 5 app, SQLite database, auth system, health endpoint
- [x] 06-02-PLAN.md -- Jobs API: multi-file upload with Multer, job creation, job status queries
- [x] 06-03-PLAN.md -- Deployment: Dockerfile, fly.toml, deploy to Fly.io, verify live endpoints

### Phase 7: FFmpeg Processing Engine
**Goal**: Uploaded videos are processed into variations using native FFmpeg with the same random effects as v1, with progress tracking and error handling per video -- the core value of v2.
**Depends on**: Phase 6
**Requirements**: PROC-02, PROC-04, PROC-05, PROC-06
**Success Criteria** (what must be TRUE):
  1. After submitting a job via API, output variation files appear on the Fly Volume with visually distinct random effects matching v1 quality (zoom, color, noise, speed, mirror)
  2. Polling the job status endpoint shows per-video progress percentage that advances from 0 to 100 as FFmpeg processes each video
  3. Jobs continue processing after the API client disconnects (fire-and-forget verified by uploading, killing the connection, and polling later to see completion)
  4. If the server restarts mid-processing, interrupted jobs are marked as failed/retryable in SQLite (not silently lost)
  5. A video that fails to process (corrupt input, FFmpeg error) does not block the rest of the batch -- other videos complete normally
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Download, Cleanup, and Job Lifecycle
**Goal**: The backend lifecycle is complete end-to-end -- upload, process, download as ZIP, auto-expire after 24 hours, and evict oldest results when storage is full.
**Depends on**: Phase 7
**Requirements**: STOR-01, STOR-02, STOR-03, STOR-04, DOWN-01, DOWN-02, DOWN-03
**Success Criteria** (what must be TRUE):
  1. User can download a single ZIP file containing all variations organized into folders by source video name, and the ZIP uses STORE compression (no re-compression of H.264)
  2. Download remains available until the job expires (24 hours after completion) or is evicted by storage pressure
  3. Jobs older than 24 hours are automatically deleted (files removed from volume, rows cleaned from SQLite) without manual intervention
  4. When total stored output exceeds the volume cap, the oldest completed jobs are evicted first to make room for new results
  5. Upload source files are deleted from the volume after processing completes (not held for 24 hours)
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

### Phase 9: Frontend Integration
**Goal**: Users interact with the full application through the browser -- login, upload multiple videos, watch progress, see job history, and download results -- with all client-side FFmpeg.wasm code removed.
**Depends on**: Phase 8
**Requirements**: FEND-01, FEND-02, FEND-03, FEND-04, FEND-05, FEND-06, FEND-07
**Success Criteria** (what must be TRUE):
  1. User sees a login screen, enters the shared password, and gains access to the app (invalid password shows an error, not a blank page)
  2. User can drag-and-drop or file-pick multiple MP4 files, set a variation count, and submit a batch -- the UI shows the job was accepted and begins polling for progress
  3. Progress display updates per-video status (queued, processing with percentage, complete, failed) via polling without requiring the tab to stay open
  4. Job list page shows all active, completed, and expired jobs with download buttons for completed jobs and status indicators for in-progress ones
  5. All FFmpeg.wasm code, worker files, and client-side processing logic are removed -- the frontend makes zero references to FFmpeg.wasm and loads no wasm bundles
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 | v1.0 | 8/8 | Complete | 2026-02-07 |
| 6. Backend Foundation | v2.0 | 3/3 | Complete | 2026-02-07 |
| 7. FFmpeg Processing Engine | v2.0 | 0/TBD | Not started | - |
| 8. Download, Cleanup, Job Lifecycle | v2.0 | 0/TBD | Not started | - |
| 9. Frontend Integration | v2.0 | 0/TBD | Not started | - |
