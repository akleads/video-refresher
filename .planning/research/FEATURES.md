# Feature Landscape: Server-Side Multi-Video Batch Processing

**Domain:** Server-side batch video processing with job queuing, fire-and-forget workflows, and temporary result storage
**Researched:** 2026-02-07
**Confidence:** MEDIUM-HIGH (synthesized from web research on job queue patterns, async API design, progress tracking, and temporary storage strategies; verified against multiple sources)

## Research Context

This feature analysis focuses on **v2.0: server-side multi-video batch processing** for an existing video variation generator. v1.0 is fully client-side with FFmpeg.wasm. v2.0 moves processing to a Fly.io server with native FFmpeg, adds multi-video upload, fire-and-forget workflow (close browser, return for results), and temporary storage with automatic eviction.

**Constraints informing this analysis:**
- Server-side native FFmpeg on Fly.io (10-50x faster than wasm)
- SQLite for job/session tracking on Fly Volume
- 1GB temp storage cap + 24-hour auto-expiry
- Shared password authentication for small team (<10 people)
- MP4 input/output only
- Existing effects: rotation, brightness, contrast, saturation (plus zoom, color, noise, speed, mirror from v1)

## Table Stakes

Features users expect from server-side batch video processing. Missing these means the product feels broken or pointless compared to v1.

| Feature | Why Expected | Complexity | Dependencies on Existing | Notes |
|---------|--------------|------------|--------------------------|-------|
| **Multi-video upload** | Core v2 value prop -- upload 3-10 source videos at once, not one at a time | Medium | Extends existing drag-and-drop upload area | Must handle multiple File objects, show per-file upload progress, validate each file independently |
| **Variations per batch** | Users need control over how many variations each source video gets | Low | Existing variation count input (1-20) | Apply same count to all videos in batch, or allow per-video counts (start with global) |
| **Server-side processing** | Core v2 value prop -- offload from browser, 10-50x faster | High | Replaces client-side FFmpeg.wasm pipeline entirely | API: `POST /jobs` with files + config, returns job ID. Server runs native FFmpeg |
| **Job ID and status endpoint** | Users must be able to check "is my job done yet?" | Medium | New -- no job tracking in v1 | `GET /jobs/:id` returns `{status, progress, files, error}`. Standard async request-reply pattern (HTTP 202 Accepted) |
| **Progress tracking (polling)** | Users need to know processing is happening, not stuck | Medium | Extends existing progress bar concept | Minimum viable: poll `GET /jobs/:id` every 2-5 seconds. Shows "Processing video 3/5, variation 2/10..." |
| **Fire-and-forget workflow** | Core v2 differentiator vs v1 -- close tab, come back later | Medium | New -- requires persistent job state in SQLite | Job persists in SQLite across browser sessions. User returns, enters job ID or sees job list, downloads results |
| **Result download (single ZIP)** | Users expect one download for all results, organized by source video | Medium | Extends existing ZIP download (JSZip client-side) to server-side (archiver) | ZIP structure: `source1_name/var1.mp4, source1_name/var2.mp4, source2_name/var1.mp4...` |
| **Temporary result storage** | Results must persist long enough to download (hours, not seconds) | Medium | New -- Fly Volume persistent storage | Store processed videos on Fly Volume. 24h expiry. Serve via `GET /jobs/:id/download` |
| **Storage eviction** | 1GB cap means old results must be cleaned up automatically | Medium | New -- storage management | Two eviction triggers: (1) 24h age-based expiry, (2) oldest-first when 1GB cap hit. Cron or on-write check |
| **Shared password auth** | Prevent unauthorized access to team tool | Low | New -- no auth in v1 | Single shared password (env var). Session cookie or bearer token after auth. Not per-user accounts |
| **Error handling per video** | One bad video should not kill entire batch | Medium | Extends existing error handling | If video 3/5 fails (corrupt, unsupported codec), continue with 4 and 5. Report partial results with per-video error messages |
| **Upload size validation** | Server must reject files that are too large before processing begins | Low | Extends existing client-side 100MB warning | Server-side validation: reject files > X MB (configurable). Return clear error before queuing |

## Differentiators

