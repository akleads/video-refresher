# Video Refresher

## What This Is

A video variation generator for ad creative rotation. Upload MP4 or MOV videos, choose to process on-device (FFmpeg.wasm) or send to server (native FFmpeg on Fly.io), specify how many variations you need, and get uniquely "refreshed" MP4 versions with random visual effects. Small team tool with shared password access, temporary server result storage (3GB / 24h), and single ZIP download for all outputs.

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
- ✓ Toggle on upload page: "Process on device" vs "Send to server" — v3.0
- ✓ Device processing with FFmpeg.wasm in browser (multi-threaded, ZIP download) — v3.0
- ✓ COOP/COEP headers restored for SharedArrayBuffer support — v3.0
- ✓ Cancel in-progress server jobs (kill FFmpeg, clean up files) — v3.0

### Active

## Current Milestone: v4.0 Polish & Format Support

**Goal:** Add MOV input support, unify device/server job history, improve visual polish, and add quality-of-life features (notifications, thumbnails).

**Target features:**
- MOV input support (output always MP4)
- Device-processed jobs upload results to server and appear in job history
- Visual polish: better spacing, cleaner cards, improved drop zone, CSS variables
- Job card improvements: show source filenames, fix layout/alignment
- Browser notifications when server jobs complete
- Video thumbnails in job history

### Out of Scope

- Video format support beyond MP4/MOV — these two cover ad platform needs
- Mobile app — web-only
- Manual effect selection per variation — defeats "quick refresh" value prop
- Individual user accounts — shared password sufficient for small team
- Persistent history beyond 24 hours — temporary storage is the model
- Real-time WebSocket streaming of video frames — progress percentage is enough
- Horizontal scaling / multi-worker — single machine sufficient for <10 users

## Context

- v1.0 ran entirely client-side with FFmpeg.wasm 0.12.14 on Cloudflare Pages
- v2.0 moved processing to server-side native FFmpeg on Fly.io (10-50x faster than wasm)
- v3.0 restored FFmpeg.wasm as optional on-device processing alongside server mode
- Frontend is a vanilla JS SPA with hash routing, ES modules, no framework
- Server: Express 5 + SQLite (WAL mode) + native FFmpeg via child_process.spawn
- Docker container (node:22-slim) deployed to Fly.io with 3GB persistent volume
- HMAC bearer token auth with 24h sessions, shared password via AUTH_PASSWORD env var
- Cleanup daemon: 24h expiry + 85% storage eviction at 5-minute intervals
- COOP/COEP headers on Cloudflare Pages, CORP header on Fly.io API
- Device processing: FFmpeg.wasm 0.12.x in Web Workers, 2 concurrent workers, client-zip for download
- 4,428 LOC JavaScript total across frontend and server

## Constraints

- **Platform**: Fly.io for backend, Cloudflare Pages for frontend
- **Cost**: Small Fly machine + volume (~$5-10/month)
- **Storage**: 3GB Fly Volume for processed videos + 24-hour auto-expiry
- **File format**: MP4/MOV input, MP4 output only
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
| Adaptive polling (2s -> 10s backoff) | Active job monitoring needs fast initial updates, backs off to reduce load | ✓ Good |
| Page Visibility API for polling | Pause background polls when tab hidden — battery and bandwidth efficiency | ✓ Good |
| COEP credentialless (v3) | Avoids CORP requirements on CDN resources while enabling SharedArrayBuffer | ✓ Good |
| Shared effects module with seedrandom (v3) | Isomorphic effect generation — same seeds produce same effects on device and server | ✓ Good |
| 2 fixed Web Workers for device processing (v3) | Predictable performance on typical devices without dynamic scaling complexity | ✓ Good |
| 3-stage FFmpeg termination (v3) | stdin q -> SIGTERM -> SIGKILL gives FFmpeg best chance to clean up gracefully | ✓ Good |
| Radio buttons for mode selection (v3) | Clear workflow choice applied on submit, not toggle with immediate effect | ✓ Good |

---
*Last updated: 2026-02-09 after v4.0 milestone started*
