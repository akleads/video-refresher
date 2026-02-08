# Video Refresher

## What This Is

A video variation generator for ad creative rotation. Upload multiple MP4 videos, specify how many variations you need, and get uniquely "refreshed" versions with random visual effects — all processed server-side with native FFmpeg on Fly.io. Small team tool with shared password access, temporary result storage (3GB / 24h), and single ZIP download for all outputs.

## Core Value

Upload video creatives, get multiple unique variations ready for ad platform rotation — fast, without waiting at the screen.

## Requirements

### Validated

- ✓ Upload MP4 video files via click or drag-and-drop — v1.0
- ✓ Apply random visual effects (zoom, color, noise, speed, mirror) to videos — v1.0
- ✓ Preview original and processed videos in browser — v1.0
- ✓ Download individual processed videos — v1.0
- ✓ Queue multiple files for sequential processing — v1.0
- ✓ Progress indication during processing — v1.0
- ✓ File size validation with user warnings (>100MB) — v1.0
- ✓ Deployed to Cloudflare Pages with required COOP/COEP headers — v1.0
- ✓ User can specify number of variations (1-20) via number input — v1.0
- ✓ Each variation receives unique random effect combination — v1.0
- ✓ All variations downloadable as single ZIP file — v1.0
- ✓ Processing speed optimized with ultrafast preset and buffer reuse — v1.0
- ✓ Memory management with BlobURLRegistry, bounded arrays, eviction — v1.0
- ✓ FFmpeg instance recovery from corruption errors — v1.0
- ✓ Upload multiple source videos in a single batch — v2.0
- ✓ Server-side FFmpeg processing on Fly.io — v2.0
- ✓ Job queue with progress tracking (live + async polling) — v2.0
- ✓ Temporary result storage with 3GB cap and 24-hour expiry — v2.0
- ✓ Automatic eviction of oldest results when storage limit hit — v2.0
- ✓ Single ZIP download with all variations organized by source video — v2.0
- ✓ Shared password authentication for team access — v2.0
- ✓ Fire-and-forget UX — close tab, return to results later — v2.0

### Active

- [ ] Toggle on upload page: "Process on device" vs "Send to server"
- [ ] Device processing with FFmpeg.wasm in browser (multi-threaded, ZIP download)
- [ ] COOP/COEP headers restored for SharedArrayBuffer support
- [ ] Cancel in-progress server jobs (kill FFmpeg, clean up files)

### Out of Scope

- Video format support beyond MP4 — MP4 is standard for ad platforms
- Mobile app — web-only
- Manual effect selection per variation — defeats "quick refresh" value prop
- Individual user accounts — shared password sufficient for small team
- Persistent history beyond 24 hours — temporary storage is the model
- Real-time WebSocket streaming of video frames — progress percentage is enough
- Horizontal scaling / multi-worker — single machine sufficient for <10 users

## Context

- v1.0 ran entirely client-side with FFmpeg.wasm 0.12.14 on Cloudflare Pages
- v2.0 moved processing to server-side native FFmpeg on Fly.io (10-50x faster than wasm)
- Frontend is now an API-driven SPA with hash routing, no framework (vanilla JS ES modules)
- Server: Express 5 + SQLite (WAL mode) + native FFmpeg via child_process.spawn
- Docker container (node:22-slim) deployed to Fly.io with 3GB persistent volume
- HMAC bearer token auth with 24h sessions, shared password via AUTH_PASSWORD env var
- Cleanup daemon: 24h expiry + 85% storage eviction at 5-minute intervals
- 5,708 LOC total (3,627 server + 1,989 frontend + config)
- v2.0 removed all FFmpeg.wasm code — v3.0 brings it back as an option alongside server processing
- COOP/COEP headers removed in v2.0, will be restored in v3.0 for SharedArrayBuffer

## Constraints

- **Platform**: Fly.io for backend, Cloudflare Pages for frontend
- **Cost**: Small Fly machine + volume (~$5-10/month)
- **Storage**: 3GB Fly Volume for processed videos + 24-hour auto-expiry
- **File format**: MP4 input and output only
- **Auth**: Shared password — no user management complexity
- **Team size**: Small team (< 10 people), no need for per-user quotas

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep processing client-side (v1) | No backend infrastructure to maintain, zero hosting costs beyond static CDN | ✓ Good |
| ZIP download for bulk variations | User processes 5-20 variations; individual downloads impractical at scale | ✓ Good |
| Random effect mix per variation | Each variation needs to appear unique to ad platform algorithms | ✓ Good |
| Use jsdelivr CDN for FFmpeg.wasm 0.12.x | Proven compatibility with worker files vs esm.sh | ✓ Good |
| Self-host FFmpeg class worker | CDN blob URLs break due to relative ES module imports in worker.js | ✓ Good |
| Cap processedVideos at 20 | Balances memory usage with user experience | ✓ Good |
| Ultrafast encoding preset for all videos | Speed over marginal quality for ad creative workflows | ✓ Good |
| Sequential batch processing | Avoid FFmpeg instance conflicts and CPU thrashing | ✓ Good |
| Orchestration-layer cancellation | FFmpeg.wasm 0.12.x doesn't expose mid-encoding abort API | ✓ Good |
| STORE compression for ZIP | Videos already H.264 compressed; re-compression wastes CPU | ✓ Good |
| Copy buffer before ffmpeg.writeFile | postMessage transfers neuter original ArrayBuffer | ✓ Good |
| Move to server-side FFmpeg (v2) | Workflow convenience — close browser, come back to results; also 10-50x faster | ✓ Good |
| Fly.io + SQLite | User already uses Fly.io; SQLite is zero-cost and sufficient for job tracking | ✓ Good |
| 3GB storage + 24h expiry | Keeps costs low, forces regular cleanup, sufficient for daily ad workflow | ✓ Good |
| Shared password auth (HMAC) | Small team, no need for user management complexity; zero deps | ✓ Good |
| child_process.spawn for FFmpeg | fluent-ffmpeg archived May 2025; direct spawn is simpler | ✓ Good |
| node:22-slim Docker base | better-sqlite3 native addon needs glibc (not Alpine musl) | ✓ Good |
| SQLite WAL mode | Concurrent reads during writes, prevents SQLITE_BUSY | ✓ Good |
| XHR for file uploads | Enables upload progress events via xhr.upload (fetch lacks this) | ✓ Good |
| createElement for all DOM | Prevents XSS vulnerabilities, no innerHTML in user-facing views | ✓ Good |
| Adaptive polling (2s → 10s backoff) | Active job monitoring needs fast initial updates, backs off to reduce load | ✓ Good |
| Page Visibility API for polling | Pause background polls when tab hidden — battery and bandwidth efficiency | ✓ Good |

---
*Last updated: 2026-02-08 after v3.0 milestone start*