Features that create workflow advantage. Not strictly required, but make v2 feel polished and worth the migration from v1.

| Feature | Value Proposition | Complexity | Dependencies on Existing | Notes |
|---------|-------------------|------------|--------------------------|-------|
| **Live SSE progress stream** | Real-time progress without polling overhead | Medium | New -- supplements polling fallback | SSE (`text/event-stream`) pushes progress updates to connected clients. Falls back to polling if connection drops. Much better UX than polling every 3s |
| **Job list page** | See all active/completed/expired jobs without remembering IDs | Low | New | `GET /jobs` returns list of recent jobs with status, creation time, download links. Simple HTML table or card layout |
| **Per-source-video folders in ZIP** | Organized output: `video1/var1.mp4, video1/var2.mp4, video2/var1.mp4...` | Low | Extends ZIP download | Use `archiver` with `directory()` support. Users open ZIP and immediately know which variations belong to which source |
| **Resumable upload** | Large files (50-100MB) survive network hiccups during upload | High | New | TUS protocol or chunked upload. Probably overkill for <100MB files on same network. Defer unless users report upload failures |
| **Job cancellation** | Cancel in-progress job to free resources | Medium | Extends existing cancel button concept | `POST /jobs/:id/cancel` kills running FFmpeg processes, cleans up partial results. Important if someone accidentally uploads wrong files |
| **Processing time estimates** | "Estimated 3 minutes remaining" based on first-video speed | Low | New | Measure time for first video in batch, extrapolate for remaining. Show in progress UI and SSE stream |
| **Metadata JSON in ZIP** | Machine-readable manifest of effects applied per variation | Low | Exists conceptually in v1 | `manifest.json` in ZIP root: `{source_videos: [{name, variations: [{filename, effects: {rotation, brightness...}}]}]}` |
| **Retry failed videos** | Re-process only the videos that failed, not entire batch | Medium | Extends error handling | `POST /jobs/:id/retry` re-queues only failed items. Saves time on partial failures |
| **Storage usage indicator** | Show how much of 1GB cap is used, how much available | Low | New | `GET /storage/usage` returns `{used_bytes, total_bytes, percent}`. Display in UI header. Helps team coordinate |
| **Webhook notification** | Notify external system (Slack, etc.) when job completes | Medium | New | Optional `webhook_url` in job config. POST to URL with job status on completion. Nice for automation but probably overkill for small team |

## Anti-Features

Features to explicitly NOT build. Common mistakes when moving from client-side to server-side video processing.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Per-user accounts and quotas** | Project explicitly serves small team (<10). User management adds auth complexity (password hashing, sessions, password reset) for zero value. Shared password is the stated requirement | Single shared password in environment variable. One `POST /auth` endpoint that returns session cookie. No signup, no profiles, no user table |
| **Real-time WebSocket streaming of video frames** | Streaming decoded video frames over WebSocket is bandwidth-intensive and complex. Users do not need to watch video being processed in real-time -- they need a progress percentage | Use SSE for progress percentage updates. Download completed files for preview |
| **Cloud object storage (S3/R2)** | Adds cost, complexity, and external dependency for 1GB of temp storage. Fly Volume is free with the machine, local, and fast | Store files on Fly Volume. If storage needs grow past 1GB, reconsider, but for now local disk is the right call |
| **Persistent job history beyond 24h** | Conflicts with temp storage model. Users process daily ad batches, not archives. Storing history means growing storage forever | 24h expiry with clear messaging: "Results expire in 23h 14m. Download now." |
| **Video format conversion (MOV, AVI, WebM)** | Scope creep. MP4 is standard for ad platforms. Supporting other formats means testing more codecs, handling edge cases, documenting format support | Accept MP4 only. Return clear error for non-MP4: "Please convert to MP4 before uploading" |
| **Manual effect selection per variation** | Defeats "quick refresh" value prop. Users spend 10min configuring instead of 30sec uploading. Random effects are the entire point | Keep effect randomization automatic. Same approach as v1 |
| **Queue priority system** | With <10 users and sequential processing, priority adds complexity for no benefit. Everyone's jobs are equally important | FIFO queue. First submitted, first processed. Simple and fair |
| **Horizontal scaling / multi-worker** | Single Fly.io machine with one FFmpeg process at a time is sufficient for small team. Multi-worker requires Redis, load balancing, shared storage, and dramatically increases infra complexity | Single machine, sequential processing. Native FFmpeg is 10-50x faster than wasm -- a 10-video batch that took 20 minutes client-side takes 1-2 minutes server-side |
| **Video preview/streaming from server** | Serving video for in-browser playback requires range request support, bandwidth, and adds complexity. Users should download and preview locally | Provide download link only. Users preview in their local video player after downloading ZIP |
| **Variation comparison UI** | Complex UI that duplicates what users do in ad platforms anyway. Memory-intensive, hard to build well | Users upload to ad platform and compare performance there. Not our job |
| **Custom effect presets** | Feature creep. Random variations are the point. If users want reproducibility, they should use desktop video editing tools | Keep randomization automatic. Optionally expose effect metadata in manifest.json for reference |

