# Project Research Summary

**Project:** Video Refresher v2.0 -- Server-Side Migration
**Domain:** Server-side batch video processing with job queuing on Fly.io
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

Video Refresher v2.0 migrates from client-side FFmpeg.wasm processing to a server-side Node.js + native FFmpeg backend on Fly.io, while keeping the static frontend on Cloudflare Pages. This is a well-understood architecture: a REST API accepts multi-video uploads, queues them for sequential processing by native FFmpeg, tracks job state in SQLite on a persistent Fly Volume, and serves results as streaming ZIP downloads. The stack is deliberately minimal -- 7 production dependencies, no build step, no TypeScript, no ORM, no Redis. Every technology choice is validated against npm/official sources with HIGH confidence.

The recommended approach is a two-tier architecture: Cloudflare Pages serves the static frontend (existing, free), and a single Fly.io Machine (shared-cpu-2x, 512MB RAM, persistent volume) runs Express 5 + native FFmpeg via `child_process.spawn()`. SQLite via better-sqlite3 serves as both the application database and job queue, eliminating the need for Redis/BullMQ entirely. Processing is sequential (one FFmpeg process at a time) which is correct for a single-machine, sub-10-user deployment. The fire-and-forget UX is achieved through persistent job state in SQLite -- users upload, close their tab, and return later to download results.

The primary risks are infrastructure-level, not code-level. The most dangerous pitfalls are: (1) writing temp files to `/tmp` on Fly.io, which is a RAM disk that will OOM-kill the machine; (2) auto-stop killing the machine mid-processing when users close their browser tab; (3) the 1GB volume being insufficient for realistic batch workloads (peak usage for one batch can hit 1.2GB). All three have straightforward mitigations documented in the research. The storage budget is the decision that needs the most attention -- 1GB is too tight and should be increased to 3GB.

## Key Findings

### Recommended Stack

Seven production dependencies. No build step. No Redis. No ORM. No TypeScript. See [STACK.md](STACK.md) for full rationale.

**Core technologies:**
- **Node.js 22 LTS**: Server runtime -- current LTS, built-in fetch/WebSocket/watch, same ecosystem as existing frontend JS
- **Express 5.x**: HTTP server -- mature file upload ecosystem via Multer, async error handling built-in, 5 REST endpoints
- **Multer 1.4.x**: File upload -- streams directly to disk (not memory), critical for 100MB+ video files
- **Native FFmpeg via child_process.spawn**: Video processing -- 10-50x faster than FFmpeg.wasm, fluent-ffmpeg is archived/deprecated (May 2025)
- **better-sqlite3 12.6.x**: Job tracking + queue -- synchronous API, zero-cost file DB on Fly Volume, no Redis needed
- **archiver 7.0.x**: ZIP packaging -- streaming to HTTP response, STORE compression for video (no re-compression)
- **nanoid 5.x**: Job/file IDs -- short, URL-safe, collision-resistant

**Infrastructure:**
- **Fly.io**: shared-cpu-2x, 512MB RAM, 1GB volume (recommend increasing to 3GB), ~$5-8/month
- **Docker**: node:22-slim + apt-get FFmpeg, single-stage build, ~300-400MB image
- **Auth**: `crypto.timingSafeEqual` against env var shared password (no bcrypt, no JWT, no user accounts)

**Explicitly rejected:** Redis/BullMQ, TypeScript, Prisma/Drizzle, WebSocket for progress, S3/R2, fluent-ffmpeg, PM2, dotenv.

### Expected Features

See [FEATURES.md](FEATURES.md) for full feature landscape, dependency graph, and complexity estimates.

**Must have (table stakes) -- 11 features, ~46-70 hours total:**
- Multi-video upload (3-10 sources per batch)
- Server-side FFmpeg processing with per-video error handling
- Job ID + SQLite persistence with status polling endpoint
- Fire-and-forget workflow (close tab, return for results)
- Temporary result storage with 24h expiry + 1GB cap eviction
- Organized ZIP download (folders per source video)
- Shared password auth gating all endpoints
- Upload size validation (reject before queuing)

**Should have (low-complexity differentiators):**
- SSE progress stream (real-time updates while tab open, polling fallback)
- Job list page (see all active/completed/expired jobs)
- Processing time estimates (extrapolate from first video)
- Metadata JSON manifest in ZIP

**Defer to post-MVP:**
- Resumable upload, job cancellation, retry failed videos, storage usage indicator, webhook notifications

