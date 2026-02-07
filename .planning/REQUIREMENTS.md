# Requirements: Video Refresher v2.0

**Defined:** 2026-02-07
**Core Value:** Upload video creatives, get multiple unique variations ready for ad platform rotation — fast, without waiting at the screen.

## v2.0 Requirements

Requirements for server-side multi-video processing milestone. Each maps to roadmap phases.

### Infrastructure

- [ ] **INFRA-01**: Backend deploys to Fly.io as Docker container with Node.js 22 + native FFmpeg
- [ ] **INFRA-02**: Express 5 API server with REST endpoints for jobs, auth, and downloads
- [ ] **INFRA-03**: SQLite database on 3GB Fly Volume for job tracking and session state
- [ ] **INFRA-04**: Shared password authentication with bearer token sessions
- [ ] **INFRA-05**: CORS configuration for Cloudflare Pages frontend

### Processing

- [ ] **PROC-01**: User can upload multiple MP4 source videos in a single batch
- [ ] **PROC-02**: Server processes videos with native FFmpeg using same random effects as v1
- [ ] **PROC-03**: In-process job queue backed by SQLite (no Redis)
- [ ] **PROC-04**: Job status endpoint with per-video progress percentage
- [ ] **PROC-05**: Fire-and-forget — jobs continue processing after browser tab closes
- [ ] **PROC-06**: Job recovery on server restart (interrupted jobs marked and retryable)

### Storage

- [ ] **STOR-01**: Processed videos stored on 3GB Fly Volume with 24-hour auto-expiry
- [ ] **STOR-02**: Automatic eviction of oldest results when storage cap exceeded
- [ ] **STOR-03**: Cleanup daemon runs periodically to enforce time and size limits
- [ ] **STOR-04**: Upload files deleted after processing completes (not held for 24h)

### Download

- [ ] **DOWN-01**: Single streaming ZIP download with all variations organized by source video
- [ ] **DOWN-02**: ZIP uses STORE compression (no re-compression of H.264 video)
- [ ] **DOWN-03**: Download available until job expires (24h) or evicted

### Frontend

- [ ] **FEND-01**: Login screen with shared password input
- [ ] **FEND-02**: Multi-video upload UI (drag-and-drop or file picker for multiple files)
- [ ] **FEND-03**: Variation count input per batch
- [ ] **FEND-04**: Progress display with polling (per-video status)
- [ ] **FEND-05**: Job list page showing all active/completed/expired jobs
- [ ] **FEND-06**: Download button linking to server ZIP endpoint
- [ ] **FEND-07**: Remove FFmpeg.wasm and all client-side processing code

## Future Requirements

Deferred to post-v2.0 milestones.

- **SSE-01**: Server-Sent Events for real-time progress (polling fallback already in v2.0)
- **META-01**: Metadata JSON manifest in ZIP documenting effects applied per variation
- **CANCEL-01**: Job cancellation (kill in-progress FFmpeg, clean up files)
- **RETRY-01**: Retry individual failed videos without re-uploading entire batch
- **RESUME-01**: Resumable uploads for large files over unreliable connections

## Out of Scope

| Feature | Reason |
|---------|--------|
| Per-user accounts | Shared password sufficient for small team |
| Video format conversion (MOV, AVI) | MP4 is standard for ad platforms |
| WebSocket video frame streaming | Progress percentage is enough |
| Cloud object storage (S3/R2) | Fly Volume is sufficient at 3GB |
| Persistent history beyond 24h | Temporary storage model |
| Manual effect selection | Defeats "quick refresh" value prop |
| Horizontal scaling / multi-worker | Single machine sufficient for <10 users |
| Queue priority system | FIFO is fair for small team |
| Video preview/streaming from server | Download and preview locally |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | TBD | Pending |
| INFRA-02 | TBD | Pending |
| INFRA-03 | TBD | Pending |
| INFRA-04 | TBD | Pending |
| INFRA-05 | TBD | Pending |
| PROC-01 | TBD | Pending |
| PROC-02 | TBD | Pending |
| PROC-03 | TBD | Pending |
| PROC-04 | TBD | Pending |
| PROC-05 | TBD | Pending |
| PROC-06 | TBD | Pending |
| STOR-01 | TBD | Pending |
| STOR-02 | TBD | Pending |
| STOR-03 | TBD | Pending |
| STOR-04 | TBD | Pending |
| DOWN-01 | TBD | Pending |
| DOWN-02 | TBD | Pending |
| DOWN-03 | TBD | Pending |
| FEND-01 | TBD | Pending |
| FEND-02 | TBD | Pending |
| FEND-03 | TBD | Pending |
| FEND-04 | TBD | Pending |
| FEND-05 | TBD | Pending |
| FEND-06 | TBD | Pending |
| FEND-07 | TBD | Pending |

**Coverage:**
- v2.0 requirements: 25 total
- Mapped to phases: 0 (awaiting roadmap)
- Unmapped: 25

---
*Requirements defined: 2026-02-07*
*Last updated: 2026-02-07 after initial definition*