## Feature Dependencies

```
Shared password auth
    |
    v
Multi-video upload -----> Upload size validation
    |
    v
Server-side processing (FFmpeg) -----> Error handling per video
    |
    v
Job ID + SQLite persistence
    |
    +--> Status endpoint (GET /jobs/:id)
    |       |
    |       +--> Progress tracking (polling) --- [independent: SSE live stream]
    |       |
    |       +--> Fire-and-forget (close tab, return later)
    |       |
    |       +--> Job list page
    |
    +--> Result storage on Fly Volume
    |       |
    |       +--> Storage eviction (24h + 1GB cap)
    |       |
    |       +--> Storage usage indicator
    |
    +--> ZIP download (organized by source video)
            |
            +--> Per-source-video folders
            |
            +--> Metadata JSON manifest
```

**Critical path:** Auth --> Upload --> Processing --> Job tracking --> Storage --> Download
**Blockers:** Auth must exist before any API endpoint works. Processing pipeline must work before progress tracking matters.
**Independent:** SSE progress can be added after polling works. Metadata JSON is additive. Storage indicator is additive.

## MVP Recommendation

For v2.0 MVP, prioritize building a complete but minimal pipeline end-to-end before adding polish.

### Must-Have (Table Stakes)

1. **Shared password auth** -- Gate all endpoints. Single password from env var, session cookie
2. **Multi-video upload** -- `POST /jobs` with multipart form data (multiple files + variation count)
3. **Server-side FFmpeg processing** -- Sequential processing, one video at a time, native FFmpeg
4. **Job ID + SQLite tracking** -- Persist job state: `pending -> processing -> completed -> expired`
5. **Status polling endpoint** -- `GET /jobs/:id` with progress percentage and per-video status
6. **Fire-and-forget** -- Job state survives browser close. Return to job list or bookmark status URL
7. **Temporary result storage** -- Save processed videos to Fly Volume with 24h TTL
8. **Storage eviction** -- Cron-style cleanup: delete files >24h old, delete oldest when >1GB
9. **ZIP download** -- `GET /jobs/:id/download` streams ZIP with all variations organized by source video
10. **Error handling per video** -- Partial success: report which videos succeeded and which failed
11. **Upload size validation** -- Reject files above size limit before queuing

### Should-Have (Low-Complexity Differentiators)

12. **SSE progress stream** -- Real-time updates while tab is open, with polling fallback
13. **Job list page** -- `GET /jobs` shows recent jobs with status and download links
14. **Per-source-video folders in ZIP** -- `source1_name/var1.mp4` structure
15. **Processing time estimates** -- Based on first video's processing speed
16. **Metadata JSON in ZIP** -- `manifest.json` documenting effects applied

### Defer to Post-MVP

- **Resumable upload** -- Only needed if users report upload failures
- **Job cancellation** -- Nice but not critical for MVP
- **Retry failed videos** -- Can re-submit entire job for now
- **Storage usage indicator** -- Can check manually via SSH for now
- **Webhook notification** -- No automation need identified yet

### Explicitly Reject

- Per-user accounts and quotas
- WebSocket video frame streaming
- Cloud object storage (S3/R2)
- Persistent history beyond 24h
- Video format conversion
- Manual effect selection
- Queue priority system
- Horizontal scaling / multi-worker
- Video preview/streaming from server
- Variation comparison UI
- Custom effect presets