**Explicitly reject:**
- Per-user accounts, WebSocket frame streaming, cloud object storage, persistent history, video format conversion, manual effect selection, queue priority, horizontal scaling, video preview/streaming, comparison UI, custom presets

### Architecture Approach

Two-tier architecture: static Cloudflare Pages frontend talks to a single Fly.io Machine backend over HTTPS REST. See [ARCHITECTURE.md](ARCHITECTURE.md) for component details, data flow diagrams, and build order.

**Major components (8 total):**
1. **Express API Server** -- 5-8 REST endpoints, foundation for everything
2. **File Upload Handler (Multer)** -- streams to Fly Volume disk, never memory
3. **SQLite Job Queue (better-sqlite3)** -- persists job state, enables fire-and-forget
4. **FFmpeg Processing Engine** -- `child_process.spawn`, progress parsing from stderr
5. **In-Process Job Worker** -- sequential FIFO processing, polls SQLite every 2s
6. **Authentication Middleware** -- HMAC bearer tokens, 24h expiry
7. **Cleanup Scheduler** -- hourly deletion of expired jobs and orphaned files
8. **Modified Frontend** -- ~400 LOC API client replacing ~1000 LOC FFmpeg.wasm code

**Key patterns:** Disk-based processing (Node.js never touches video bytes), streaming ZIP download (never buffer entire ZIP), polling with exponential backoff, graceful SIGTERM shutdown.

**Anti-patterns to avoid:** Memory-buffered uploads, reading FFmpeg output into Node buffers, SSE with Fly.io auto-stop, fluent-ffmpeg, multi-machine deployment.

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for all 17 pitfalls with detailed prevention and detection strategies.

**Top 5 (all CRITICAL severity):**

1. **Fly.io /tmp is a RAM disk** -- Writing uploaded videos to `/tmp` eats RAM and OOM-kills the machine. Always write to the Fly Volume path (`/data/`). Set `TMPDIR=/data/tmp/` in Dockerfile.
2. **Auto-stop kills machine mid-processing** -- Fire-and-forget means no active HTTP connections, so Fly.io thinks the machine is idle. Mitigate by setting `min_machines_running = 1` or disabling auto-stop entirely (~$2-3/month cost).
3. **1GB volume is too small** -- One batch (3 sources x 10 variations x 20MB avg) peaks at ~1.28GB counting source + output + working files. Increase volume to 3GB minimum. Stream ZIPs to response (never write to disk).
4. **Deploy kills in-progress jobs** -- `fly deploy` destroys and recreates the machine. Implement SIGTERM handler that marks jobs as interrupted. Set `kill_timeout = 300`. Check for active jobs before deploying.
5. **FFmpeg stderr pipe buffer deadlock** -- FFmpeg writes verbose output to stderr. If not consumed, the 64KB pipe buffer fills and FFmpeg blocks forever. Always attach a `stderr.on('data')` handler or set stdio to `'ignore'`.

## Implications for Roadmap

Based on combined research, the architecture has a clean dependency chain that dictates a 5-phase build order. Each phase produces a testable artifact and addresses specific pitfalls.

### Phase 1: Backend Foundation (API + DB + Auth + Deploy)

**Rationale:** Everything depends on the API contract and data persistence layer existing first. Auth gates all endpoints. SQLite schema defines the data model for all subsequent phases. Deploying to Fly.io immediately validates the infrastructure (volume, Docker, FFmpeg binary) before writing complex processing logic.
**Delivers:** Running Express server on Fly.io with SQLite, Multer uploads to volume, bearer token auth, health check endpoint. Jobs can be created and queried but not processed (processing is stubbed).
**Features addressed:** Shared password auth, multi-video upload, job ID + SQLite tracking, upload size validation
**Pitfalls to avoid:** /tmp RAM disk trap (Pitfall 1), memory buffering (Pitfall 2), SQLite WAL mode (Pitfall 7), FFmpeg binary not found in Docker (Pitfall 12), HTTPS enforcement (Pitfall 13)
**Stack elements:** Express 5, Multer, better-sqlite3, nanoid, cors, Dockerfile, fly.toml

### Phase 2: FFmpeg Processing Engine