## Complexity Estimates

| Feature Category | Complexity | Estimate | Notes |
|------------------|------------|----------|-------|
| **Auth (shared password, session)** | Low | 2-4 hours | Express middleware, bcrypt compare, cookie session |
| **Upload endpoint (multipart, validation)** | Medium | 4-6 hours | multer or busboy, file validation, temp storage |
| **Server-side FFmpeg pipeline** | High | 8-12 hours | Port effect randomization from v1, child_process spawn, output management |
| **SQLite job tracking** | Medium | 4-6 hours | Schema design, CRUD operations, state machine |
| **Status/progress endpoint** | Low | 2-3 hours | Query SQLite, format response |
| **SSE progress stream** | Medium | 3-5 hours | EventSource server, client reconnection handling |
| **Temporary storage + eviction** | Medium | 4-6 hours | File management, cleanup scheduler, size tracking |
| **ZIP download (streaming, organized)** | Medium | 4-6 hours | archiver library, folder structure, streaming response |
| **Job list page** | Low | 2-3 hours | Simple HTML page, fetch job list |
| **Frontend rewrite (API client)** | Medium | 6-8 hours | Replace FFmpeg.wasm calls with API calls, upload UI, progress UI, download UI |
| **Error handling + edge cases** | Medium | 4-6 hours | Partial failures, cleanup on crash, graceful shutdown |
| **Docker + Fly.io deployment** | Medium | 3-5 hours | Dockerfile with FFmpeg, fly.toml, volume config |
| **TOTAL MVP** | | **46-70 hours** | |

## Server-Side Job Processing: Expected Behavior Patterns

Based on research of established patterns (BullMQ, async request-reply, Fly.io deployment patterns), here is how server-side batch video processing is expected to work.

### Job Lifecycle State Machine

```
PENDING --> PROCESSING --> COMPLETED --> EXPIRED
                |                           ^
                v                           |
             FAILED -----(24h)------------>-+
                |
                v
          (CANCELLED) [post-MVP]
```

**States:**
- **PENDING**: Job created, files uploaded, waiting for processing slot
- **PROCESSING**: FFmpeg actively working. Progress updated per-video
- **COMPLETED**: All videos processed (or partially -- with per-video error details). Results available for download
- **FAILED**: Entire job failed (e.g., server crash, disk full). Distinct from partial failure
- **EXPIRED**: Results deleted after 24h. Job metadata retained for reference

### API Contract (Expected Pattern)

```
POST /auth
  Body: { password: "shared-secret" }
  Response: Set-Cookie: session=<token>

POST /jobs
  Auth: Cookie session
  Body: multipart/form-data { files[], variationCount: 10 }
  Response: 202 Accepted
  {
    jobId: "abc123",
    status: "pending",
    statusUrl: "/jobs/abc123",
    downloadUrl: "/jobs/abc123/download",
    videosCount: 3,
    variationsPerVideo: 10,
    totalVariations: 30
  }

GET /jobs/:id
  Response: 200 OK
  {
    jobId: "abc123",
    status: "processing",
    progress: {
      currentVideo: 2,
      totalVideos: 3,
      currentVariation: 5,
      totalVariations: 10,
      overallPercent: 50
    },
    videos: [
      { name: "ad1.mp4", status: "completed", variations: 10 },
      { name: "ad2.mp4", status: "processing", currentVariation: 5 },
      { name: "ad3.mp4", status: "pending" }
    ],
    createdAt: "2026-02-07T10:00:00Z",
    expiresAt: "2026-02-08T10:00:00Z"
  }

GET /jobs/:id/download
  Response: 200 OK (Content-Type: application/zip, streamed)
  Only available when status is "completed"

GET /jobs
  Response: 200 OK
  { jobs: [...] }  // List of user's recent jobs

GET /jobs/:id/progress  (SSE endpoint)
  Response: text/event-stream
  data: { percent: 50, message: "Processing ad2.mp4 variation 5/10" }
```

### Fire-and-Forget UX Flow

```
1. User opens tool, authenticates with shared password
2. User uploads 3 MP4 files, sets 10 variations
3. Server responds with job ID and status URL
4. User sees progress (SSE stream if tab open, polling otherwise)
5. User closes browser tab (or laptop)
    --> Job continues processing on server
6. User returns hours later
    --> Opens tool, sees job list
    --> Job shows "Completed" with download link
    --> Clicks download, gets ZIP
7. After 24 hours, results auto-expire
    --> Job shows "Expired" in list
    --> Download link returns 410 Gone
```

### Progress Tracking Strategy

**Recommendation: SSE primary, polling fallback.**

SSE (Server-Sent Events) is the right choice for this use case because:
- Unidirectional (server to client) -- we only need to push progress, not receive input
- Automatic reconnection built into EventSource API
- Simpler than WebSocket (no handshake protocol, no ping/pong)
- Works behind most proxies and load balancers
- Falls back gracefully: if SSE connection drops, client switches to polling `GET /jobs/:id`

**Not WebSocket** because:
- Bidirectional not needed
- More complex server implementation
- Overkill for progress percentage updates

**Not polling-only** because:
- 2-5 second polling delay feels sluggish for progress updates
- Unnecessary HTTP overhead for active monitoring
- SSE is trivial to implement with Express (set headers, write to response)

### Storage Eviction Strategy

**Two-trigger eviction model:**

1. **Time-based (primary):** Delete files older than 24 hours
   - Run cleanup check every 15 minutes via `setInterval`
   - Query SQLite: `SELECT * FROM jobs WHERE created_at < datetime('now', '-24 hours') AND status != 'expired'`
   - Delete associated files from disk
   - Update job status to 'expired'

2. **Space-based (secondary):** When total storage exceeds 1GB, delete oldest first
   - Check total storage on each job completion
   - If over 1GB, find oldest completed/expired jobs and delete until under threshold
   - LRU-like: oldest results go first regardless of 24h window

**Why not Redis TTL or cron:** SQLite + `setInterval` is simpler, zero-dependency, and sufficient for single-machine deployment. No need for external scheduler.

### ZIP Structure

```
batch_abc123.zip
  |-- ad_creative_1/
  |     |-- ad_creative_1_var01_a1b2c3.mp4
  |     |-- ad_creative_1_var02_d4e5f6.mp4
  |     |-- ad_creative_1_var03_g7h8i9.mp4
  |
  |-- ad_creative_2/
  |     |-- ad_creative_2_var01_j0k1l2.mp4
  |     |-- ad_creative_2_var02_m3n4o5.mp4
  |     |-- ad_creative_2_var03_p6q7r8.mp4
  |
  |-- manifest.json
```

**Use `archiver` (not JSZip)** for server-side ZIP creation because:
- archiver is designed for Node.js server-side streaming
- Supports piping directly to HTTP response (no temp ZIP file needed)
- JSZip is designed for browser environments
- archiver handles folder structure natively via `directory()` method
- STORE compression (no re-compression of already-compressed H.264 video)

## Domain-Specific Insights

### What Changes from v1 to v2

| Aspect | v1 (Client-Side) | v2 (Server-Side) |
|--------|-------------------|-------------------|
| Processing speed | 60s per video (wasm) | 2-5s per video (native FFmpeg) |
| Memory constraint | Browser ~2GB limit | Server 256MB-1GB (Fly machine) |
| Concurrency | One video at a time (browser lock) | One at a time (by choice, not limitation) |
| Result persistence | Gone when tab closes | 24h on server |
| User waiting | Must keep tab open | Close tab, return later |
| Multi-video | Upload one, process one | Upload many, process all |
| ZIP creation | Client-side (JSZip, memory-limited) | Server-side (archiver, streaming) |

### What Users Actually Need from Batch Processing

Based on ad creative refresh workflow patterns:

- **Speed over configurability** -- Upload files, set count, click go. Done in 1-2 minutes server-side vs 20 minutes client-side
- **Reliability over features** -- Job must not silently fail. Clear status: working, done, or failed with reason
- **Organized output** -- ZIP with folders per source video. Not 30 loose files with cryptic names
- **Forgettable workflow** -- Submit job, walk away, come back when convenient. No anxiety about browser crashing
- **Partial success** -- If 1 of 5 videos is corrupt, process the other 4 and report the failure