**Rationale:** Core value proposition of v2. Once the API skeleton exists and is deployed, add the processing engine that turns uploaded videos into variations. This is the highest-risk phase technically (FFmpeg spawn, progress parsing, error handling per video).
**Delivers:** Working video processing -- submit a job via API, FFmpeg processes it, output files appear on volume, progress updates written to SQLite.
**Features addressed:** Server-side FFmpeg processing, error handling per video, variations per batch
**Pitfalls to avoid:** Pipe buffer deadlock (Pitfall 8), thread oversubscription on shared CPU (Pitfall 6), filter syntax differences native vs wasm (Pitfall 16)
**Stack elements:** child_process.spawn, native FFmpeg in Docker

### Phase 3: Download, Cleanup, and Job Lifecycle

**Rationale:** Completes the backend lifecycle: upload -> process -> download -> expire. Without cleanup, the volume fills within days. Without download, processing is pointless. This phase makes the backend fully functional and testable end-to-end via curl.
**Delivers:** Streaming ZIP download, 24h auto-expiry, storage cap enforcement, graceful shutdown on SIGTERM, restart recovery (interrupted jobs re-queued).
**Features addressed:** Result download (ZIP), temporary storage with eviction, fire-and-forget persistence, per-source-video folders
**Pitfalls to avoid:** ZIP doubles storage (Pitfall 15), no cleanup daemon (Pitfall 11), auto-stop kills jobs (Pitfall 3), deploy job loss (Pitfall 5), volume undersized (Pitfall 4)
**Stack elements:** archiver, node-cron

### Phase 4: Frontend Integration

**Rationale:** Backend is now feature-complete and testable via curl. Frontend can be rewritten as a thin API client without risk of backend API changes. This phase is the largest UX change -- removing all FFmpeg.wasm code and replacing it with fetch/FormData API calls.
**Delivers:** Working end-to-end application in the browser -- login screen, multi-file upload, polling progress bar, download button, job list page.
**Features addressed:** Fire-and-forget UX, progress tracking (polling with exponential backoff), job list page
**Pitfalls to avoid:** Still loading FFmpeg.wasm bundles (Pitfall 14), wrong error UX for server errors vs client errors (Pitfall 17)
**Stack elements:** Fetch API, FormData, existing CSS/HTML with modifications

### Phase 5: Production Hardening and Polish

**Rationale:** System works end-to-end. Final phase is production validation of fire-and-forget (close tab, return for results), auto-stop/start behavior, graceful deploys, and optional polish features.
**Delivers:** Production-hardened system with verified fire-and-forget workflow, validated auto-stop interaction, and optional enhancements (SSE progress, time estimates, metadata manifest).
**Features addressed:** SSE progress stream (optional), processing time estimates (optional), metadata JSON manifest in ZIP (optional)
**Pitfalls to avoid:** Cold start latency (Pitfall 9), deploy downtime (Pitfall 5), auto-stop + polling interaction (Pitfall 3)

### Phase Ordering Rationale

- **Phases are strictly sequential.** Each phase produces a testable artifact that the next phase builds on.
- **Deploy-first approach.** Phase 1 includes Fly.io deployment so infrastructure problems (volume mount, FFmpeg binary, Docker build) surface immediately rather than at the end.
- **Risk front-loading.** Phase 2 (FFmpeg processing) is the highest-risk technical work and comes second so problems surface early, before the frontend is built.
- **Cleanup before frontend.** Phase 3 ensures storage management works before team usage begins. A full volume is worse than a missing UI feature.
- **Frontend is a thin client.** By the time Phase 4 starts, the entire backend is curl-verified. Frontend work is purely UI/UX with no architectural risk.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 1:** Fly.io volume mount verification, CORS between Cloudflare Pages and Fly.io, Express 5 + Multer disk storage integration. Consider `/gsd:research-phase` for Fly.io-specific Docker + volume setup.
- **Phase 2:** FFmpeg filter chain porting from v1 `app.js` to native FFmpeg 7.x (version differences in filter syntax, defaults, color space handling). Must test every effect combination. May need phase-level research if filters diverge.

**Phases with well-documented patterns (skip research):**
- **Phase 3:** Streaming ZIP with archiver and cron-based cleanup are standard Node.js patterns. SIGTERM handling well-documented.
- **Phase 4:** Standard fetch/FormData API client work. No novel patterns.
- **Phase 5:** Standard Fly.io deployment validation. Well-documented in official docs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm/official sources. Express 5 stable (5.2.1), better-sqlite3 v12.6.2 (Jan 2026), fluent-ffmpeg deprecation confirmed. |
| Features | MEDIUM-HIGH | Feature set synthesized from job queue patterns, async API design, and domain knowledge. Complexity estimates (46-70h total) need validation during implementation. |
| Architecture | HIGH | Two-tier architecture is standard. Component boundaries well-defined. Fly.io deployment patterns verified against official docs and community examples. |
| Pitfalls | HIGH | 11 of 17 pitfalls verified against official documentation or community reports with linked sources. Remaining 6 are standard engineering patterns with high confidence. |