### What Users Do NOT Need

- Fine-grained job management (pause, resume, reorder queue)
- Historical job analytics or reporting
- Video preview on server (download and preview locally)
- Collaboration features (shared job history, comments)
- Scheduled/recurring jobs (ad hoc use only)

## Open Questions

1. **Should job IDs be memorable or opaque?** Short alphanumeric (e.g., `abc123`) is easier to share verbally than UUID. But UUIDs prevent guessing. For shared-password tool, short IDs are fine -- security is at the auth layer, not the job ID layer.

2. **Should expired jobs show in job list?** Showing "Expired" status helps users understand the system. Recommend: keep job metadata in SQLite indefinitely (tiny), delete only the video files after 24h. List shows all jobs with status.

3. **Should users be able to re-download before expiry?** Yes -- download should be idempotent. ZIP can be re-generated on each download (streaming from stored files) or cached as a pre-built ZIP. Recommend: store individual variation files, generate ZIP on download request (avoids storing 2x the data).

4. **What happens if server restarts mid-processing?** Jobs in PROCESSING state should be detected on startup and either retried or marked FAILED. SQLite persists across restarts (on Fly Volume). FFmpeg child processes will die, but job state should recover.

5. **Should upload and processing be synchronous or asynchronous?** Asynchronous. Upload saves files and creates PENDING job. Processing happens in background. This is the standard async request-reply pattern (HTTP 202 Accepted).

## Sources

### HIGH Confidence (official documentation, established patterns)

- [Fly.io Volumes documentation](https://fly.io/docs/volumes/overview/) -- persistent storage on Fly.io
- [Fly.io database/storage guides](https://fly.io/docs/database-storage-guides/) -- SQLite on Fly volumes
- [archiver npm package](https://www.npmjs.com/package/archiver) -- server-side streaming ZIP creation
- [BullMQ documentation](https://docs.bullmq.io/guide/queues) -- job queue patterns (referenced for design, not used directly)
- [HTTP 202 Accepted pattern](https://apidog.com/blog/status-code-202-accepted/) -- async request-reply API design

### MEDIUM Confidence (multiple sources agree, verified patterns)

- [SSE vs WebSocket vs Polling comparison (2025)](https://dev.to/haraf/server-sent-events-sse-vs-websockets-vs-long-polling-whats-best-in-2025-5ep8) -- SSE recommended for unidirectional progress
- [SSE beats WebSocket for 95% of apps](https://dev.to/polliog/server-sent-events-beat-websockets-for-95-of-real-time-apps-heres-why-a4l) -- SSE suitability for progress tracking
- [better-queue-sqlite npm](https://www.npmjs.com/package/better-queue-sqlite) -- SQLite job queue option (if needed)
- [node-sqlite-queue](https://github.com/sinkhaha/node-sqlite-queue) -- SQLite-backed job queue
- [Bulk API design patterns](https://www.mscharhag.com/api-design/bulk-and-batch-operations) -- batch endpoint design
- [Batch upload endpoint patterns](https://doc.nuxeo.com/nxdoc/batch-upload-endpoint/) -- multi-file upload with batch ID
- [File upload UX best practices (2025)](https://www.portotheme.com/10-file-upload-system-features-every-developer-should-know-in-2025/) -- drag-and-drop, progress, validation
- [Fire-and-forget in Node.js](https://medium.com/@dev.chetan.rathor/understanding-fire-and-forget-in-node-js-what-it-really-means-a83705aca4eb) -- background processing patterns
- [Streaming ZIP to browser in Express](https://codepunk.io/how-to-stream-a-zip-file-to-the-browser-in-express-and-node-js/) -- server-side ZIP streaming

### LOW Confidence (single sources, need validation)

- Processing time estimates (10-50x speedup native vs wasm) -- widely cited but not benchmarked for this specific workload
- 1GB storage sufficiency -- depends on output file sizes and team usage patterns; may need adjustment

---

*This research supersedes the v1 FEATURES.md which focused on client-side batch processing. v2 fundamentally changes the architecture from browser-based to server-based, making most v1 feature concerns (browser memory, blob URL management, FFmpeg.wasm limitations) irrelevant.*