**Overall confidence:** HIGH

### Gaps to Address

- **Volume size: 1GB vs 3GB.** Research strongly recommends 3GB minimum. The arithmetic is clear: one batch of 3 sources x 10 variations at 20MB average peaks at ~1.28GB. This must be decided before Phase 1 creates the Fly Volume. Recommendation: use 3GB ($0.45/month instead of $0.15/month).
- **Auto-stop vs always-on.** Research recommends `min_machines_running = 1` or disabling auto-stop entirely. This trades ~$2-3/month for zero risk of mid-processing machine kills. Recommendation: set `min_machines_running = 1` and revisit after observing actual usage patterns.
- **FFmpeg filter parity (native vs wasm).** The exact visual output of effect filters may differ between FFmpeg.wasm (based on FFmpeg 5-6.x) and native FFmpeg 7.x. Needs empirical testing during Phase 2 with actual ad creative files.
- **Processing speed claims.** The 10-50x speedup of native FFmpeg over wasm is widely cited but not benchmarked for this specific workload (short ad creatives with rotation/brightness/contrast/saturation effects). Will be validated empirically in Phase 2.
- **SSE vs polling for progress.** Architecture research recommends polling (simpler, works with auto-stop). Features research recommends SSE as a differentiator. Recommendation: implement polling in Phase 4, add SSE in Phase 5 only if polling UX feels sluggish.
- **Dockerfile base image.** STACK.md recommends `node:22-slim` (Debian). ARCHITECTURE.md draft mentions `node:20-alpine`. Use `node:22-slim` -- it avoids Alpine build toolchain issues with better-sqlite3 native addon and uses the correct Node.js LTS version.

## Sources

### Primary (HIGH confidence)
- [Express 5 release](https://expressjs.com/2025/03/31/v5-1-latest-release.html) -- Express 5 now default on npm
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.6.2, Jan 2026
- [Fly.io Volumes overview](https://fly.io/docs/volumes/overview/) -- volume/machine 1:1 mapping
- [Fly.io Autostop/Autostart](https://fly.io/docs/launch/autostop-autostart/) -- auto-stop behavior
- [Fly.io Machine Sizing](https://fly.io/docs/machines/guides-examples/machine-sizing/) -- shared-cpu behavior
- [Fly.io Deploy Docs](https://fly.io/docs/launch/deploy/) -- deployment with volumes
- [fluent-ffmpeg archived](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324) -- archived May 2025
- [Multer docs](https://expressjs.com/en/resources/middleware/multer.html) -- DiskStorage engine
- [Node.js child_process](https://nodejs.org/api/child_process.html) -- spawn pipe buffer behavior
- [SQLite WAL mode](https://sqlite.org/wal.html) -- concurrent access

### Secondary (MEDIUM confidence)
- [SSE vs WebSocket comparison](https://dev.to/haraf/server-sent-events-sse-vs-websockets-vs-long-polling-whats-best-in-2025-5ep8) -- SSE for progress
- [Fly.io community: FFmpeg speed](https://community.fly.io/t/speedup-ffmpeg-video-processing/23584) -- burst CPU
- [Fly.io community: /tmp is RAM disk](https://community.fly.io/t/tmp-storage-and-small-volumes/9854) -- tmpfs behavior
- [Fly.io community: long-running tasks + auto-stop](https://community.fly.io/t/handling-long-running-tasks-with-automatic-machine-shutdown-on-fly-io/24256) -- job loss
- [HTTP 202 Accepted pattern](https://apidog.com/blog/status-code-202-accepted/) -- async request-reply

### Tertiary (LOW confidence, needs validation)
- Processing speedup claims (10-50x native vs wasm) -- not benchmarked for this workload
- 1GB storage sufficiency -- arithmetic says insufficient, needs real-world validation
- Auto-stop + polling interaction -- should work per docs, needs testing on Fly.io

---
*Research completed: 2026-02-07*
*Supersedes v1.0 client-side research summary (2026-02-06)*
*Ready for roadmap: yes*
